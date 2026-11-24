package com.buckyos.buckyosapp.content

import android.graphics.Bitmap
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.buckyos.buckyosapp.NativeBridge
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.nio.ByteBuffer

/**
 * The client of the local pages' WebView: wry's own, except for what their `<audio>` reads from a
 * Zone. A WebView applies the `Range` of an intercepted request itself, by skipping that much of
 * the stream it is given, so the stream must be the whole file; wry can only give it bytes.
 */
class LocalClient(private val inner: WebViewClient) : WebViewClient() {
  override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
    if (request.url.host == MEDIA_HOST) media(request) else inner.shouldInterceptRequest(view, request)

  override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = inner.shouldOverrideUrlLoading(view, request)

  override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) = inner.onPageStarted(view, url, favicon)

  override fun onPageFinished(view: WebView, url: String) = inner.onPageFinished(view, url)

  override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) = inner.onReceivedError(view, request, error)

  private fun media(request: WebResourceRequest): WebResourceResponse {
    val headers = request.requestHeaders
    // A frame inside a local page (the activation page) is not one.
    val from = headers["Origin"] ?: headers["Referer"]
    if (request.method != "GET" || from == null || (from != LOCAL && !from.startsWith("$LOCAL/"))) return plain(403, "Forbidden")
    val range = headers["Range"]?.let { Regex("bytes=(\\d+)-(\\d*)").matchEntire(it.trim()) }
    val start = range?.groupValues?.get(1)?.toLongOrNull() ?: 0L
    val first = try {
      Piece.load(request.url.toString(), start)
    } catch (_: IOException) {
      return plain(504, "Gateway Timeout")
    }
    if (first.status != 200 && first.status != 206) return plain(first.status, "Error")
    val last = minOf(range?.groupValues?.get(2)?.toLongOrNull() ?: Long.MAX_VALUE, first.total - 1)
    val answer = HashMap<String, String>()
    answer["Accept-Ranges"] = "bytes"
    if (range != null) answer["Content-Range"] = "bytes $start-$last/${first.total}"
    val stream = ZoneStream(request.url.toString(), first, last + 1)
    return if (range != null) {
      WebResourceResponse(first.type, null, 206, "Partial Content", answer, stream)
    } else {
      WebResourceResponse(first.type, null, 200, "OK", answer, stream)
    }
  }

  private fun plain(status: Int, reason: String) =
    WebResourceResponse("text/plain", "utf-8", if (status in 300..399) 502 else status, reason, emptyMap(), ByteArrayInputStream(ByteArray(0)))

  /** A part of a file, as `NativeBridge.mediaRead` packs it: the length of a description, the description, the bytes. */
  private class Piece(val at: Long, val status: Int, val type: String, val total: Long, val bytes: ByteArray) {
    companion object {
      fun load(url: String, at: Long): Piece {
        val packed = NativeBridge.mediaRead(url, at, PIECE) ?: throw IOException("the Zone did not answer")
        val buffer = ByteBuffer.wrap(packed)
        val about = ByteArray(buffer.int).also { buffer.get(it) }
        val bytes = ByteArray(buffer.remaining()).also { buffer.get(it) }
        val json = JSONObject(String(about))
        return Piece(at, json.getInt("status"), json.optString("type").ifEmpty { "application/octet-stream" }, json.optLong("total"), bytes)
      }
    }
  }

  /** The whole file; only what is read is fetched. */
  private class ZoneStream(private val url: String, private var piece: Piece, private val end: Long) : InputStream() {
    private val total = piece.total
    private var position = 0L

    override fun available(): Int = minOf(total - position, Int.MAX_VALUE.toLong()).toInt()

    override fun skip(count: Long): Long {
      val skipped = minOf(count, total - position).coerceAtLeast(0)
      position += skipped
      return skipped
    }

    override fun read(): Int {
      val one = ByteArray(1)
      return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
    }

    override fun read(into: ByteArray, offset: Int, length: Int): Int {
      if (length == 0) return 0
      if (position >= end) return -1
      var at = position - piece.at
      if (at < 0 || at >= piece.bytes.size) {
        piece = Piece.load(url, position)
        at = 0
        if (piece.status != 206 || piece.bytes.isEmpty()) throw IOException("HTTP ${piece.status}")
      }
      val count = minOf(length.toLong(), piece.bytes.size - at, end - position).toInt()
      System.arraycopy(piece.bytes, at.toInt(), into, offset, count)
      position += count
      return count
    }
  }

  companion object {
    private const val MEDIA_HOST = "zonemedia.localhost"
    private const val LOCAL = "http://tauri.localhost"
    private const val PIECE = 256 * 1024
  }
}
