package com.buckyos.buckyosapp.content

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.webkit.ValueCallback
import android.webkit.WebChromeClient.FileChooserParams
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/** `<input type="file">` of a content view. Made with the activity: results need it from the start. */
class FileChooser(activity: AppCompatActivity) {
  private var waiting: ValueCallback<Array<Uri>>? = null

  private val launcher = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    val callback = waiting
    waiting = null
    val data = result.data
    val clip = data?.clipData
    callback?.onReceiveValue(
      when {
        result.resultCode != Activity.RESULT_OK -> null
        clip != null && clip.itemCount > 0 -> Array(clip.itemCount) { clip.getItemAt(it).uri }
        else -> FileChooserParams.parseResult(result.resultCode, data)
      }
    )
  }

  fun open(callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
    waiting?.onReceiveValue(null)
    waiting = callback
    val intent = params.createIntent()
    if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
    return try {
      launcher.launch(intent)
      true
    } catch (_: ActivityNotFoundException) {
      waiting = null
      false
    }
  }
}

/** A runtime permission of the app, asked when it is needed. */
class PermissionAsker(private val activity: AppCompatActivity, private val permission: String) {
  private var waiting: ArrayList<(Boolean) -> Unit> = ArrayList()

  private val launcher = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    val callbacks = waiting
    waiting = ArrayList()
    callbacks.forEach { it(granted) }
  }

  val granted: Boolean
    get() = ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED

  fun request(done: (Boolean) -> Unit) {
    if (granted) {
      done(true)
      return
    }
    waiting.add(done)
    if (waiting.size == 1) launcher.launch(permission)
  }

  companion object {
    fun microphone(activity: AppCompatActivity) = PermissionAsker(activity, Manifest.permission.RECORD_AUDIO)

    /** From API 37 on. */
    fun localNetwork(activity: AppCompatActivity) = PermissionAsker(activity, "android.permission.ACCESS_LOCAL_NETWORK")

    fun notifications(activity: AppCompatActivity) =
      PermissionAsker(activity, if (Build.VERSION.SDK_INT >= 33) Manifest.permission.POST_NOTIFICATIONS else "android.permission.POST_NOTIFICATIONS")
  }
}
