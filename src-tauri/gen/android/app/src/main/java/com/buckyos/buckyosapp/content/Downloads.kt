package com.buckyos.buckyosapp.content

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import com.buckyos.buckyosapp.Labels
import com.buckyos.buckyosapp.NativeBridge
import com.buckyos.buckyosapp.R
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Files a page offers, written to the Downloads folder. The client fetches them itself: the
 * system's downloader would keep the session's cookies and send them along a redirect anywhere.
 */
class Downloads(private val context: Context) {
  private class Blob(val view: ContentView, val type: String, val bytes: ByteArrayOutputStream = ByteArrayOutputStream())

  private val blobs = HashMap<String, Blob>()
  private val work = Executors.newFixedThreadPool(2)
  private val notifications get() = context.getSystemService(NotificationManager::class.java)
  private var sequence = 0

  fun close() = work.shutdown()

  private fun finished(view: String, name: String, success: Boolean) {
    NativeBridge.onEvent(JSONObject().put("kind", "download").put("view", view).put("name", name).put("success", success).toString())
  }

  fun start(view: ContentView, url: String, userAgent: String?, disposition: String?, mimeType: String?) {
    when {
      url.startsWith("https://") && view.isInZone(Uri.parse(url).host) -> fetch(view, url, userAgent, disposition, mimeType)
      url.startsWith("blob:") -> readBlob(view, url, mimeType.orEmpty())
      url.startsWith("data:") -> data(view, url)
      else -> Log.w("BuckyOS", "not downloaded: ${url.substringBefore(':')}")
    }
  }

  private fun fetch(view: ContentView, url: String, userAgent: String?, disposition: String?, mimeType: String?) {
    // The page's `download` name counts where the server names none.
    val asked = "(window.__buckyDownload && window.__buckyDownload.href === ${JSONObject.quote(url)}) ? window.__buckyDownload.name : ''"
    view.web.evaluateJavascript(asked) { answer ->
      val given = try {
        if (disposition.isNullOrBlank()) clean(JSONArray("[$answer]").optString(0)) else ""
      } catch (_: JSONException) {
        ""
      }
      val name = given.ifEmpty { clean(URLUtil.guessFileName(url, disposition, mimeType)) }
      val cookies = Profiles.cookies(view.profile)
      val inZone = { host: String? -> view.isInZone(host) }
      work.execute { transfer(view.id, name, mimeType.orEmpty()) { open(url, userAgent, cookies, inZone) } }
    }
  }

  private class Source(val stream: InputStream, val size: Long)

  /** Follows redirects only within the Zone, each with the cookies of its own host. */
  private fun open(address: String, userAgent: String?, cookies: CookieManager, inZone: (String?) -> Boolean): Source {
    var url = URL(address)
    repeat(MAX_REDIRECTS) {
      if (url.protocol != "https" || !inZone(url.host)) throw IOException("a redirect left the Zone")
      val connection = url.openConnection() as HttpURLConnection
      connection.instanceFollowRedirects = false
      connection.connectTimeout = TIMEOUT_MS
      connection.readTimeout = TIMEOUT_MS
      cookies.getCookie(url.toString())?.let { connection.setRequestProperty("Cookie", it) }
      if (!userAgent.isNullOrBlank()) connection.setRequestProperty("User-Agent", userAgent)
      when (val status = connection.responseCode) {
        in 200..299 -> return Source(connection.inputStream, connection.getHeaderField("Content-Length")?.toLongOrNull() ?: -1)
        301, 302, 303, 307, 308 -> {
          val next = connection.getHeaderField("Location") ?: throw IOException("a redirect to nowhere")
          connection.disconnect()
          url = URL(url, next)
        }
        else -> {
          connection.disconnect()
          throw IOException("HTTP $status")
        }
      }
    }
    throw IOException("too many redirects")
  }

  private fun readBlob(view: ContentView, url: String, type: String) {
    val token = UUID.randomUUID().toString()
    blobs[token] = Blob(view, type)
    view.web.evaluateJavascript(
      """
      (async () => {
        const send = (message) => __buckyPort.postMessage(JSON.stringify({ download: "$token", ...message }));
        try {
          const url = ${JSONObject.quote(url)};
          const blob = await (await fetch(url)).blob();
          const asked = window.__buckyDownload;
          const name = asked && asked.href === url ? asked.name : "";
          const step = 384 * 1024;
          for (let at = 0; at === 0 || at < blob.size; at += step) {
            const bytes = new Uint8Array(await blob.slice(at, at + step).arrayBuffer());
            let text = "";
            for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            send({ name, type: blob.type, data: btoa(text), last: at + step >= blob.size });
          }
        } catch (error) {
          send({ error: String(error) });
        }
      })()
      """.trimIndent(),
      null,
    )
  }

  /** A piece of a blob, sent by the script above; false when the message is something else. */
  fun receive(view: ContentView, message: JSONObject): Boolean {
    val token = message.optString("download").ifEmpty { return false }
    val blob = blobs[token] ?: return true
    if (blob.view !== view) return true
    if (message.has("error")) {
      blobs.remove(token)
      finished(view.id, "", false)
      return true
    }
    blob.bytes.write(Base64.decode(message.optString("data"), Base64.DEFAULT))
    if (!message.optBoolean("last")) return true
    blobs.remove(token)
    val type = message.optString("type").ifEmpty { blob.type }.substringBefore(';')
    save(view, clean(message.optString("name")).ifEmpty { fileName(type) }, type, blob.bytes.toByteArray())
    return true
  }

