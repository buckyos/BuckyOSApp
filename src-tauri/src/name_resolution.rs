use buckyos_kit::BuckyOSMachineConfig;
use name_lib::{DidDocType, EncodedDocument, DID};
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;
use tokio::sync::OnceCell;

use crate::config::get_service_endpoints;
use crate::error::{CommandErrors, CommandResult};

static NAME_CLIENT: OnceCell<name_client::NameClient> = OnceCell::const_new();

/// IPC representation of buckyos-websdk's `namelib.EncodedDocument`.
///
/// Rust's externally-tagged enum would serialize as `{ "JsonLd": ... }` or
/// `{ "Jwt": ... }`, which is intentionally converted here to the WebSDK's
/// discriminated union shape.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum WebEncodedDocument {
    Json { value: Value },
    Jwt { jwt: String },
}

impl From<EncodedDocument> for WebEncodedDocument {
    fn from(document: EncodedDocument) -> Self {
        match document {
            EncodedDocument::JsonLd(value) => Self::Json { value },
            EncodedDocument::Jwt(jwt) => Self::Jwt { jwt },
        }
    }
}

fn name_client_config(
    machine_config: Option<BuckyOSMachineConfig>,
    app_bns_url: &str,
) -> BuckyOSMachineConfig {
    // The DID HTTP resolver is independent of the Web3 hostname bridge.
    // Prefer an explicit machine resolver; otherwise use the App BNS endpoint.
    let bns_host = machine_config
        .as_ref()
        .and_then(|config| config.bns_host.as_deref())
        .map(str::trim)
        .filter(|host| !host.is_empty())
        .unwrap_or(app_bns_url)
        .to_string();
    let mut machine_config = machine_config.unwrap_or_default();
    let bns_resolver = if machine_config.force_https
        || bns_host.starts_with("http://")
        || bns_host.starts_with("https://")
    {
        bns_host
    } else {
        format!("http://{bns_host}")
    };
    machine_config.bns_host = Some(bns_resolver);
    machine_config
}

