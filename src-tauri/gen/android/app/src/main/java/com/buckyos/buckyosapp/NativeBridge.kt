package com.buckyos.buckyosapp

import android.content.Context
import androidx.annotation.Keep
import com.buckyos.buckyosapp.notify.NotifyService

/**
 * Calls between Kotlin and the Rust library that do not go through Tauri: the answer is needed at
 * once (may this view go there?), or there is no Tauri in the process (`:notify`).
 */
@Keep
object NativeBridge {
  lateinit var context: Context
    private set

  init {
    System.loadLibrary("buckyosapp_lib")
  }

  fun attach(context: Context) {
    if (this::context.isInitialized) return
    this.context = context.applicationContext
    nativeInit()
  }

  // ---- Kotlin → Rust ----

  @JvmStatic private external fun nativeInit()

  /** The main process: what happened to the views, the activity, the player, the recorder. */
  @JvmStatic external fun onEvent(json: String)

  /** Whether a view may go to an address; Rust takes it from there when it may not. */
  @JvmStatic external fun onNavigate(view: String, url: String, mainFrame: Boolean, newWindow: Boolean): Boolean

  @JvmStatic external fun onCall(view: String, origin: String, mainFrame: Boolean, message: String, replyId: Long)

  /** A part of a Zone's file for the local pages; waits for the Zone (`LocalClient.kt`). */
  @JvmStatic external fun mediaRead(url: String, from: Long, length: Int): ByteArray?

  /** The `:notify` process. */
  @JvmStatic external fun serviceReload(dir: String)

  @JvmStatic external fun serviceWake()

  @JvmStatic external fun serviceFront(zone: String)

  // ---- Rust → Kotlin ----

  @JvmStatic fun secretGet(key: String): ByteArray? = Secrets.get(context, key)

  @JvmStatic fun secretSet(key: String, value: ByteArray) = Secrets.set(context, key, value)

  @JvmStatic fun secretDelete(key: String) = Secrets.delete(context, key)

  @JvmStatic fun serviceAlert(json: String) = NotifyService.alert(context, json)

  @JvmStatic fun serviceCancel(prefix: String) = NotifyService.cancelAlerts(context, prefix)

  @JvmStatic fun serviceKeep(zones: String) = NotifyService.keepAlerts(context, zones)

  @JvmStatic fun serviceState(json: String) = NotifyService.state(json)

  @JvmStatic fun serviceEnded() = NotifyService.ended()

  @JvmStatic fun serviceBusy(busy: Boolean) = NotifyService.busy(context, busy)
}
