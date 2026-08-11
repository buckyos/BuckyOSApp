use buckyos_kit::BuckyOSMachineConfig;
use name_lib::{DidDocType, EncodedDocument, DID};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

use crate::error::{CommandErrors, CommandResult};

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

fn name_client_bridge_config(machine_config: BuckyOSMachineConfig) -> HashMap<String, String> {
    // `web3_bridge.bns` can point at the Web3 service, whose API is not the
    // DID HTTP resolver. NameClient's `bns` provider calls /1.0/identifiers,
    // so that entry must come from the dedicated machine-level bns_host.
    let bns_host = machine_config.bns_host_or_default().to_string();
    let bns_resolver = if machine_config.force_https
        || bns_host.starts_with("http://")
        || bns_host.starts_with("https://")
    {
        bns_host
    } else {
        format!("http://{bns_host}")
    };
    let mut bridge_config = machine_config.web3_bridge;
    bridge_config.insert("bns".to_string(), bns_resolver);
    bridge_config
}

#[tauri::command]
pub async fn resolve_did(
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

    // Name resolution follows the system-wide BuckyOS environment. Both the
    // bridge map and the DID resolver host come from machine.json.
    let web3_bridge =
        name_client_bridge_config(BuckyOSMachineConfig::load_machine_config().unwrap_or_default());
    name_client::init_name_lib(&web3_bridge)
        .await
        .map_err(|error| CommandErrors::internal(format!("name_client_init_failed: {error}")))?;

    match name_client::resolve_did(&did, doc_type).await {
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

        let bridge_config = name_client_bridge_config(machine_config);

        assert_eq!(
            bridge_config.get("bns").map(String::as_str),
            Some("bns.devtests.org")
        );
        assert_eq!(
            bridge_config.get("eth").map(String::as_str),
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

        let bridge_config = name_client_bridge_config(machine_config);

        assert_eq!(
            bridge_config.get("bns").map(String::as_str),
            Some("http://bns.devtests.org")
        );
    }
}
