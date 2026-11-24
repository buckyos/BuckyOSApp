//! Zone files for the local pages' `<audio>`: a local page carries no Zone cookies, so a custom
//! scheme fetches them with the client's session, a piece at a time.
//!
//! `zonemedia://localhost/<zone DID>/<path on the Zone root>`; on Windows and Android the same
//! under `http://zonemedia.localhost/`.

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use super::api::HttpRequest;
use super::ZoneManager;

pub const SCHEME: &str = "zonemedia";
/// Media elements ask again for what comes after the piece they got.
const PIECE_BYTES: u64 = 1024 * 1024;
const PASSED: &[&str] = &["content-type", "content-range", "content-length", "accept-ranges", "etag", "last-modified"];

fn plain(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(status).body(Vec::new()).expect("a plain response")
}

/// The Zone and the path on its root out of a media address.
fn target(uri: &tauri::http::Uri) -> Option<(String, String)> {
    let path = uri.path().strip_prefix('/')?;
    let (zone, rest) = path.split_once('/')?;
    let zone = percent_decode(zone)?;
    if !zone.starts_with("did:") || rest.is_empty() || rest.starts_with('/') {
        return None;
    }
    let query = uri.query().map(|query| format!("?{query}")).unwrap_or_default();
    Some((zone, format!("/{rest}{query}")))
}

fn percent_decode(text: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(text.len());
    let mut rest = text.bytes();
    while let Some(byte) = rest.next() {
        if byte == b'%' {
            let digits = [rest.next()?, rest.next()?];
            bytes.push(u8::from_str_radix(std::str::from_utf8(&digits).ok()?, 16).ok()?);
        } else {
            bytes.push(byte);
        }
    }
    String::from_utf8(bytes).ok()
}

/// The piece to ask the Zone for: where the request starts, at most `PIECE_BYTES` long.
fn piece(range: Option<&str>) -> String {
    let (start, end) = range
        .and_then(|range| range.trim().strip_prefix("bytes="))
        .and_then(|range| range.split_once('-'))
        .map(|(start, end)| (start.trim().parse::<u64>().ok(), end.trim().parse::<u64>().ok()))
        .unwrap_or((Some(0), None));
    match (start, end) {
        (Some(start), end) => {
            let last = start + PIECE_BYTES - 1;
            format!("bytes={start}-{}", end.map_or(last, |end| end.min(last)))
        }
        // the last N bytes
        (None, Some(length)) => format!("bytes=-{}", length.min(PIECE_BYTES)),
        (None, None) => format!("bytes=0-{}", PIECE_BYTES - 1),
    }
}

async fn fetch<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() != tauri::http::Method::GET {
        return plain(StatusCode::METHOD_NOT_ALLOWED);
    }
    let Some((zone, path)) = target(request.uri()) else {
        return plain(StatusCode::BAD_REQUEST);
    };
    let manager = app.state::<ZoneManager>();
    let Ok(handle) = manager.handle(app, &zone) else {
        return plain(StatusCode::NOT_FOUND);
    };
    let range = request.headers().get(header::RANGE).and_then(|value| value.to_str().ok());
    let answer = manager
        .sessions
        .fetch(
            &handle.key,
            handle.host(),
            HttpRequest {
                method: "GET".into(),
                url: format!("https://{}{path}", handle.host()),
                headers: vec![("Range".into(), piece(range))],
                body: None,
            },
        )
        .await;
    match answer {
        Ok(answer) => {
            let status = StatusCode::from_u16(answer.status).unwrap_or(StatusCode::BAD_GATEWAY);
            let mut response = Response::builder().status(status);
            for (name, value) in &answer.headers {
                if PASSED.iter().any(|passed| name.eq_ignore_ascii_case(passed)) {
                    response = response.header(name, value);
                }
            }
            if let Some(origin) = request.headers().get(header::ORIGIN) {
                response = response.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.clone());
            }
            response
                .body(answer.body)
                .unwrap_or_else(|_| plain(StatusCode::BAD_GATEWAY))
        }
        Err(error) => {
            log::info!("[media] {error}");
            plain(StatusCode::BAD_GATEWAY)
        }
    }
}

