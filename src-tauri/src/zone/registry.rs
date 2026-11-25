//! The Zones each account can use, and which one it is looking at.
//!
//! Stored apart from the wallet vault. Two sources (TODO Q3): the Zone list of the account's owner
//! document, and Zones the user added by signing in.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::host::{find_zone, normalize_host};
use crate::route::RouteMemory;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ZoneSource {
    /// The owner document lists it.
    Owner,
    /// Added by hand.
    Manual,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ZoneRecord {
    pub did: String,
    pub host: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    /// The account's own accent color for this Zone (`#RRGGBB`), as last read.
    #[serde(default)]
    pub accent: Option<String>,
    pub source: ZoneSource,
    #[serde(default = "default_true")]
    pub notify: bool,
    /// A Zone of the owner document the user took off the list.
    #[serde(default)]
    pub hidden: bool,
    /// The user signed out: only the user signs in again.
    #[serde(default)]
    pub signed_out: bool,
    #[serde(default)]
    pub route: RouteMemory,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AccountZones {
    #[serde(default)]
    pub zones: Vec<ZoneRecord>,
    #[serde(default)]
    pub current: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Registry {
    #[serde(default)]
    pub accounts: HashMap<String, AccountZones>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OwnerZone {
    pub did: String,
    pub host: String,
}

impl AccountZones {
    pub fn visible(&self) -> impl Iterator<Item = &ZoneRecord> {
        self.zones.iter().filter(|zone| !zone.hidden)
    }

    pub fn get(&self, did: &str) -> Option<&ZoneRecord> {
        self.visible().find(|zone| zone.did == did)
    }

    pub fn get_mut(&mut self, did: &str) -> Option<&mut ZoneRecord> {
        self.zones.iter_mut().find(|zone| zone.did == did && !zone.hidden)
    }

    pub fn by_host(&self, host: &str) -> Option<&ZoneRecord> {
        let host = normalize_host(host);
        let zones: Vec<&ZoneRecord> = self.visible().collect();
        find_zone(&host, zones.iter().map(|zone| zone.host.as_str())).map(|index| zones[index])
    }

    fn fix_current(&mut self) {
        let valid = self
            .current
            .as_deref()
            .is_some_and(|did| self.visible().any(|zone| zone.did == did));
        if !valid {
            let first = self.visible().next().map(|zone| zone.did.clone());
            self.current = first;
        }
    }

    /// Puts a signed-in Zone on the list (again).
    pub fn add(&mut self, did: &str, host: &str) {
        let host = normalize_host(host);
        match self.zones.iter_mut().find(|zone| zone.did == did) {
            Some(zone) => {
                zone.host = host;
                zone.hidden = false;
                zone.signed_out = false;
            }
            None => self.zones.push(ZoneRecord {
                did: did.to_string(),
                host,
                name: None,
                icon: None,
                accent: None,
                source: ZoneSource::Manual,
                notify: true,
                hidden: false,
                signed_out: false,
                route: RouteMemory::default(),
            }),
        }
        self.fix_current();
    }

    /// The owner document's Zone list as it is now. A Zone that left it goes off the list unless
    /// the user added it by hand; one the user hid stays hidden.
    pub fn sync_owner(&mut self, owner_zones: &[OwnerZone]) -> Vec<ZoneRecord> {
        let listed = |did: &str| owner_zones.iter().any(|zone| zone.did == did);
        let removed = self
            .zones
            .iter()
            .filter(|zone| zone.source == ZoneSource::Owner && !listed(&zone.did))
            .cloned()
            .collect::<Vec<_>>();
        self.zones.retain(|zone| !removed.iter().any(|gone| gone.did == zone.did));
        for owner_zone in owner_zones {
            let host = normalize_host(&owner_zone.host);
            match self.zones.iter_mut().find(|zone| zone.did == owner_zone.did) {
                Some(zone) => {
                    zone.host = host;
                    zone.source = ZoneSource::Owner;
                }
                None => self.zones.push(ZoneRecord {
                    did: owner_zone.did.clone(),
                    host,
                    name: None,
                    icon: None,
                    accent: None,
                    source: ZoneSource::Owner,
                    notify: true,
                    hidden: false,
                    signed_out: false,
                    route: RouteMemory::default(),
                }),
            }
        }
        self.fix_current();
        removed
    }

    pub fn remove(&mut self, did: &str) -> Option<ZoneRecord> {
        let index = self.zones.iter().position(|zone| zone.did == did)?;
        let record = self.zones[index].clone();
        if record.source == ZoneSource::Owner {
            self.zones[index].hidden = true;
        } else {
            self.zones.remove(index);
        }
        self.fix_current();
        Some(record)
    }

    pub fn set_current(&mut self, did: &str) -> bool {
        if self.get(did).is_none() {
            return false;
        }
        self.current = Some(did.to_string());
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner(did: &str, host: &str) -> OwnerZone {
        OwnerZone { did: did.into(), host: host.into() }
    }

    #[test]
    fn owner_zones_come_and_go_with_the_owner_document() {
        let mut account = AccountZones::default();
        account.sync_owner(&[owner("did:bns:alice", "Alice.example.")]);
        assert_eq!(account.current.as_deref(), Some("did:bns:alice"));
        assert_eq!(account.get("did:bns:alice").unwrap().host, "alice.example");
        account.add("did:web:team.org", "team.org");
        assert!(account.set_current("did:web:team.org"));
        let removed = account.sync_owner(&[]);
        assert_eq!(removed.iter().map(|zone| zone.host.as_str()).collect::<Vec<_>>(), ["alice.example"]);
        assert!(account.get("did:bns:alice").is_none());
        assert_eq!(account.current.as_deref(), Some("did:web:team.org"));
    }

    #[test]
    fn a_removed_owner_zone_stays_hidden_until_added_again() {
        let mut account = AccountZones::default();
        account.sync_owner(&[owner("did:bns:alice", "alice.example")]);
        account.remove("did:bns:alice");
        assert!(account.get("did:bns:alice").is_none());
        assert_eq!(account.current, None);
        account.sync_owner(&[owner("did:bns:alice", "alice.example")]);
        assert!(account.get("did:bns:alice").is_none());
        account.add("did:bns:alice", "alice.example");
        assert_eq!(account.get("did:bns:alice").unwrap().source, ZoneSource::Owner);
        assert_eq!(account.current.as_deref(), Some("did:bns:alice"));
    }

    #[test]
    fn finds_the_zone_of_a_host() {
        let mut account = AccountZones::default();
        account.add("did:web:example.org", "example.org");
        account.add("did:web:team.example.org", "team.example.org");
        assert_eq!(account.by_host("notes.team.example.org").unwrap().did, "did:web:team.example.org");
        assert_eq!(account.by_host("notes.example.org").unwrap().did, "did:web:example.org");
        assert!(account.by_host("evil.org").is_none());
        account.remove("did:web:team.example.org");
        assert_eq!(account.by_host("notes.team.example.org").unwrap().did, "did:web:example.org");
    }

    #[test]
    fn the_current_zone_must_be_on_the_list() {
        let mut account = AccountZones::default();
        assert!(!account.set_current("did:bns:nobody"));
        account.add("did:bns:alice", "alice.example");
        account.add("did:bns:bob", "bob.example");
        account.set_current("did:bns:bob");
        account.remove("did:bns:bob");
        assert_eq!(account.current.as_deref(), Some("did:bns:alice"));
    }
}
