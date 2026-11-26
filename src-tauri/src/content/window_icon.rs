//! The icon of an app's window: the app's own, not the client's. The local page draws it (it has
//! the picture and the tile's look) and hands over a square PNG; smaller sizes are made here by
//! halving it.
//!
//! Windows also gives each app its own taskbar button: an app's windows carry an AppUserModelID of
//! their own (as an installed web app's do in Chrome), with what pinning that button needs to open
//! the app again. Without it every window would sit under the client's button, which shows the
//! client's icon. macOS windows have no icon; Linux gets the window icon only.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

/// The page sends 128 pixels; anything much larger is not an icon.
const MAX_PNG_BYTES: usize = 512 * 1024;
const MAX_SIZE: u32 = 512;
const MIN_SIZE: u32 = 16;

/// A square RGBA picture, not premultiplied.
#[derive(Debug, Clone, PartialEq)]
pub struct Icon {
    pub size: u32,
    pub rgba: Vec<u8>,
}

impl Icon {
    pub fn decode(png_base64: &str) -> Result<Self, String> {
        let bytes = STANDARD.decode(png_base64.trim()).map_err(|_| "not base64".to_string())?;
        if bytes.len() > MAX_PNG_BYTES || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("not a PNG icon".into());
        }
        let image = tauri::image::Image::from_bytes(&bytes).map_err(|error| error.to_string())?;
        let (width, height) = (image.width(), image.height());
        if width != height || !(MIN_SIZE..=MAX_SIZE).contains(&width) {
            return Err(format!("an icon is square, {MIN_SIZE} to {MAX_SIZE} pixels: {width}x{height}"));
        }
        Ok(Self { size: width, rgba: image.rgba().to_vec() })
    }
}

/// Windows draws a window's icons at several sizes and keeps the app's in a file.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
impl Icon {
    /// Half the size, each pixel the average of four, weighted by how opaque they are.
    pub fn halve(&self) -> Self {
        let half = self.size / 2;
        let mut rgba = vec![0u8; (half * half * 4) as usize];
        for y in 0..half {
            for x in 0..half {
                let mut sum = [0u32; 4];
                for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                    let at = (((2 * y + dy) * self.size + 2 * x + dx) * 4) as usize;
                    let alpha = self.rgba[at + 3] as u32;
                    for channel in 0..3 {
                        sum[channel] += self.rgba[at + channel] as u32 * alpha;
                    }
                    sum[3] += alpha;
                }
                let at = ((y * half + x) * 4) as usize;
                if sum[3] > 0 {
                    for channel in 0..3 {
                        rgba[at + channel] = ((sum[channel] + sum[3] / 2) / sum[3]) as u8;
                    }
                }
                rgba[at + 3] = ((sum[3] + 2) / 4) as u8;
            }
        }
        Self { size: half, rgba }
    }

    /// This one and its halves down to `smallest` pixels, largest first.
    pub fn sizes(&self, smallest: u32) -> Vec<Self> {
        let mut sizes = vec![self.clone()];
        while let Some(last) = sizes.last() {
            if last.size / 2 < smallest || last.size % 2 != 0 {
                break;
            }
            let next = last.halve();
            sizes.push(next);
        }
        sizes
    }

    /// The smallest of `sizes` that is at least `pixels`, or the largest.
    pub fn pick(sizes: &[Self], pixels: u32) -> &Self {
        sizes.iter().rev().find(|icon| icon.size >= pixels).unwrap_or(&sizes[0])
    }

    /// An `.ico` file with each size as a 32-bit bitmap.
    pub fn to_ico(sizes: &[Self]) -> Vec<u8> {
        let sizes: Vec<&Self> = sizes.iter().filter(|icon| icon.size <= 256).collect();
        let mut header = Vec::new();
        let mut images = Vec::new();
        header.extend_from_slice(&[0, 0, 1, 0]);
        header.extend_from_slice(&(sizes.len() as u16).to_le_bytes());
        let mut offset = 6 + 16 * sizes.len() as u32;
        for icon in sizes {
            let image = icon.to_dib();
            let side = if icon.size >= 256 { 0 } else { icon.size as u8 };
            header.extend_from_slice(&[side, side, 0, 0]);
            header.extend_from_slice(&1u16.to_le_bytes());
            header.extend_from_slice(&32u16.to_le_bytes());
            header.extend_from_slice(&(image.len() as u32).to_le_bytes());
            header.extend_from_slice(&offset.to_le_bytes());
            offset += image.len() as u32;
            images.extend_from_slice(&image);
        }
        header.extend_from_slice(&images);
        header
    }

    /// An icon image in an `.ico`: the header, the BGRA rows bottom up, an empty AND mask.
    fn to_dib(&self) -> Vec<u8> {
        let size = self.size as usize;
        let mask_row = size.div_ceil(32) * 4;
        let pixels = size * size * 4;
        let mut out = Vec::with_capacity(40 + pixels + mask_row * size);
        out.extend_from_slice(&40u32.to_le_bytes());
        out.extend_from_slice(&(size as i32).to_le_bytes());
        out.extend_from_slice(&(2 * size as i32).to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&32u16.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        out.extend_from_slice(&((pixels + mask_row * size) as u32).to_le_bytes());
        out.extend_from_slice(&[0; 16]);
        for row in (0..size).rev() {
            for pixel in self.rgba[row * size * 4..(row + 1) * size * 4].chunks_exact(4) {
                out.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
            }
        }
        out.resize(out.len() + mask_row * size, 0);
        out
    }
}

