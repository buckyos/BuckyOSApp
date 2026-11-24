//! Calls to and from Kotlin that do not go through Tauri (`NativeBridge.kt`).

use jni::objects::{GlobalRef, JByteArray, JClass, JObject, JString, JValue};
use jni::sys::{jboolean, jint, jlong};
use jni::{JNIEnv, JavaVM};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use crate::zone::secret::{SecretBackend, SecretStore};

struct Bridge {
    vm: JavaVM,
    class: GlobalRef,
}

static BRIDGE: OnceLock<Bridge> = OnceLock::new();

fn text(env: &mut JNIEnv, value: &JString) -> String {
    env.get_string(value).map(String::from).unwrap_or_default()
}

/// Calls a static method of `NativeBridge`; a Java exception becomes an error.
fn call<T>(work: impl FnOnce(&mut JNIEnv, &JClass) -> jni::errors::Result<T>) -> Result<T, String> {
    let bridge = BRIDGE.get().ok_or("the Java side is not attached")?;
    let mut env = bridge.vm.attach_current_thread().map_err(|error| error.to_string())?;
    let class: &JClass = bridge.class.as_obj().into();
    let result = work(&mut env, class);
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
        return Err("a Java exception".into());
    }
    result.map_err(|error| error.to_string())
}

fn call_text(method: &str, value: &str) {
    let done = call(|env, class| {
        let value = env.new_string(value)?;
        env.call_static_method(class, method, "(Ljava/lang/String;)V", &[JValue::Object(&value)])?;
        Ok(())
    });
    if let Err(error) = done {
        log::warn!("[android] {method}: {error}");
    }
}

pub fn show_alert(json: &str) {
    call_text("serviceAlert", json);
}

pub fn cancel_alerts(prefix: &str) {
    call_text("serviceCancel", prefix);
}

pub fn keep_alerts(zones: &str) {
    call_text("serviceKeep", zones);
}

pub fn service_state(json: &str) {
    call_text("serviceState", json);
}

pub fn service_busy(busy: bool) {
    let done = call(|env, class| {
        env.call_static_method(class, "serviceBusy", "(Z)V", &[JValue::Bool(busy as jboolean)])?;
        Ok(())
    });
    if let Err(error) = done {
        log::warn!("[android] serviceBusy: {error}");
    }
}

/// The notification service has nothing left to do.
pub fn service_ended() {
    let done = call(|env, class| {
        env.call_static_method(class, "serviceEnded", "()V", &[])?;
        Ok(())
    });
    if let Err(error) = done {
        log::warn!("[android] serviceEnded: {error}");
    }
}

/// Files encrypted with a key of the Android Keystore (`Secrets.kt`).
struct KeystoreBackend;

impl SecretBackend for KeystoreBackend {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        call(|env, class| {
            let key = env.new_string(key)?;
            let value = env
                .call_static_method(class, "secretGet", "(Ljava/lang/String;)[B", &[JValue::Object(&key)])?
                .l()?;
            if value.is_null() {
                return Ok(None);
            }
            env.convert_byte_array(JByteArray::from(value)).map(Some)
        })
    }

    fn set(&self, key: &str, value: &[u8]) -> Result<(), String> {
        call(|env, class| {
            let key = env.new_string(key)?;
            let value: JObject = env.byte_array_from_slice(value)?.into();
            env.call_static_method(class, "secretSet", "(Ljava/lang/String;[B)V", &[JValue::Object(&key), JValue::Object(&value)])?;
            Ok(())
        })
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        call(|env, class| {
            let key = env.new_string(key)?;
            env.call_static_method(class, "secretDelete", "(Ljava/lang/String;)V", &[JValue::Object(&key)])?;
            Ok(())
        })
    }
}

pub fn keystore() -> Arc<dyn SecretBackend> {
    Arc::new(KeystoreBackend)
}

pub fn secrets() -> SecretStore {
    SecretStore::new(keystore())
}

// ---- from Kotlin ----

fn guarded<T>(default: T, work: impl FnOnce() -> T) -> T {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)).unwrap_or_else(|_| {
        log::error!("[android] a call from Kotlin panicked");
        default
    })
}

/// Where this system keeps the certificates it trusts; a WebView uses the same. Must run before
/// the first request of the process.
fn trust_system_certificates() {
    const FOLDERS: [&str; 2] = ["/apex/com.android.conscrypt/cacerts", "/system/etc/security/cacerts"];
    if let Some(folder) = FOLDERS.iter().find(|folder| std::path::Path::new(folder).is_dir()) {
        std::env::set_var("SSL_CERT_DIR", folder);
    }
}