/// A part of a file, with the size of the whole.
#[cfg(target_os = "android")]
pub struct Part {
    pub status: u16,
    pub content_type: String,
    pub total: u64,
    pub data: Vec<u8>,
}

/// `None` when the Zone could not be reached. Android's WebView cannot use `respond`
/// (`LocalClient.kt`).
#[cfg(target_os = "android")]
pub async fn read<R: Runtime>(app: &AppHandle<R>, url: &str, from: u64, length: u64) -> Option<Part> {
    let uri: tauri::http::Uri = url.parse().ok()?;
    let plain = |status| Part { status, content_type: String::new(), total: 0, data: Vec::new() };
    let Some((zone, path)) = target(&uri) else { return Some(plain(400)) };
    let manager = app.state::<ZoneManager>();
    let Ok(handle) = manager.handle(app, &zone) else { return Some(plain(404)) };
    let request = HttpRequest {
        method: "GET".into(),
        url: format!("https://{}{path}", handle.host()),
        headers: vec![("Range".into(), format!("bytes={from}-{}", from + length.max(1) - 1))],
        body: None,
    };
    let answer = manager
        .sessions
        .fetch(&handle.key, handle.host(), request)
        .await
        .map_err(|error| log::info!("[media] {error}"))
        .ok()?;
    let header = |name: &str| answer.headers.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)).map(|(_, value)| value.clone());
    let total = header("content-range")
        .and_then(|range| range.rsplit('/').next()?.parse().ok())
        .unwrap_or(answer.body.len() as u64);
    Some(Part { status: answer.status, content_type: header("content-type").unwrap_or_default(), total, data: answer.body })
}

const LOCAL_ORIGINS: &[&str] = &["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];

/// A frame inside the window asks from its own origin, and only its own could read an answer that
/// names no other.
fn asked_by_local_page(request: &Request<Vec<u8>>) -> bool {
    let from = |name: header::HeaderName| request.headers().get(name).and_then(|value| value.to_str().ok());
    let local = |value: &str| {
        tauri::is_dev() || LOCAL_ORIGINS.iter().any(|origin| value == *origin || value.starts_with(&format!("{origin}/")))
    };
    from(header::ORIGIN).is_none_or(local) && from(header::REFERER).is_none_or(local)
}

pub fn respond<R: Runtime>(context: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    // Only the local pages: a Zone page could otherwise reach any Zone of the account.
    if context.webview_label() != "main" || !asked_by_local_page(&request) {
        responder.respond(plain(StatusCode::FORBIDDEN));
        return;
    }
    let app = context.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        // wry gives an Android WebView ten seconds and ends the process after that.
        #[cfg(target_os = "android")]
        let response = tokio::time::timeout(std::time::Duration::from_secs(8), fetch(&app, &request))
            .await
            .unwrap_or_else(|_| plain(StatusCode::GATEWAY_TIMEOUT));
        #[cfg(not(target_os = "android"))]
        let response = fetch(&app, &request).await;
        responder.respond(response);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_address_names_its_zone() {
        let parse = |uri: &str| target(&uri.parse().unwrap());
        assert_eq!(
            parse("zonemedia://localhost/did%3Aweb%3Acharlie.me/nfs/v1/a%20b.mp3?x=1"),
            Some(("did:web:charlie.me".into(), "/nfs/v1/a%20b.mp3?x=1".into()))
        );
        assert_eq!(parse("zonemedia://localhost/did%3Aweb%3Acharlie.me//evil.example/"), None);
        assert_eq!(parse("zonemedia://localhost/charlie.me/a"), None);
        assert_eq!(parse("zonemedia://localhost/did%3Abns%3Aa"), None);
    }

    #[test]
    fn pieces_are_bounded() {
        assert_eq!(piece(None), "bytes=0-1048575");
        assert_eq!(piece(Some("bytes=0-")), "bytes=0-1048575");
        assert_eq!(piece(Some("bytes=100-199")), "bytes=100-199");
        assert_eq!(piece(Some("bytes=5-99999999")), "bytes=5-1048580");
        assert_eq!(piece(Some("bytes=-500")), "bytes=-500");
        assert_eq!(piece(Some("nonsense")), "bytes=0-1048575");
    }
}
