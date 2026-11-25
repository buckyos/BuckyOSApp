//! How the pages of a desktop learn of the proxy.

use tauri::{AppHandle, Runtime};

#[cfg(target_os = "windows")]
mod system {
    use super::super::pac::SystemSettings;
    use super::super::proxy::BROWSER_PORT;
    use std::sync::atomic::{AtomicBool, Ordering};

    const ARGUMENTS: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
    const SETTINGS: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

    static USED: AtomicBool = AtomicBool::new(false);

    /// All windows share one browser process, which reads this when it starts.
    pub fn use_script(address: &str) {
        // A script of the system's own cannot be joined with this one: pages go on as they do.
        // The one the client offers to browsers is this one.
        let own = windows_registry::CURRENT_USER.open(SETTINGS).and_then(|settings| settings.get_string("AutoConfigURL"));
        if own.is_ok_and(|own| !own.trim().is_empty() && !own.contains(&format!(":{BROWSER_PORT}/"))) {
            log::info!("[route] this system uses a proxy script; pages keep to it");
            return;
        }
        let known = std::env::var(ARGUMENTS).unwrap_or_default();
        std::env::set_var(ARGUMENTS, format!("{known} --proxy-pac-url={address}").trim_start());
        USED.store(true, Ordering::SeqCst);
    }

    pub fn supported() -> bool {
        USED.load(Ordering::SeqCst)
    }

    pub fn system_settings() -> Option<SystemSettings> {
        let settings = windows_registry::CURRENT_USER.open(SETTINGS).ok()?;
        if settings.get_u32("ProxyEnable").unwrap_or(0) == 0 {
            return None;
        }
        let server = settings.get_string("ProxyServer").ok()?;
        let bypass = settings.get_string("ProxyOverride").unwrap_or_default();
        let bypass = bypass.split(';').map(|host| host.trim().to_ascii_lowercase()).filter(|host| !host.is_empty()).collect();
        Some(SystemSettings { server, bypass })
    }
}

#[cfg(target_os = "windows")]
pub use system::{supported, system_settings, use_script};

#[cfg(not(target_os = "windows"))]
pub fn supported() -> bool {
    true
}

pub fn apply<R: Runtime>(app: &AppHandle<R>, port: u16, hosts: Vec<String>) {
    let applied = app.run_on_main_thread({
        let app = app.clone();
        move || set_proxy(&app, port, &hosts)
    });
    if let Err(error) = applied {
        log::warn!("[route] telling the pages: {error}");
    }
}

#[cfg(target_os = "windows")]
fn set_proxy<R: Runtime>(_app: &AppHandle<R>, _port: u16, _hosts: &[String]) {}

#[cfg(target_os = "macos")]
fn set_proxy<R: Runtime>(_app: &AppHandle<R>, port: u16, hosts: &[String]) {
    mac::set_proxy(port, hosts);
}

/// WebKitGTK cannot tell hosts apart: all https goes to the proxy, which passes the rest on.
#[cfg(target_os = "linux")]
fn set_proxy<R: Runtime>(app: &AppHandle<R>, port: u16, _hosts: &[String]) {
    use tauri::Manager;
    use webkit2gtk::{NetworkProxyMode, NetworkProxySettings, WebViewExt, WebsiteDataManagerExt};

    let Some(main) = app.get_webview_window("main") else { return };
    let told = main.with_webview(move |webview| {
        let Some(manager) = webview.inner().website_data_manager() else { return };
        let mut settings = NetworkProxySettings::new(None, &[]);
        settings.add_proxy_for_scheme("https", &format!("http://127.0.0.1:{port}"));
        manager.set_network_proxy_settings(NetworkProxyMode::Custom, Some(&mut settings));
    });
    if let Err(error) = told {
        log::warn!("[route] telling the pages: {error}");
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::{class, msg_send, sel};
    use objc2_foundation::NSArray;
    use std::ffi::{c_char, CString};

    #[link(name = "Network", kind = "framework")]
    extern "C" {
        fn nw_endpoint_create_host(host: *const c_char, port: *const c_char) -> *mut AnyObject;
        fn nw_proxy_config_create_http_connect(endpoint: *mut AnyObject, tls: *mut AnyObject) -> *mut AnyObject;
        fn nw_proxy_config_add_match_domain(config: *mut AnyObject, domain: *const c_char);
    }

    /// Every window uses the default data store. On the main thread.
    pub fn set_proxy(port: u16, hosts: &[String]) {
        let Some(config) = config(port, hosts) else { return };
        // SAFETY: the main thread; the array holds proxy configurations, which is what is asked for.
        unsafe {
            let store: Retained<AnyObject> = msg_send![class!(WKWebsiteDataStore), defaultDataStore];
            let known: bool = msg_send![&*store, respondsToSelector: sel!(setProxyConfigurations:)];
            if !known {
                return;
            }
            // Without a Zone there is nothing to match, and a configuration that matches everything.
            let configs = if hosts.is_empty() { NSArray::new() } else { NSArray::from_retained_slice(&[config]) };
            let _: () = msg_send![&*store, setProxyConfigurations: &*configs];
        }
    }

    fn config(port: u16, hosts: &[String]) -> Option<Retained<AnyObject>> {
        let _ = AnyClass::get(c"WKWebsiteDataStore")?;
        let port = CString::new(port.to_string()).ok()?;
        // SAFETY: the functions return objects the caller owns and read the texts before they return.
        unsafe {
            let endpoint = Retained::from_raw(nw_endpoint_create_host(c"127.0.0.1".as_ptr(), port.as_ptr()))?;
            let config = nw_proxy_config_create_http_connect(Retained::as_ptr(&endpoint).cast_mut(), std::ptr::null_mut());
            let config = Retained::from_raw(config)?;
            for host in hosts {
                if let Ok(host) = CString::new(host.as_str()) {
                    nw_proxy_config_add_match_domain(Retained::as_ptr(&config).cast_mut(), host.as_ptr());
                }
            }
            Some(config)
        }
    }
}
