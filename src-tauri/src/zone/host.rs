//! Which Zone, and which of its hosts, a URL belongs to.

use reqwest::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZoneHostKind<'a> {
    /// The Zone root, where the system pages live.
    Root,
    /// `sys.<zone host>`, where the Zone's own sign-in page lives.
    Sys,
    /// `<label>.<zone host>`.
    Sub(&'a str),
}

pub fn normalize_host(host: &str) -> String {
    host.trim().trim_matches('.').to_ascii_lowercase()
}

/// The part of `host` this Zone uses; `None` when the host is not one of the Zone's.
pub fn classify_host<'a>(host: &'a str, zone_host: &str) -> Option<ZoneHostKind<'a>> {
    if host.eq_ignore_ascii_case(zone_host) {
        return Some(ZoneHostKind::Root);
    }
    let prefix_len = host.len().checked_sub(zone_host.len() + 1)?;
    if !host.is_char_boundary(prefix_len) {
        return None;
    }
    let (label, suffix) = host.split_at(prefix_len);
    if label.is_empty() || !suffix.starts_with('.') || !suffix[1..].eq_ignore_ascii_case(zone_host) {
        return None;
    }
    if label.eq_ignore_ascii_case("sys") {
        return Some(ZoneHostKind::Sys);
    }
    Some(ZoneHostKind::Sub(label))
}

/// The index of the Zone a host belongs to: the longest matching Zone host wins, so a Zone under
/// another Zone's domain is never taken for one of that Zone's apps.
pub fn find_zone<'h>(host: &str, zone_hosts: impl Iterator<Item = &'h str>) -> Option<usize> {
    zone_hosts
        .enumerate()
        .filter(|(_, zone_host)| classify_host(host, zone_host).is_some())
        .max_by_key(|(_, zone_host)| zone_host.len())
        .map(|(index, _)| index)
}

/// A web page address the client may open: https, or http where the Zone itself is plain http
/// (never sent credentials in the URL).
pub fn web_url(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return None;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    Some(url)
}

/// The Zone's sign-in page: `sys.<zone>/login` and the root's own `/login`. Returns where the page
/// wants to go after signing in.
pub fn login_redirect(url: &Url, zone_host: &str) -> Option<Option<Url>> {
    let kind = classify_host(url.host_str()?, zone_host)?;
    if url.path().trim_end_matches('/') != "/login" {
        return None;
    }
    if !matches!(kind, ZoneHostKind::Root | ZoneHostKind::Sys) {
        return None;
    }
    let target = url
        .query_pairs()
        .find(|(key, _)| key == "redirect_url")
        .and_then(|(_, value)| web_url(&value))
        .filter(|target| {
            target
                .host_str()
                .is_some_and(|host| classify_host(host, zone_host).is_some())
        });
    Some(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_the_hosts_of_a_zone() {
        assert_eq!(classify_host("charlie.me", "charlie.me"), Some(ZoneHostKind::Root));
        assert_eq!(classify_host("SYS.charlie.me", "charlie.me"), Some(ZoneHostKind::Sys));
        assert_eq!(classify_host("notes-bob.charlie.me", "charlie.me"), Some(ZoneHostKind::Sub("notes-bob")));
        assert_eq!(classify_host("evilcharlie.me", "charlie.me"), None);
        assert_eq!(classify_host("charlie.me.evil.com", "charlie.me"), None);
        assert_eq!(classify_host(".charlie.me", "charlie.me"), None);
        assert_eq!(classify_host("me", "charlie.me"), None);
    }

    #[test]
    fn the_longest_zone_host_wins() {
        let hosts = ["example.org", "team.example.org"];
        assert_eq!(find_zone("app.team.example.org", hosts.into_iter()), Some(1));
        assert_eq!(find_zone("team.example.org", hosts.into_iter()), Some(1));
        assert_eq!(find_zone("app.example.org", hosts.into_iter()), Some(0));
        assert_eq!(find_zone("example.com", hosts.into_iter()), None);
    }

    #[test]
    fn recognizes_the_sign_in_page_and_its_target() {
        let login = |value: &str| login_redirect(&Url::parse(value).unwrap(), "charlie.me");
        assert_eq!(
            login("https://sys.charlie.me/login?redirect_url=https%3A%2F%2Fnotes.charlie.me%2Fa%3Fb%3D1"),
            Some(Some(Url::parse("https://notes.charlie.me/a?b=1").unwrap()))
        );
        assert_eq!(login("https://charlie.me/login"), Some(None));
        // a target outside the Zone is dropped
        assert_eq!(login("https://sys.charlie.me/login?redirect_url=https%3A%2F%2Fevil.com%2F"), Some(None));
        assert_eq!(login("https://notes.charlie.me/login"), None);
        assert_eq!(login("https://charlie.me/logins"), None);
        assert_eq!(login("https://other.me/login"), None);
    }

    #[test]
    fn only_plain_https_addresses_open() {
        assert!(web_url("https://charlie.me/a").is_some());
        assert!(web_url("http://charlie.me/a").is_none());
        assert!(web_url("https://user:pw@charlie.me/").is_none());
        assert!(web_url("javascript:alert(1)").is_none());
    }
}
