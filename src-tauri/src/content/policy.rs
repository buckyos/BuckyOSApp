//! Where a content view may go.

use reqwest::Url;

use crate::zone::host::{classify_host, login_redirect, ZoneHostKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Navigation {
    Allow,
    /// The Zone's sign-in page: the client signs the view in and goes on to the target.
    SignIn(Option<Url>),
    /// A page of a listed Zone that is another app's: the open rules decide.
    OpenApp,
    /// Somewhere else: the system browser.
    External,
    /// `buckyos://…`.
    DeepLink,
    Block,
}

pub struct ViewPlace<'a> {
    pub zone_host: &'a str,
    /// The host the view was opened on.
    pub page_host: &'a str,
    /// Where a sign-in the client itself started is about to arrive.
    pub arriving: Option<&'a str>,
}

impl ViewPlace<'_> {
    /// The view may be on that host without becoming another app's: its own host, and the AI
    /// Workspace list and the workspaces.
    fn is_own(&self, host: &str) -> bool {
        if host.eq_ignore_ascii_case(self.page_host) {
            return true;
        }
        match (classify_host(self.page_host, self.zone_host), classify_host(host, self.zone_host)) {
            (Some(from), Some(to)) => is_aiworkspace_pair(&from, &to),
            _ => false,
        }
    }
}

fn is_aiworkspace_pair(from: &ZoneHostKind, to: &ZoneHostKind) -> bool {
    let workspace = |kind: &ZoneHostKind| matches!(kind, ZoneHostKind::Sub(label) if label.to_ascii_lowercase().starts_with("aiws-"));
    (workspace(from) && (workspace(to) || matches!(to, ZoneHostKind::Root)))
        || (matches!(from, ZoneHostKind::Root) && workspace(to))
}

/// `main_frame` is `None` where the platform does not tell frames apart.
pub fn decide(place: &ViewPlace, url: &Url, main_frame: Option<bool>, is_listed_zone: impl Fn(&str) -> bool) -> Navigation {
    match url.scheme() {
        "https" | "http" => {}
        "about" | "blob" | "data" => return Navigation::Allow,
        "buckyos" => return Navigation::DeepLink,
        "mailto" | "tel" | "sms" => return Navigation::External,
        // What a desktop window shows in place of a page; a phone's views have no local pages.
        "tauri" if cfg!(desktop) => return Navigation::Allow,
        _ => return Navigation::Block,
    }
    let Some(host) = url.host_str() else {
        return Navigation::Block;
    };
    if cfg!(desktop) && matches!(host, "tauri.localhost" | "ipc.localhost" | "asset.localhost") {
        return Navigation::Allow;
    }
    if main_frame == Some(false) {
        return Navigation::Allow;
    }
    if let Some(kind) = classify_host(host, place.zone_host) {
        if url.scheme() != "https" {
            return Navigation::Block;
        }
        if let Some(target) = login_redirect(url, place.zone_host) {
            // A page names the address; it can only be signed in to itself.
            return Navigation::SignIn(target.filter(|target| target.host_str().is_some_and(|host| place.is_own(host))));
        }
        if main_frame.is_none() {
            return Navigation::Allow;
        }
        if url.path() == "/sso_callback" {
            let expected = place.arriving.is_some_and(|arriving| arriving.eq_ignore_ascii_case(host));
            return if expected { Navigation::Allow } else { Navigation::Block };
        }
        if place.is_own(host) || matches!(kind, ZoneHostKind::Sys) || place.arriving.is_some_and(|arriving| arriving.eq_ignore_ascii_case(host)) {
            return Navigation::Allow;
        }
        return Navigation::OpenApp;
    }
    if main_frame.is_none() {
        return Navigation::Allow;
    }
    if url.scheme() == "https" && is_listed_zone(host) {
        return Navigation::OpenApp;
    }
    Navigation::External
}

