//! iOS-specific WKWebView adjustments.

use objc2::rc::Retained;
use objc2::runtime::AnyObject;

/// `UIScrollViewContentInsetAdjustmentNever`.
const CONTENT_INSET_ADJUSTMENT_NEVER: isize = 2;

/// Lets the page use the whole screen on iOS.
///
/// WKWebView's scroll view defaults to automatic content inset adjustment,
/// which removes the top and bottom safe areas from the layout viewport even
/// though `index.html` opts into `viewport-fit=cover` and the CSS already pads
/// with `env(safe-area-inset-*)`. On an iPhone with a Dynamic Island that
/// leaves the bottom 96pt outside the page, so bottom actions are cut off and
/// the body background shows as a band under the app.
pub fn use_full_screen_viewport(window: &tauri::WebviewWindow) {
    let result = window.with_webview(|webview| {
        let wk_webview = webview.inner() as *mut AnyObject;
        if wk_webview.is_null() {
            return;
        }
        // SAFETY: `inner()` is the live WKWebView of this window, and Tauri
        // runs this closure on the main thread as UIKit requires.
        unsafe {
            let scroll_view: Option<Retained<AnyObject>> =
                objc2::msg_send![wk_webview, scrollView];
            if let Some(scroll_view) = scroll_view {
                let _: () = objc2::msg_send![
                    &*scroll_view,
                    setContentInsetAdjustmentBehavior: CONTENT_INSET_ADJUSTMENT_NEVER
                ];
            }
        }
    });
    if let Err(error) = result {
        log::warn!("failed to disable WKWebView content inset adjustment: {error}");
    }
}
