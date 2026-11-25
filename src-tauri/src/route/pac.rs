//! The proxy auto-configuration: pages of the Zones go through the client, everything else as if
//! there were no client.

/// What the system is set to use for everything else (Windows).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SystemSettings {
    /// `host:port`, or `http=host:port;https=host:port;socks=host:port`.
    pub server: String,
    /// Hosts that do without, `*` being a wildcard; `<local>` for names without a dot.
    pub bypass: Vec<String>,
}

impl SystemSettings {
    /// What a script answers for addresses of a scheme.
    fn answer(&self, scheme: &str) -> Option<String> {
        if !self.server.contains('=') {
            return (!self.server.is_empty()).then(|| format!("PROXY {}", strip(&self.server)));
        }
        let of = |wanted: &str| {
            self.server.split(';').filter_map(|part| part.split_once('=')).find(|(name, _)| name.trim().eq_ignore_ascii_case(wanted)).map(|(_, server)| strip(server))
        };
        of(scheme).map(|server| format!("PROXY {server}")).or_else(|| of("socks").map(|server| format!("SOCKS {server}")))
    }
}

fn strip(server: &str) -> String {
    let server = server.trim();
    server.split_once("://").map_or(server, |(_, rest)| rest).trim_end_matches('/').to_string()
}

fn quoted<T: serde::Serialize + ?Sized>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".into())
}

/// `hosts` are the Zones' own host names; all below them are theirs too. Below `family` there may
/// be others by the time the script is used.
pub fn script(hosts: &[String], family: Option<&str>, port: u16, system: Option<&SystemSettings>) -> String {
    let system = system.cloned().unwrap_or_default();
    let direct = || "DIRECT".to_string();
    format!(
        r#"var zones = {zones};
var family = {family};
var bypass = {bypass};
function FindProxyForURL(url, host) {{
  host = host.toLowerCase();
  var plain = url.substring(0, 5) === "http:" || url.substring(0, 3) === "ws:";
  var port = /^[a-z]+:\/\/[^\/]*:(\d+)(\/|$)/.exec(url);
  if (!plain && (!port || port[1] === "443")) {{
    for (var i = 0; i < zones.length; i++) {{
      if (host === zones[i] || dnsDomainIs(host, "." + zones[i])) return "PROXY 127.0.0.1:{port}";
    }}
    if (family && dnsDomainIs(host, "." + family)) return "PROXY 127.0.0.1:{port}";
  }}
  for (var j = 0; j < bypass.length; j++) {{
    if (bypass[j] === "<local>" ? isPlainHostName(host) : shExpMatch(host, bypass[j])) return "DIRECT";
  }}
  return plain ? {http} : {https};
}}
"#,
        zones = quoted(hosts),
        family = quoted(&family),
        bypass = quoted(&system.bypass),
        http = quoted(&system.answer("http").unwrap_or_else(direct)),
        https = quoted(&system.answer("https").unwrap_or_else(direct)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_zones_and_the_port() {
        let text = script(&["bob.example".into(), "charlie.me".into()], Some("sn.example"), 4711, None);
        assert!(text.contains(r#"var zones = ["bob.example","charlie.me"];"#));
        assert!(text.contains(r#"return "PROXY 127.0.0.1:4711";"#));
        assert!(text.contains(r#"var family = "sn.example";"#));
        assert!(text.contains(r#"return plain ? "DIRECT" : "DIRECT";"#));
    }

    #[test]
    fn keeps_to_the_systems_proxy_for_the_rest() {
        let one = SystemSettings { server: "http://proxy.corp:8080/".into(), bypass: vec!["*.corp".into(), "<local>".into()] };
        let text = script(&[], None, 1, Some(&one));
        assert!(text.contains(r#"return plain ? "PROXY proxy.corp:8080" : "PROXY proxy.corp:8080";"#));
        assert!(text.contains(r#"var bypass = ["*.corp","<local>"];"#));
        let several = SystemSettings { server: "http=a:1;socks=c:3".into(), bypass: vec![] };
        assert!(script(&[], None, 1, Some(&several)).contains(r#"return plain ? "PROXY a:1" : "SOCKS c:3";"#));
    }
}
