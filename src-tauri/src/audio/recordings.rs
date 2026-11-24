//! Recordings of a phone's apps: one file and its description each, in a folder of the app.

use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use crate::content::shelf::short_hash;
use crate::zone::api::now_ms;

pub const MIME: &str = "audio/aac";
const MAX_CHUNK: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub mime: String,
    #[serde(default)]
    pub size: u64,
    /// Unknown when the recording was cut off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    pub created_at: u64,
}

/// The recordings of one app instance of one Zone.
pub struct Recordings {
    dir: PathBuf,
}

pub struct Chunk {
    pub recording: Recording,
    pub data: Vec<u8>,
    pub eof: bool,
}

fn is_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|ch| ch.is_ascii_alphanumeric())
}

impl Recordings {
    pub fn new(base: PathBuf, account: &str, zone: &str, app_instance: &str) -> Self {
        Self { dir: base.join("recordings").join(short_hash(&[account, zone, app_instance])) }
    }

    pub fn audio_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.aac"))
    }

    fn info_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.json"))
    }

    fn write(&self, recording: &Recording) -> std::io::Result<()> {
        std::fs::write(self.info_path(&recording.id), serde_json::to_vec(recording)?)
    }

    pub fn begin(&self, title: Option<String>) -> std::io::Result<Recording> {
        std::fs::create_dir_all(&self.dir)?;
        let recording = Recording {
            id: ulid::Ulid::new().to_string().to_ascii_lowercase(),
            title: title.map(|title| title.trim().chars().take(200).collect::<String>()).filter(|title| !title.is_empty()),
            mime: MIME.into(),
            size: 0,
            duration_ms: None,
            created_at: now_ms(),
        };
        self.write(&recording)?;
        Ok(recording)
    }

    /// `None` when there is no such recording, or nothing in it.
    pub fn get(&self, id: &str) -> Option<Recording> {
        if !is_id(id) {
            return None;
        }
        let mut recording: Recording = serde_json::from_slice(&std::fs::read(self.info_path(id)).ok()?).ok()?;
        recording.size = std::fs::metadata(self.audio_path(id)).ok()?.len();
        (recording.size > 0).then_some(recording)
    }

    pub fn finish(&self, id: &str, duration_ms: u64) -> Option<Recording> {
        let Some(mut recording) = self.get(id) else {
            self.delete(id);
            return None;
        };
        recording.duration_ms = Some(duration_ms);
        if let Err(error) = self.write(&recording) {
            log::warn!("[audio] a recording's description was not saved: {error}");
        }
        Some(recording)
    }

    /// The newest first; `except` is the one being made.
    pub fn list(&self, except: Option<&str>) -> Vec<Recording> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return Vec::new() };
        let mut recordings: Vec<Recording> = entries
            .flatten()
            .filter_map(|entry| entry.file_name().to_string_lossy().strip_suffix(".json").map(str::to_string))
            .filter(|id| Some(id.as_str()) != except)
            .filter_map(|id| self.get(&id))
            .collect();
        recordings.sort_by(|left, right| right.created_at.cmp(&left.created_at).then(right.id.cmp(&left.id)));
        recordings
    }

    pub fn read(&self, id: &str, offset: u64, length: u64) -> std::io::Result<Option<Chunk>> {
        let Some(recording) = self.get(id) else { return Ok(None) };
        let mut file = std::fs::File::open(self.audio_path(id))?;
        file.seek(SeekFrom::Start(offset))?;
        let mut data = Vec::new();
        file.take(length.min(MAX_CHUNK)).read_to_end(&mut data)?;
        let eof = offset.saturating_add(data.len() as u64) >= recording.size;
        Ok(Some(Chunk { recording, data, eof }))
    }

    pub fn delete(&self, id: &str) -> bool {
        if !is_id(id) {
            return false;
        }
        let _ = std::fs::remove_file(self.audio_path(id));
        std::fs::remove_file(self.info_path(id)).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("buckyosapp-recordings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_recording_is_made_read_and_deleted() {
        let dir = base("life");
        let store = Recordings::new(dir.clone(), "me", "did:bns:a", "notes@me");
        let made = store.begin(Some("  Talk ".into())).unwrap();
        assert!(store.get(&made.id).is_none(), "nothing recorded yet");
        std::fs::write(store.audio_path(&made.id), vec![7u8; 10]).unwrap();
        assert!(store.list(Some(&made.id)).is_empty());
        let done = store.finish(&made.id, 1500).unwrap();
        assert_eq!((done.title.as_deref(), done.size, done.duration_ms), (Some("Talk"), 10, Some(1500)));
        let first = store.read(&made.id, 0, 6).unwrap().unwrap();
        assert_eq!((first.data.len(), first.eof, first.recording.id == made.id), (6, false, true));
        let last = store.read(&made.id, 6, 100).unwrap().unwrap();
        assert_eq!((last.data.len(), last.eof), (4, true));
        assert_eq!(store.read(&made.id, 100, 1).unwrap().unwrap().data.len(), 0);
        assert!(store.delete(&made.id));
        assert!(!store.delete(&made.id));
        assert!(store.read(&made.id, 0, 1).unwrap().is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_empty_recording_does_not_stay() {
        let dir = base("empty");
        let store = Recordings::new(dir.clone(), "me", "z", "a");
        let made = store.begin(None).unwrap();
        assert!(store.finish(&made.id, 0).is_none());
        assert!(store.list(None).is_empty());
        assert!(!store.delete(&made.id));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn apps_and_zones_do_not_see_each_other() {
        let dir = base("apart");
        let mine = Recordings::new(dir.clone(), "me", "z", "a");
        let made = mine.begin(None).unwrap();
        std::fs::write(mine.audio_path(&made.id), b"1").unwrap();
        for other in [("me", "z", "b"), ("me", "y", "a"), ("you", "z", "a")] {
            let store = Recordings::new(dir.clone(), other.0, other.1, other.2);
            assert!(store.list(None).is_empty() && store.get(&made.id).is_none());
        }
        assert_eq!(mine.list(None).len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_id_is_not_a_path() {
        let store = Recordings::new(base("path"), "me", "z", "a");
        for id in ["", "..", "../x", "a/b", "a.json"] {
            assert!(store.get(id).is_none());
            assert!(!store.delete(id));
        }
    }
}