/// A page asked for a new window. Views never open windows by themselves.
pub fn decide_new_window(place: &ViewPlace, url: &Url, is_listed_zone: impl Fn(&str) -> bool) -> Navigation {
    let Some(host) = url.host_str() else {
        return match url.scheme() {
            "buckyos" => Navigation::DeepLink,
            "mailto" | "tel" | "sms" => Navigation::External,
            _ => Navigation::Block,
        };
    };
    match url.scheme() {
        "buckyos" => Navigation::DeepLink,
        "https" if classify_host(host, place.zone_host).is_some() || is_listed_zone(host) => Navigation::OpenApp,
        "https" | "http" => Navigation::External,
        _ => Navigation::Block,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn go(page_host: &str, url: &str, main_frame: Option<bool>) -> Navigation {
        decide(
            &ViewPlace { zone_host: "bob.example", page_host, arriving: None },
            &Url::parse(url).unwrap(),
            main_frame,
            |host| host == "carol.example" || host.ends_with(".carol.example"),
        )
    }

    #[test]
    fn a_view_stays_on_its_own_host() {
        assert_eq!(go("notes.bob.example", "https://notes.bob.example/a", Some(true)), Navigation::Allow);
        assert_eq!(go("bob.example", "https://bob.example/taskcenter", Some(true)), Navigation::Allow);
        assert_eq!(go("notes.bob.example", "https://files.bob.example/", Some(true)), Navigation::OpenApp);
        assert_eq!(go("notes.bob.example", "https://notes.carol.example/", Some(true)), Navigation::OpenApp);
        assert_eq!(go("notes.bob.example", "https://example.org/", Some(true)), Navigation::External);
        assert_eq!(go("notes.bob.example", "http://notes.bob.example/", Some(true)), Navigation::Block);
        assert_eq!(go("notes.bob.example", "buckyos://app.open?v=1", Some(true)), Navigation::DeepLink);
        assert_eq!(go("notes.bob.example", "file:///etc/passwd", Some(true)), Navigation::Block);
        assert_eq!(go("notes.bob.example", "javascript:alert(1)", Some(true)), Navigation::Block);
    }

    #[test]
    fn workspaces_and_their_list_are_one_app() {
        assert_eq!(go("bob.example", "https://aiws-1.bob.example/", Some(true)), Navigation::Allow);
        assert_eq!(go("aiws-1.bob.example", "https://bob.example/workspace", Some(true)), Navigation::Allow);
        assert_eq!(go("aiws-1.bob.example", "https://aiws-2.bob.example/", Some(true)), Navigation::Allow);
        assert_eq!(go("aiws-1.bob.example", "https://notes.bob.example/", Some(true)), Navigation::OpenApp);
    }

    #[test]
    fn the_sign_in_page_is_never_shown() {
        let target = Some(Url::parse("https://notes.bob.example/a").unwrap());
        assert_eq!(
            go("notes.bob.example", "https://sys.bob.example/login?redirect_url=https%3A%2F%2Fnotes.bob.example%2Fa", Some(true)),
            Navigation::SignIn(target)
        );
        assert_eq!(go("bob.example", "https://bob.example/login", None), Navigation::SignIn(None));
        // another Zone's sign-in page is not this Zone's
        assert_eq!(go("bob.example", "https://sys.carol.example/login", Some(true)), Navigation::OpenApp);
    }

    #[test]
    fn a_page_is_only_signed_in_to_itself() {
        let sign_in = |page: &str, target: &str| {
            go(page, &format!("https://bob.example/login?redirect_url=https%3A%2F%2F{target}%2F"), Some(true))
        };
        assert_eq!(sign_in("notes.bob.example", "bob.example"), Navigation::SignIn(None));
        assert_eq!(sign_in("notes.bob.example", "files.bob.example"), Navigation::SignIn(None));
        let workspace = Url::parse("https://aiws-1.bob.example/").unwrap();
        assert_eq!(sign_in("bob.example", "aiws-1.bob.example"), Navigation::SignIn(Some(workspace)));
    }

    #[test]
    fn callbacks_are_the_clients_to_load() {
        let url = Url::parse("https://files.bob.example/sso_callback?nonce=1").unwrap();
        let go = |arriving: Option<&str>| {
            decide(&ViewPlace { zone_host: "bob.example", page_host: "notes.bob.example", arriving }, &url, Some(true), |_| false)
        };
        assert_eq!(go(None), Navigation::Block);
        assert_eq!(go(Some("notes.bob.example")), Navigation::Block);
        assert_eq!(go(Some("files.bob.example")), Navigation::Allow);
    }

    #[test]
    fn frames_load_what_the_page_embeds() {
        assert_eq!(go("notes.bob.example", "https://example.org/embed", Some(false)), Navigation::Allow);
        assert_eq!(go("notes.bob.example", "https://bob.example/embed/sysdlg/select", Some(false)), Navigation::Allow);
        assert_eq!(go("notes.bob.example", "about:blank", None), Navigation::Allow);
        assert_eq!(go("notes.bob.example", "https://bob.example/embed/sysdlg/select", None), Navigation::Allow);
    }

    #[test]
    fn new_windows_become_open_requests_or_leave_the_client() {
        let go = |url: &str| {
            decide_new_window(
                &ViewPlace { zone_host: "bob.example", page_host: "notes.bob.example", arriving: None },
                &Url::parse(url).unwrap(),
                |host| host == "carol.example",
            )
        };
        assert_eq!(go("https://bob.example/?open-app=files"), Navigation::OpenApp);
        assert_eq!(go("https://carol.example/messagehub"), Navigation::OpenApp);
        assert_eq!(go("https://example.org/"), Navigation::External);
        assert_eq!(go("about:blank"), Navigation::Block);
        assert_eq!(go("blob:https://notes.bob.example/1"), Navigation::Block);
        assert_eq!(go("mailto:a@b.c"), Navigation::External);
    }
}
