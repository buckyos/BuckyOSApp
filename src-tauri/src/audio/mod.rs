//! `audio.*` of `window.BuckyApi`.

#[cfg(desktop)]
mod desktop;
#[cfg(desktop)]
pub use desktop::dispatch;
#[cfg(mobile)]
mod mobile;
#[cfg(mobile)]
pub use mobile::*;
#[cfg(any(mobile, test))]
mod recordings;
