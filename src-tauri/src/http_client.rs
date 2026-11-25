//! The client's own HTTPS requests trust what the system trusts, as its WebViews do: a Zone may use
//! a certificate of a private CA the user had the system trust.

/// Elsewhere the roots of the system are loaded by reqwest (`rustls-tls-native-roots`).
pub fn builder() -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder();
    #[cfg(target_os = "ios")]
    let builder = match system_tls() {
        Ok(config) => builder.use_preconfigured_tls(config),
        Err(error) => {
            log::error!("[http] the system's certificate check is not available: {error}");
            builder
        }
    };
    builder
}

/// Requests to the Zones take the ways the client's pages take (`route`); others go as they would
/// without.
pub fn zone_builder() -> reqwest::ClientBuilder {
    builder().proxy(reqwest::Proxy::custom(|url| {
        let host = url.host_str()?;
        let own = crate::route::current().and_then(|router| router.proxy_url(host));
        own.or_else(|| crate::route::net::system_proxy(host).map(|proxy| format!("http://{}:{}", proxy.host, proxy.port)))
    }))
}

/// iOS has no way to list the roots it trusts: the system checks each certificate chain.
#[cfg(target_os = "ios")]
fn system_tls() -> Result<rustls::ClientConfig, rustls::Error> {
    use rustls_platform_verifier::BuilderVerifierExt;

    // Named: more than one provider may be compiled in.
    let provider = std::sync::Arc::new(rustls::crypto::ring::default_provider());
    let mut config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()?
        .with_platform_verifier()?
        .with_no_client_auth();
    // reqwest leaves a configuration it was given as it is.
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    Ok(config)
}
