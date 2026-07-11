use name_lib::{DidDocType, EncodedDocument, DID};
use serde::Serialize;
use serde_json::Value;

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

    // NameClient's production defaults use the machine-level filesystem cache.
    // Initialization is idempotent and concurrency-safe inside name-client.
    let web3_bridge = name_client::get_default_web3_bridge_config();
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
}
