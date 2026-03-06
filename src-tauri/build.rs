use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn main() {
    tauri_build::build();
    println!("cargo:rerun-if-env-changed=BUCKY_IOS_STARTUP_SMOKE");

    #[cfg(target_os = "macos")]
    if matches!(env::var("CARGO_CFG_TARGET_OS").as_deref(), Ok("ios")) {
        setup_ios_audio_plugin().expect("failed to set up iOS audio plugin");
    }
}

#[cfg(target_os = "macos")]
fn setup_ios_audio_plugin() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let plugin_dir = manifest_dir.join("ios").join("AudioPlugin");

    println!("cargo:rerun-if-env-changed=DEP_TAURI_IOS_LIBRARY_PATH");
    println!("cargo:rerun-if-changed={}", plugin_dir.display());

    let tauri_library_path = PathBuf::from(env::var("DEP_TAURI_IOS_LIBRARY_PATH")?);
    let tauri_api_target = plugin_dir.join(".tauri").join("tauri-api");
    copy_dir_filtered(
        &tauri_library_path,
        &tauri_api_target,
        &[".build", "Package.resolved", "Tests"],
    )?;

    tauri_utils::build::link_apple_library("AudioPlugin", &plugin_dir);
    Ok(())
}

#[cfg(target_os = "macos")]
fn copy_dir_filtered(
    source: &Path,
    target: &Path,
    ignored_prefixes: &[&str],
) -> Result<(), Box<dyn std::error::Error>> {
    if target.exists() {
        fs::remove_dir_all(target)?;
    }
    fs::create_dir_all(target)?;
    copy_dir_filtered_inner(source, source, target, ignored_prefixes)
}

#[cfg(target_os = "macos")]
fn copy_dir_filtered_inner(
    root: &Path,
    source: &Path,
    target: &Path,
    ignored_prefixes: &[&str],
) -> Result<(), Box<dyn std::error::Error>> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        let rel = path.strip_prefix(root)?;
        let rel_text = rel.to_string_lossy();
        if ignored_prefixes
            .iter()
            .any(|prefix| rel_text.starts_with(prefix))
        {
            continue;
        }

        let dest = target.join(entry.file_name());
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            fs::create_dir_all(&dest)?;
            copy_dir_filtered_inner(root, &path, &dest, ignored_prefixes)?;
        } else {
            fs::copy(&path, &dest)?;
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
    Ok(())
}