#[tauri::command]
pub async fn resolve_did(
    app_handle: AppHandle,
    did: String,
    doc_type: Option<String>,
) -> CommandResult<WebEncodedDocument> {
    let did = did.trim();
    let mut did_parts = did.splitn(3, ':');
    if did_parts.next() != Some("did")
        || !matches!(did_parts.next(), Some(part) if !part.is_empty())
        || !matches!(did_parts.next(), Some(part) if !part.is_empty())
    {
        return Err(CommandErrors::internal("invalid_did"));
    }
    let did = DID::from_str(did)
        .map_err(|error| CommandErrors::internal(format!("invalid_did: {error}")))?;
    let doc_type = doc_type
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(DidDocType::from);

    let endpoints = get_service_endpoints(app_handle)?;
    let config = name_client_config(
        BuckyOSMachineConfig::load_machine_config(),
        &endpoints.bns_api_url,
    );
    let client = NAME_CLIENT
        .get_or_try_init(|| async {
            let _ = name_lib::KNOWN_WEB3_BRIDGE_CONFIG.set(config.web3_bridge.clone());
            let client = name_client::NameClient::new(name_client::NameClientConfig::default());
            let provider = name_client::BnsProvider::new_with_config(serde_json::json!({
                "bns_host": config.bns_host
            }))?;
            client.set_method_authority("bns", Box::new(provider)).await;
            client
                .set_method_authority("web", Box::new(name_client::WebProvider::new()))
                .await;
            client
                .add_method_supplement("bns", Box::new(name_client::WebProvider::new()))
                .await;
            for method in ["bns", "web"] {
                client
                    .add_current_zone_bootstrap_supplement(
                        method,
                        Box::new(name_client::DnsProvider::new(None)),
                    )
                    .await;
                if let Some(sn_host) = config.web3_bridge.get("sn") {
                    client
                        .add_method_supplement(
                            method,
                            Box::new(name_client::BaseHttpProvider::new(sn_host)),
                        )
                        .await;
                }
            }
            client
                .add_dns_provider(Box::new(name_client::DnsProvider::new(None)))
                .await;
            Ok::<name_client::NameClient, name_lib::NSError>(client)
        })
        .await
        .map_err(|error| CommandErrors::internal(format!("name_client_init_failed: {error}")))?;

    match client.resolve_did(&did, doc_type).await {
        Ok(document) => Ok(WebEncodedDocument::from(document)),
        Err(name_lib::NSError::NotFound(error)) => Err(CommandErrors::not_found(format!(
            "resolve_did_not_found: {error}"
        ))),
        Err(error) => Err(CommandErrors::internal(format!(
            "resolve_did_failed: {error}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_json_document_as_websdk_encoded_document() {
        let document = WebEncodedDocument::from(EncodedDocument::JsonLd(json!({
            "id": "did:bns:alice"
        })));

        assert_eq!(
            serde_json::to_value(document).unwrap(),
            json!({
                "type": "json",
                "value": { "id": "did:bns:alice" }
            })
        );
    }

    #[test]
    fn serializes_jwt_document_as_websdk_encoded_document() {
        let document = WebEncodedDocument::from(EncodedDocument::Jwt("a.b.c".to_string()));

        assert_eq!(
            serde_json::to_value(document).unwrap(),
            json!({ "type": "jwt", "jwt": "a.b.c" })
        );
    }

    #[test]
    fn uses_machine_bns_host_for_the_name_client_resolver() {
        let machine_config = serde_json::from_value::<BuckyOSMachineConfig>(json!({
            "web3_bridge": {
                "bns": "web3.devtests.org",
                "eth": "eth.devtests.org"
            },
            "bns_host": "bns.devtests.org"
        }))
        .unwrap();

        let config = name_client_config(Some(machine_config), "https://bns.buckyos.ai");

        assert_eq!(config.bns_host.as_deref(), Some("bns.devtests.org"));
        assert_eq!(
            config.web3_bridge.get("bns").map(String::as_str),
            Some("web3.devtests.org")
        );
        assert_eq!(
            config.web3_bridge.get("eth").map(String::as_str),
            Some("eth.devtests.org")
        );
    }

    #[test]
    fn uses_http_when_machine_config_disables_forced_https() {
        let machine_config = serde_json::from_value::<BuckyOSMachineConfig>(json!({
            "web3_bridge": {
                "bns": "web3.devtests.org"
            },
            "bns_host": "bns.devtests.org",
            "force_https": false
        }))
        .unwrap();

        let config = name_client_config(Some(machine_config), "https://bns.buckyos.ai");

        assert_eq!(config.bns_host.as_deref(), Some("http://bns.devtests.org"));
    }

    #[test]
    fn missing_machine_config_uses_the_app_bns_endpoint() {
        let config = name_client_config(None, "https://bns.buckyos.ai");
        assert_eq!(config.bns_host.as_deref(), Some("https://bns.buckyos.ai"));
        assert_eq!(
            config.web3_bridge.get("bns").map(String::as_str),
            Some("web3.buckyos.ai")
        );
    }

    #[test]
    fn missing_or_blank_machine_bns_host_uses_the_configured_app_endpoint() {
        for bns_host in [None, Some(""), Some("   ")] {
            let machine_config = serde_json::from_value::<BuckyOSMachineConfig>(json!({
                "bns_host": bns_host,
                "web3_bridge": { "bns": "web3.devtests.org", "eth": "eth.devtests.org" }
            }))
            .unwrap();
            let config = name_client_config(Some(machine_config), "https://bns.devtests.org");
            assert_eq!(config.bns_host.as_deref(), Some("https://bns.devtests.org"));
            assert_eq!(
                config.web3_bridge.get("bns").map(String::as_str),
                Some("web3.devtests.org")
            );
            assert_eq!(
                config.web3_bridge.get("eth").map(String::as_str),
                Some("eth.devtests.org")
            );
        }
    }
}