  private fun data(view: ContentView, url: String) {
    val head = url.substringBefore(',').removePrefix("data:")
    val body = url.substringAfter(',', "")
    val type = head.substringBefore(';').ifEmpty { "text/plain" }
    val bytes = if (head.endsWith(";base64")) Base64.decode(Uri.decode(body), Base64.DEFAULT) else Uri.decode(body).toByteArray()
    save(view, fileName(type), type, bytes)
  }

  private fun save(view: ContentView, name: String, type: String, bytes: ByteArray) {
    work.execute { transfer(view.id, name, type) { Source(ByteArrayInputStream(bytes), bytes.size.toLong()) } }
  }

  private fun clean(name: String) = name.replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1f]"), "_").trim().take(120)

  private fun fileName(type: String): String {
    val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(type) ?: "bin"
    return "download.$extension"
  }

  // ---- writing ----

  private fun transfer(view: String, name: String, type: String, open: () -> Source) {
    val id = FIRST_NOTIFICATION + synchronized(this) { sequence++ % 1000 }
    var place: Uri? = null
    var shown = name
    val success = try {
      show(id, name, -1, null)
      open().let { source ->
        source.stream.use { input ->
          if (Build.VERSION.SDK_INT >= 29) {
            val file = create(name, type)
            place = file
            context.contentResolver.openOutputStream(file).use { copy(id, name, input, it!!, source.size) }
            shown = publish(file, name)
          } else {
            File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), name).outputStream().use { copy(id, name, input, it, source.size) }
          }
        }
      }
      true
    } catch (error: Exception) {
      Log.w("BuckyOS", "a download failed: $error")
      place?.let { context.contentResolver.delete(it, null, null) }
      false
    }
    if (success) show(id, shown, 100, place) else notifications.cancel(id)
    finished(view, shown, success)
  }

  private fun copy(id: Int, name: String, input: InputStream, output: java.io.OutputStream, size: Long) {
    val buffer = ByteArray(64 * 1024)
    var written = 0L
    var told = 0L
    while (true) {
      val count = input.read(buffer)
      if (count < 0) break
      output.write(buffer, 0, count)
      written += count
      val now = System.currentTimeMillis()
      if (size > 0 && now - told > 500) {
        told = now
        show(id, name, (written * 100 / size).toInt().coerceIn(0, 99), null)
      }
    }
    if (size in 0 until Long.MAX_VALUE && written < size) throw IOException("cut off")
  }

  /** A new file in the Downloads folder, hidden until it is whole. */
  @RequiresApi(29)
  private fun create(name: String, type: String): Uri {
    val values = ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, name)
      put(MediaStore.Downloads.IS_PENDING, 1)
      if (type.isNotEmpty()) put(MediaStore.Downloads.MIME_TYPE, type.substringBefore(';'))
    }
    return context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IOException("no place to write to")
  }

  /** Shows the file; where the system still knows the name from a file that is gone, under a numbered one. */
  @RequiresApi(29)
  private fun publish(file: Uri, name: String): String {
    val stem = name.substringBeforeLast('.', name)
    val extension = if (name.contains('.')) ".${name.substringAfterLast('.')}" else ""
    var problem: Exception? = null
    for (number in 0..9) {
      val numbered = if (number == 0) name else "$stem ($number)$extension"
      val values = ContentValues().apply {
        put(MediaStore.Downloads.IS_PENDING, 0)
        if (number > 0) put(MediaStore.Downloads.DISPLAY_NAME, numbered)
      }
      try {
        context.contentResolver.update(file, values, null, null)
        return numbered
      } catch (error: Exception) {
        problem = error
      }
    }
    throw problem!!
  }

  /** `percent` is -1 while the size is unknown, 100 when it is done. */
  private fun show(id: Int, name: String, percent: Int, done: Uri?) {
    if (Build.VERSION.SDK_INT >= 26) {
      notifications.createNotificationChannel(NotificationChannel(CHANNEL, Labels.load(context).channelDownloads, NotificationManager.IMPORTANCE_LOW))
    }
    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_notify)
      .setContentTitle(name)
      .setOnlyAlertOnce(true)
      .setOngoing(percent < 100)
      .setAutoCancel(true)
    if (percent < 100) builder.setProgress(100, maxOf(percent, 0), percent < 0)
    if (done != null) {
      val open = Intent(Intent.ACTION_VIEW).setDataAndType(done, context.contentResolver.getType(done)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      builder.setContentIntent(PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    }
    try {
      notifications.notify(id, builder.build())
    } catch (error: Exception) {
      Log.w("BuckyOS", "a notification was not shown: $error")
    }
  }

  companion object {
    private const val CHANNEL = "downloads"
    private const val FIRST_NOTIFICATION = 1000
    private const val MAX_REDIRECTS = 5
    private const val TIMEOUT_MS = 30_000

    /** Remembers the name a page gives a download: the system's download listener is not told it. */
    const val SCRIPT = """
      (() => {
        if (window.top !== window) return;
        const keep = (link) => {
          if (link && link.hasAttribute("download"))
            Object.defineProperty(window, "__buckyDownload", { value: { href: link.href, name: link.download }, configurable: true });
        };
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { keep(this); return click.call(this); };
        addEventListener("click", (event) => keep(event.target instanceof Element ? event.target.closest("a[download]") : null), true);
      })();
    """
  }
}
