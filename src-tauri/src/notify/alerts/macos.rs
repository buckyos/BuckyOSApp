use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread};
use objc2_foundation::{NSBundle, NSError, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNNotificationSettings, UNNotificationSound, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use std::collections::HashMap;
use std::ptr::NonNull;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Runtime};

use super::super::model::{Alert, AlertLevel};

type Activate = Box<dyn Fn(&Alert) + Send + Sync>;
static ACTIVATE: OnceLock<Activate> = OnceLock::new();

fn shown() -> &'static Mutex<HashMap<String, Alert>> {
    static SHOWN: OnceLock<Mutex<HashMap<String, Alert>>> = OnceLock::new();
    SHOWN.get_or_init(Mutex::default)
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "BuckyOSNotificationDelegate"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            handler.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            handler: &block2::DynBlock<dyn Fn()>,
        ) {
            let tag = response.notification().request().identifier().to_string();
            let alert = shown().lock().expect("notifications poisoned").remove(&tag);
            if let (Some(alert), Some(activate)) = (alert, ACTIVATE.get()) {
                activate(&alert);
            }
            handler.call(());
        }
    }
);

impl Delegate {
    fn new() -> Retained<Self> {
        unsafe { msg_send![Self::alloc(), init] }
    }
}

/// The notification center exists only for a bundled program; asking for it elsewhere
/// (`tauri dev`) raises an exception.
fn center<R: Runtime>(app: &AppHandle<R>) -> Option<Retained<UNUserNotificationCenter>> {
    let bundle = NSBundle::mainBundle();
    bundle.bundleIdentifier()?;
    if !bundle.bundlePath().to_string().ends_with(".app") {
        return None;
    }
    let center = UNUserNotificationCenter::currentNotificationCenter();
    static READY: OnceLock<()> = OnceLock::new();
    READY.get_or_init(|| {
        let activate_app = app.clone();
        let _ = ACTIVATE.set(Box::new(move |alert| super::super::activate(&activate_app, alert)));
        let delegate = Delegate::new();
        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        // The center holds its delegate weakly.
        std::mem::forget(delegate);
    });
    Some(center)
}

pub fn show<R: Runtime>(app: &AppHandle<R>, alert: &Alert) -> Result<(), Box<dyn std::error::Error>> {
    let Some(center) = center(app) else {
        return Err("not running from an app bundle".into());
    };
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(&alert.title));
    content.setSubtitle(&NSString::from_str(super::attribution(alert)));
    content.setBody(&NSString::from_str(&alert.body));
    if alert.level != AlertLevel::Silent {
        content.setSound(Some(&UNNotificationSound::defaultSound()));
    }
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(&alert.tag), &content, None);
    {
        let mut shown = shown().lock().expect("notifications poisoned");
        if shown.len() > 256 {
            shown.clear();
        }
        shown.insert(alert.tag.clone(), alert.clone());
    }
    let done = RcBlock::new(|error: *mut NSError| {
        if let Some(error) = NonNull::new(error) {
            // SAFETY: a non-null error is a live NSError for the duration of the block.
            log::warn!("[notify] {}", unsafe { error.as_ref() }.localizedDescription());
        }
    });
    center.addNotificationRequest_withCompletionHandler(&request, Some(&done));
    Ok(())
}

pub async fn permission<R: Runtime>(app: &AppHandle<R>) -> Option<bool> {
    let receiver = {
        let center = center(app)?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let sender = Mutex::new(Some(sender));
        let done = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // SAFETY: the settings are live for the duration of the block.
            let status = unsafe { settings.as_ref() }.authorizationStatus();
            if let Some(sender) = sender.lock().expect("sender poisoned").take() {
                let _ = sender.send(status);
            }
        });
        center.getNotificationSettingsWithCompletionHandler(&done);
        receiver
    };
    match receiver.await.ok()? {
        UNAuthorizationStatus::Denied => Some(false),
        UNAuthorizationStatus::NotDetermined => None,
        _ => Some(true),
    }
}

pub async fn request_permission<R: Runtime>(app: &AppHandle<R>) -> bool {
    let receiver = {
        let Some(center) = center(app) else { return false };
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let sender = Mutex::new(Some(sender));
        let done = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
            if let Some(sender) = sender.lock().expect("sender poisoned").take() {
                let _ = sender.send(granted.as_bool());
            }
        });
        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge,
            &done,
        );
        receiver
    };
    receiver.await.unwrap_or(false)
}