/// What a Windows taskbar button of an app needs: who it is and how to open it again.
#[derive(Debug, Clone, PartialEq)]
pub struct TaskbarApp {
    /// The app's AppUserModelID: one per Zone and app, so its windows share a button.
    pub id: String,
    /// The `buckyos://app.open` link that opens the app.
    pub link: String,
    pub name: String,
}

impl TaskbarApp {
    /// Whether `id` is the AppUserModelID of one of the client's apps.
    pub fn is_app_id(client_id: &str, id: &str) -> bool {
        id.strip_prefix(client_id).is_some_and(|rest| rest.starts_with(".App."))
    }

    pub fn new(client_id: &str, zone: &str, zone_host: &str, app: &str, name: &str) -> Self {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(format!("{zone}\n{app}"));
        let query: String = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("v", "1")
            .append_pair("zone", zone_host)
            .append_pair("app", app)
            .finish();
        Self {
            id: format!("{client_id}.App.{}", hex::encode(&digest[..8])),
            link: format!("{}://app.open?{query}", crate::deeplink::SCHEME),
            name: name.chars().filter(|ch| !ch.is_control()).take(128).collect(),
        }
    }
}

/// Whether the shell started the client from an app's taskbar button: from a shortcut that
/// carries an app's AppUserModelID, or from one whose command opens an app.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn started_as_app(client_id: &str, app_id: Option<&str>, from_shortcut: bool, arguments: &[String]) -> bool {
    let opens_app = format!("{}://app.open", crate::deeplink::SCHEME);
    app_id.is_some_and(|id| TaskbarApp::is_app_id(client_id, id))
        || (from_shortcut && arguments.iter().any(|argument| argument.starts_with(&opens_app)))
}

#[cfg(target_os = "windows")]
pub mod taskbar {
    //! Window icons and taskbar identity through Win32; everything here runs on the main thread.

