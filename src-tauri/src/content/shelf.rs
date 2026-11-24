//! Which content views of a phone keep their WebView.

use reqwest::Url;
use sha2::{Digest, Sha256};

/// Besides the tabs of the navigation, which always keep theirs.
pub const MAX_KEPT: usize = 5;

pub struct Shelved<'a> {
    pub id: &'a str,
    pub last_active: u64,
    /// In front, playing or recording.
    pub held: bool,
}

/// The views to take the WebView from, the least recently used first. `views` are those that have
/// one and may lose it.
pub fn to_discard(views: &[Shelved<'_>], keep: usize) -> Vec<String> {
    let over = views.len().saturating_sub(keep);
    let mut spare: Vec<&Shelved> = views.iter().filter(|view| !view.held).collect();
    spare.sort_by_key(|view| view.last_active);
    spare.into_iter().take(over).map(|view| view.id.to_string()).collect()
}

/// The WebView profile of an account's Zone.
pub fn profile_name(account: &str, zone: &str) -> String {
    format!("zone-{}", short_hash(&[account, zone]))
}

/// A name for a file or a profile out of things that are not one.
pub fn short_hash(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part.as_bytes());
    }
    hex::encode(&hasher.finalize()[..16])
}

pub fn page_path(url: &Url) -> String {
    let mut path = url.path().to_string();
    if let Some(query) = url.query() {
        path.push('?');
        path.push_str(query);
    }
    if let Some(fragment) = url.fragment() {
        path.push('#');
        path.push_str(fragment);
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(id: &str, last_active: u64, held: bool) -> Shelved<'_> {
        Shelved { id, last_active, held }
    }

    #[test]
    fn the_least_recently_used_goes_first() {
        let views = [view("a", 3, false), view("b", 1, false), view("c", 2, false)];
        assert_eq!(to_discard(&views, 2), ["b"]);
        assert_eq!(to_discard(&views, 1), ["b", "c"]);
        assert!(to_discard(&views, 3).is_empty());
        assert!(to_discard(&views, MAX_KEPT).is_empty());
    }

    #[test]
    fn what_is_in_use_stays() {
        let views = [view("a", 3, true), view("b", 1, true), view("c", 2, false)];
        assert_eq!(to_discard(&views, 0), ["c"]);
        assert_eq!(to_discard(&views, 2), ["c"]);
    }

    #[test]
    fn names_do_not_run_together() {
        assert_ne!(profile_name("ab", "c"), profile_name("a", "bc"));
        assert_eq!(profile_name("a", "b"), profile_name("a", "b"));
        assert_eq!(profile_name("did:bns:bob", "did:bns:bob").len(), "zone-".len() + 32);
    }

    #[test]
    fn a_page_is_its_path_query_and_fragment() {
        assert_eq!(page_path(&Url::parse("https://a.b/c?d=1#e").unwrap()), "/c?d=1#e");
        assert_eq!(page_path(&Url::parse("https://a.b").unwrap()), "/");
    }
}
