//! Closing and quitting on the desktop.
//!
//! The main window's close button hides it while the tray icon is there. Quitting asks every app
//! window first, one after the other; the local page does the asking.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::tray::TrayState;

pub const QUIT_EVENT: &str = "app://quit-request";
/// A local page that does not even take up the request cannot keep the process alive.
const QUIT_ANSWER: Duration = Duration::from_secs(5);
static QUIT_TURN: AtomicU64 = AtomicU64::new(0);

pub fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    if !crate::content::windows::open_views(app) {
        app.exit(0);
        return;
    }
    let turn = QUIT_TURN.fetch_add(1, Ordering::AcqRel) + 1;
    if app.emit_to("main", QUIT_EVENT, ()).is_err() {
        app.exit(0);
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(QUIT_ANSWER).await;
        if QUIT_TURN.load(Ordering::Acquire) == turn {
            log::warn!("[lifecycle] the main page did not take up the quit request");
            app.exit(0);
        }
    });
}

/// The local page is asking the app windows now.
#[tauri::command]
pub fn quit_started() {
    QUIT_TURN.fetch_add(1, Ordering::AcqRel);
}

#[tauri::command]
pub fn quit_confirmed(app: AppHandle) {
    app.exit(0);
}

/// The main window is as tall as a phone; a small screen has less room than that.
pub fn fit_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else { return };
    let (Ok(Some(monitor)), Ok(outer), Ok(inner)) = (window.current_monitor(), window.outer_size(), window.inner_size()) else {
        return;
    };
    let room = monitor.work_area();
    if outer.height <= room.size.height {
        return;
    }
    let frame = outer.height.saturating_sub(inner.height);
    let _ = window.set_size(tauri::PhysicalSize::new(inner.width, room.size.height.saturating_sub(frame)));
    if let Ok(position) = window.outer_position() {
        let _ = window.set_position(tauri::PhysicalPosition::new(position.x, room.position.y));
    }
}

/// Returns true when closing the main window was turned into something else.
pub fn main_close_requested<R: Runtime>(app: &AppHandle<R>) -> bool {
    if app.state::<TrayState>().is_enabled() {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
        return true;
    }
    if crate::content::windows::open_views(app) {
        request_quit(app);
        return true;
    }
    false
}

/// ⌘Q and the Dock's Quit end the process without any event of Tauri's; the app delegate gets the
/// method that asks first. Logging out and shutting down are never held up.
#[cfg(target_os = "macos")]
pub fn ask_before_terminating(app: &AppHandle<tauri::Wry>) {
    use objc2::ffi;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Imp, Sel};
    use objc2::{class, msg_send, sel};
    use std::sync::OnceLock;

    static APP: OnceLock<AppHandle<tauri::Wry>> = OnceLock::new();
    const CANCEL: usize = 0;
    const NOW: usize = 1;
    /// `kAEQuitReason`: why the system asks the application to quit.
    const QUIT_REASON: u32 = u32::from_be_bytes(*b"why?");
    const QUIT_ALL: u32 = u32::from_be_bytes(*b"quia");

    unsafe extern "C-unwind" fn should_terminate(_this: *mut AnyObject, _cmd: Sel, _sender: *mut AnyObject) -> usize {
        let manager: Retained<AnyObject> = msg_send![class!(NSAppleEventManager), sharedAppleEventManager];
        let event: Option<Retained<AnyObject>> = msg_send![&*manager, currentAppleEvent];
        if let Some(event) = event {
            let reason: Option<Retained<AnyObject>> = msg_send![&*event, attributeDescriptorForKeyword: QUIT_REASON];
            if let Some(reason) = reason {
                let code: u32 = msg_send![&*reason, typeCodeValue];
                if code != QUIT_ALL {
                    return NOW;
                }
            }
        }
        match APP.get() {
            Some(app) if crate::content::windows::open_views(app) => {
                request_quit(app);
                CANCEL
            }
            _ => NOW,
        }
    }

    if APP.set(app.clone()).is_err() {
        return;
    }
    // SAFETY: on the main thread during setup; `NSUInteger applicationShouldTerminate:(id)` is an
    // optional method of the delegate that tao's class does not have.
    unsafe {
        let shared: Retained<AnyObject> = msg_send![class!(NSApplication), sharedApplication];
        let delegate: Option<Retained<AnyObject>> = msg_send![&*shared, delegate];
        let Some(delegate) = delegate else { return };
        let method: Imp = std::mem::transmute::<unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize, Imp>(should_terminate);
        ffi::class_addMethod(delegate.class() as *const _ as *mut _, sel!(applicationShouldTerminate:), method, c"Q@:@".as_ptr());
        // The application looks at what its delegate answers to only when it gets it.
        let none: *const AnyObject = std::ptr::null();
        let _: () = msg_send![&*shared, setDelegate: none];
        let _: () = msg_send![&*shared, setDelegate: &*delegate];
    }
}