#[no_mangle]
extern "system" fn Java_com_buckyos_buckyosapp_NativeBridge_nativeInit(env: JNIEnv, class: JClass) {
    trust_system_certificates();
    if let (Ok(vm), Ok(class)) = (env.get_java_vm(), env.new_global_ref(class)) {
        let _ = BRIDGE.set(Bridge { vm, class });
    }
}

#[no_mangle]
extern "system" fn Java_com_buckyos_buckyosapp_NativeBridge_onEvent(mut env: JNIEnv, _class: JClass, json: JString) {
    let json = text(&mut env, &json);
    guarded((), || crate::content::mobile::on_event(&json));
}

#[no_mangle]
extern "system" fn Java_com_buckyos_buckyosapp_NativeBridge_onNavigate(
    mut env: JNIEnv,
    _class: JClass,
    view: JString,
    url: JString,
    main_frame: jboolean,
    new_window: jboolean,
) -> jboolean {
    let (view, url) = (text(&mut env, &view), text(&mut env, &url));
    guarded(false, || crate::content::mobile::on_navigate(&view, &url, main_frame != 0, new_window != 0)) as jboolean
}

#[no_mangle]
extern "system" fn Java_com_buckyos_buckyosapp_NativeBridge_onCall(
    mut env: JNIEnv,
    _class: JClass,
    view: JString,
    origin: JString,
    main_frame: jboolean,
    message: JString,
    reply_id: jlong,
) {
    let (view, origin, message) = (text(&mut env, &view), text(&mut env, &origin), text(&mut env, &message));
    guarded((), || crate::content::mobile::on_call(view, origin, main_frame != 0, message, reply_id));
}

#[no_mangle]
extern "system" fn Java_com_buckyos_buckyosapp_NativeBridge_mediaRead<'a>(
    mut env: JNIEnv<'a>,
    _class: JClass<'a>,
    url: JString<'a>,
    from: jlong,
    length: jint,
) -> JByteArray<'a> {
    let url = text(&mut env, &url);
    let packed = guarded(None, || crate::content::mobile::read_media(&url, from.max(0) as u64, length.max(0) as u64));
    packed
        .and_then(|packed| env.byte_array_from_slice(&packed).ok())
        .unwrap_or_else(|| JObject::null().into())
}

#[no_mangle]
extern "system" fn Java_com_buckyos_buckyosapp_NativeBridge_serviceReload(mut env: JNIEnv, _class: JClass, dir: JString) {
    let dir = PathBuf::from(text(&mut env, &dir));
    guarded((), || crate::notify::service::reload(dir));
}

#[no_mangle]
extern "system" fn Java_com_buckyos_buckyosapp_NativeBridge_serviceWake(_env: JNIEnv, _class: JClass) {
    guarded((), crate::notify::service::wake);
}

#[no_mangle]
extern "system" fn Java_com_buckyos_buckyosapp_NativeBridge_serviceFront(mut env: JNIEnv, _class: JClass, zone: JString) {
    let zone = text(&mut env, &zone);
    guarded((), || crate::notify::service::front(zone));
}

/// The log of a process without Tauri goes to logcat.
pub fn init_log() {
    struct Logcat;
    impl log::Log for Logcat {
        fn enabled(&self, metadata: &log::Metadata) -> bool {
            metadata.level() <= log::Level::Info
        }
        fn log(&self, record: &log::Record) {
            if !self.enabled(record.metadata()) {
                return;
            }
            let priority = match record.level() {
                log::Level::Error => 6,
                log::Level::Warn => 5,
                _ => 4,
            };
            let line = std::ffi::CString::new(record.args().to_string().replace('\0', " ")).unwrap_or_default();
            extern "C" {
                fn __android_log_write(priority: i32, tag: *const std::ffi::c_char, text: *const std::ffi::c_char) -> i32;
            }
            // SAFETY: both strings end with a NUL and live through the call.
            unsafe {
                __android_log_write(priority, c"BuckyOS".as_ptr(), line.as_ptr());
            }
        }
        fn flush(&self) {}
    }
    static LOGCAT: Logcat = Logcat;
    if log::set_logger(&LOGCAT).is_ok() {
        log::set_max_level(log::LevelFilter::Info);
    }
}