    use std::collections::HashMap;
    use std::mem::ManuallyDrop;
    use std::path::Path;
    use std::sync::{Mutex, OnceLock};

    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, PROPERTYKEY, WPARAM};
    use windows::Win32::Storage::EnhancedStorage::{
        PKEY_AppUserModel_ID, PKEY_AppUserModel_RelaunchCommand, PKEY_AppUserModel_RelaunchDisplayNameResource,
        PKEY_AppUserModel_RelaunchIconResource,
    };
    use windows::Win32::System::Com::CoTaskMemAlloc;
    use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
    use windows::Win32::System::Threading::{GetStartupInfoW, STARTF_TITLEISAPPID, STARTF_TITLEISLINKNAME, STARTUPINFOW};
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    use windows::Win32::UI::WindowsAndMessaging::{CreateIcon, DestroyIcon, SendMessageW, HICON, ICON_BIG, ICON_SMALL, WM_SETICON};

    use super::{Icon, TaskbarApp};

    /// A process the shell starts from a pinned button takes that button's AppUserModelID (named
    /// in the start-up info, or read from the shortcut the shell names there), and every window
    /// without one of its own joins it. Started from an app's button, the client keeps its own
    /// (the one its installer gives its shortcuts), or its main window would sit under the app.
    /// Before any window is made.
    pub fn keep_client_identity(client_id: &str) {
        let mut info = STARTUPINFOW { cb: std::mem::size_of::<STARTUPINFOW>() as u32, ..Default::default() };
        unsafe { GetStartupInfoW(&mut info) };
        let title = (!info.lpTitle.is_null()).then(|| unsafe { info.lpTitle.to_string() }.unwrap_or_default());
        let app_id = title.as_deref().filter(|_| info.dwFlags.0 & STARTF_TITLEISAPPID.0 != 0);
        let from_shortcut = info.dwFlags.0 & STARTF_TITLEISLINKNAME.0 != 0;
        let arguments: Vec<String> = std::env::args().skip(1).collect();
        if super::started_as_app(client_id, app_id, from_shortcut, &arguments) {
            let _ = unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(client_id)) };
        }
    }

    /// The icons a window was given, kept to be destroyed with it (by window label).
    fn given() -> &'static Mutex<HashMap<String, Vec<isize>>> {
        static GIVEN: OnceLock<Mutex<HashMap<String, Vec<isize>>>> = OnceLock::new();
        GIVEN.get_or_init(Mutex::default)
    }

    fn wide(text: &str) -> windows::core::Result<PROPVARIANT> {
        let units: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            // Freed by `PropVariantClear` when the PROPVARIANT drops.
            let memory = CoTaskMemAlloc(units.len() * 2) as *mut u16;
            if memory.is_null() {
                return Err(windows::core::Error::from_win32());
            }
            memory.copy_from_nonoverlapping(units.as_ptr(), units.len());
            Ok(PROPVARIANT {
                Anonymous: PROPVARIANT_0 {
                    Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                        vt: VT_LPWSTR,
                        wReserved1: 0,
                        wReserved2: 0,
                        wReserved3: 0,
                        Anonymous: PROPVARIANT_0_0_0 { pwszVal: PWSTR(memory) },
                    }),
                },
            })
        }
    }

    fn set(hwnd: HWND, values: &[(PROPERTYKEY, Option<&str>)]) -> windows::core::Result<()> {
        unsafe {
            let store: IPropertyStore = SHGetPropertyStoreForWindow(hwnd)?;
            for (key, value) in values {
                let value = match value {
                    Some(text) => wide(text)?,
                    None => PROPVARIANT::default(),
                };
                store.SetValue(key, &value)?;
            }
            store.Commit()
        }
    }

    /// Before the window is first shown, so its button is the app's from the start. The relaunch
    /// icon is the one an earlier window of the app left, when there is one.
    pub fn claim(hwnd: HWND, app: &TaskbarApp, exe: &Path, icon_file: Option<&Path>) {
        let command = format!("\"{}\" \"{}\"", exe.display(), app.link);
        let icon = icon_file.map(|path| format!("{},0", path.display()));
        let result = set(
            hwnd,
            &[
                (PKEY_AppUserModel_ID, Some(&app.id)),
                (PKEY_AppUserModel_RelaunchCommand, Some(&command)),
                (PKEY_AppUserModel_RelaunchDisplayNameResource, Some(&app.name)),
                (PKEY_AppUserModel_RelaunchIconResource, icon.as_deref()),
            ],
        );
        if let Err(error) = result {
            log::warn!("[content] taskbar identity: {error}");
        }
    }

    pub fn set_relaunch_icon(hwnd: HWND, icon_file: &Path) {
        let icon = format!("{},0", icon_file.display());
        if let Err(error) = set(hwnd, &[(PKEY_AppUserModel_RelaunchIconResource, Some(&icon))]) {
            log::warn!("[content] taskbar icon: {error}");
        }
    }

    /// A window must give its properties back before it is destroyed. Its icons stay until it is
    /// gone (`forget`): it still shows them while it closes.
    pub fn release(hwnd: HWND) {
        let _ = set(
            hwnd,
            &[
                (PKEY_AppUserModel_RelaunchIconResource, None),
                (PKEY_AppUserModel_RelaunchDisplayNameResource, None),
                (PKEY_AppUserModel_RelaunchCommand, None),
                (PKEY_AppUserModel_ID, None),
            ],
        );
    }

    /// The window is gone: its icons can go too.
    pub fn forget(label: &str) {
        let icons = given().lock().expect("icons poisoned").remove(label);
        for icon in icons.unwrap_or_default() {
            let _ = unsafe { DestroyIcon(HICON(icon as _)) };
        }
    }

    fn hicon(icon: &Icon) -> windows::core::Result<HICON> {
        let bgra: Vec<u8> = icon.rgba.chunks_exact(4).flat_map(|pixel| [pixel[2], pixel[1], pixel[0], pixel[3]]).collect();
        let mask = vec![0u8; (icon.size as usize).div_ceil(8) * icon.size as usize];
        unsafe { CreateIcon(None, icon.size as i32, icon.size as i32, 1, 32, mask.as_ptr(), bgra.as_ptr()) }
    }

    /// The title bar's icon and the taskbar's (and Alt+Tab's), each near the size it is drawn at.
    pub fn set_icons(hwnd: HWND, label: &str, sizes: &[Icon], scale: f64) {
        let small = Icon::pick(sizes, (16.0 * scale).round() as u32);
        let big = Icon::pick(sizes, (32.0 * scale).round() as u32);
        let mut made = Vec::new();
        for (kind, icon) in [(ICON_SMALL, small), (ICON_BIG, big)] {
            match hicon(icon) {
                Ok(handle) => {
                    unsafe { SendMessageW(hwnd, WM_SETICON, Some(WPARAM(kind as usize)), Some(LPARAM(handle.0 as isize))) };
                    made.push(handle.0 as isize);
                }
                Err(error) => log::warn!("[content] window icon: {error}"),
            }
        }
        let replaced = given().lock().expect("icons poisoned").insert(label.to_string(), made);
        for icon in replaced.unwrap_or_default() {
            let _ = unsafe { DestroyIcon(HICON(icon as _)) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(size: u32, pixel: [u8; 4]) -> Icon {
        Icon { size, rgba: pixel.repeat((size * size) as usize) }
    }

    #[test]
    fn halving_weighs_by_opacity() {
        // One opaque red pixel and three transparent black ones: red, a quarter opaque.
        let icon = Icon { size: 2, rgba: vec![255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
        assert_eq!(icon.halve(), Icon { size: 1, rgba: vec![255, 0, 0, 64] });
        assert_eq!(solid(4, [10, 20, 30, 255]).halve(), solid(2, [10, 20, 30, 255]));
    }

    #[test]
    fn sizes_go_down_by_halves_and_pick_the_nearest_larger() {
        let sizes = solid(128, [1, 2, 3, 255]).sizes(16);
        assert_eq!(sizes.iter().map(|icon| icon.size).collect::<Vec<_>>(), vec![128, 64, 32, 16]);
        assert_eq!(Icon::pick(&sizes, 16).size, 16);
        assert_eq!(Icon::pick(&sizes, 24).size, 32);
        assert_eq!(Icon::pick(&sizes, 48).size, 64);
        assert_eq!(Icon::pick(&sizes, 300).size, 128);
    }

    #[test]
    fn an_ico_lists_each_size_and_where_it_is() {
        let sizes = solid(32, [1, 2, 3, 255]).sizes(16);
        let ico = Icon::to_ico(&sizes);
        assert_eq!(&ico[..6], &[0, 0, 1, 0, 2, 0]);
        // The first entry: 32x32, 32 bits, its bytes right after the directory.
        assert_eq!(ico[6], 32);
        assert_eq!(u32::from_le_bytes(ico[18..22].try_into().unwrap()), 6 + 2 * 16);
        let length = u32::from_le_bytes(ico[14..18].try_into().unwrap()) as usize;
        assert_eq!(length, 40 + 32 * 32 * 4 + 4 * 32);
        let second = u32::from_le_bytes(ico[34..38].try_into().unwrap()) as usize;
        assert_eq!(second, 6 + 2 * 16 + length);
        assert_eq!(ico.len(), second + 40 + 16 * 16 * 4 + 4 * 16);
        // Bottom-up BGRA.
        assert_eq!(&ico[38 + 40..38 + 44], &[3, 2, 1, 255]);
    }

    #[test]
    fn a_square_png_is_an_icon_and_nothing_else_is() {
        let icon = Icon::decode("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGM4kWL0nxLMMGrAqAGjBgwXAwD6hF0f2xrP9QAAAABJRU5ErkJggg==").unwrap();
        assert_eq!(icon, solid(16, [200, 100, 50, 255]));
        // 16x8.
        assert!(Icon::decode("iVBORw0KGgoAAAANSUhEUgAAABAAAAAICAYAAADwdn+XAAAAFUlEQVR4nGM4kWL0nxLMMGrAcDAAADFFLpA/QTUxAAAAAElFTkSuQmCC").is_err());
        assert!(Icon::decode("not base64!").is_err());
        assert!(Icon::decode(&STANDARD.encode(b"GIF89a")).is_err());
    }

    #[test]
    fn an_app_has_one_taskbar_identity_per_zone_and_a_link_back() {
        let app = TaskbarApp::new("com.buckyos.app", "did:web:bob.example", "bob.example", "messagehub", "Message\nHub");
        assert!(app.id.starts_with("com.buckyos.app.App."));
        assert_eq!(app.id.len(), "com.buckyos.app.App.".len() + 16);
        assert_eq!(app.link, "buckyos://app.open?v=1&zone=bob.example&app=messagehub");
        assert_eq!(app.name, "MessageHub");
        let other = TaskbarApp::new("com.buckyos.app", "did:web:carol.example", "carol.example", "messagehub", "Message Hub");
        assert_ne!(app.id, other.id);
        assert!(TaskbarApp::is_app_id("com.buckyos.app", &app.id));
        assert!(!TaskbarApp::is_app_id("com.buckyos.app", "com.buckyos.app"));
        assert!(!TaskbarApp::is_app_id("com.buckyos.app", "com.buckyos.application.App.x"));
    }

    #[test]
    fn started_from_an_app_button_is_told_from_the_client_own() {
        let id = "com.buckyos.app";
        let app = TaskbarApp::new(id, "did:web:bob.example", "bob.example", "messagehub", "Message Hub");
        let link = vec![app.link.clone()];
        assert!(started_as_app(id, Some(&app.id), false, &[]));
        assert!(started_as_app(id, None, true, &link));
        // The client's own shortcut, autostart, a link from a browser.
        assert!(!started_as_app(id, Some(id), false, &[]));
        assert!(!started_as_app(id, None, true, &[]));
        assert!(!started_as_app(id, None, false, &link));
    }
}
