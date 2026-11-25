package com.buckyos.buckyosapp.content

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.buckyos.buckyosapp.MainActivity
import com.buckyos.buckyosapp.NativeBridge
import org.json.JSONObject
import java.io.ByteArrayInputStream

/** One page of a Zone, or a device's activation page (no `zoneHost`): the top document of a WebView of its own. */
@SuppressLint("SetJavaScriptEnabled")
class ContentView(
  private val activity: MainActivity,
  private val plugin: ClientPlugin,
  val id: String,
  val profile: String,
  private val zoneHost: String,
  private val label: String,
  originRules: Set<String>,
  script: String,
) {
  val web = WebView(activity)
  private var failed = false
  private var gone = false
  private var arriving = false
  private var microphoneAllowed = false

  init {
    Profiles.use(web, profile)
    web.setBackgroundColor(Color.TRANSPARENT)
    web.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      mediaPlaybackRequiresUserGesture = false
      useWideViewPort = true
      loadWithOverviewMode = true
      builtInZoomControls = true
      displayZoomControls = false
      allowFileAccess = false
      allowContentAccess = false
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      setSupportMultipleWindows(true)
      javaScriptCanOpenWindowsAutomatically = false
    }
    // Both or none: a bridge whose caller cannot be told apart is no bridge.
    if (bridgeSupported) {
      WebViewCompat.addWebMessageListener(web, PORT, originRules) { _, message, origin, isMainFrame, reply ->
        val text = message.data
        if (text != null) plugin.onMessage(this, origin.toString(), isMainFrame, text, reply)
      }
      WebViewCompat.addDocumentStartJavaScript(web, script, originRules)
    }
    web.webViewClient = Client()
    web.webChromeClient = Chrome()
    web.setDownloadListener { url, userAgent, disposition, mimeType, _ ->
      plugin.downloads.start(this, url, userAgent, disposition, mimeType)
    }
  }

  /**
   * A load of the client's own: the address may carry a one-time sign-in, so no page gets to see
   * it. What was before is forgotten; going back does not meet the round trip.
   */
  fun load(url: String) {
    arriving = true
    web.loadUrl(url)
  }

  /** Hidden, the page is like a tab in the background: no animation, slow timers; sound goes on. */
  fun setShown(shown: Boolean) {
    web.visibility = if (shown) View.VISIBLE else View.INVISIBLE
    if (shown) web.onResume() else web.onPause()
  }

  fun destroy() {
    gone = true
    (web.parent as? android.view.ViewGroup)?.removeView(web)
    web.stopLoading()
    web.destroy()
  }

  fun isInZone(host: String?): Boolean {
    val name = host?.lowercase() ?: return false
    return zoneHost.isNotEmpty() && (name == zoneHost || name.endsWith(".$zoneHost"))
  }

  private fun event(kind: String, fill: JSONObject.() -> Unit = {}) {
    if (gone) return
    NativeBridge.onEvent(JSONObject().put("kind", kind).put("view", id).apply(fill).toString())
  }

  private inner class Client : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
      !NativeBridge.onNavigate(id, request.url.toString(), request.isForMainFrame, false)

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
      failed = false
      if (arriving) web.clearHistory()
      arriving = false
      event("started") { put("url", url) }
    }

    override fun onPageFinished(view: WebView, url: String) {
      // Chromium writes cookies to disk about twice a minute; a rotated session must not wait.
      Profiles.flush()
      if (!failed) event("finished") { put("url", url) }
    }

    override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
      if (!failed) event("visited") { put("url", url) }
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
      if (!request.isForMainFrame) return
      failed = true
      event("failed") {
        put("url", request.url.toString())
        put("detail", error.description?.toString().orEmpty())
      }
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
      handler.cancel()
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
      event("gone") { put("crashed", detail.didCrash()) }
      plugin.dropped(this@ContentView)
      return true
    }
  }

  private inner class Chrome : WebChromeClient() {
    override fun onReceivedTitle(view: WebView, title: String?) {
      if (!title.isNullOrBlank() && !failed) event("title") { put("title", title) }
    }

    override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, result: Message): Boolean {
      // Views never open windows: the address is caught in a WebView that loads nothing.
      // It is in no window, where what a view posts would never run.
      val probe = WebView(activity)
      val later = Handler(Looper.getMainLooper())
      Profiles.use(probe, profile)
      var told = false
      val tell = { url: String ->
        if (!told && url != "about:blank") {
          told = true
          NativeBridge.onNavigate(id, url, true, true)
          later.post { probe.destroy() }
        }
      }
      probe.webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
          tell(request.url.toString())
          return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) = tell(url)

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse =
          WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
      }
      later.postDelayed({ if (!told) { told = true; probe.destroy() } }, 10_000)
      (result.obj as WebView.WebViewTransport).webView = probe
      result.sendToTarget()
      return true
    }

    // A page behind another app does not get to put a dialog in front of it.
    override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean = refused(result)

    override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean = refused(result)

    override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String?, result: JsPromptResult): Boolean = refused(result)

    private fun refused(result: JsResult): Boolean {
      if (web.visibility == View.VISIBLE) return false
      result.cancel()
      return true
    }

    override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean =
      activity.fileChooser.open(callback, params)

    override fun onPermissionRequest(request: PermissionRequest) {
      val onlyAudio = request.resources.contentEquals(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
      if (!onlyAudio || request.origin.scheme != "https" || !isInZone(request.origin.host)) {
        request.deny()
        return
      }
      askMicrophone { allowed -> if (allowed) request.grant(request.resources) else request.deny() }
    }

    override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) =
      callback.invoke(origin, false, false)

    override fun onShowCustomView(view: View, callback: CustomViewCallback) = activity.enterFullscreen(view, callback)

    override fun onHideCustomView() = activity.leaveFullscreen()
  }

  /** Asks the user once per view, then the system. */
  fun askMicrophone(done: (Boolean) -> Unit) {
    if (microphoneAllowed) {
      activity.microphone.request(done)
      return
    }
    Dialogs.askMicrophone(activity, label, zoneHost) { allowed ->
      if (!allowed || gone) {
        done(false)
      } else {
        activity.microphone.request { granted ->
          microphoneAllowed = granted
          done(granted)
        }
      }
    }
  }

  companion object {
    const val PORT = "__buckyPort"

    val bridgeSupported: Boolean
      get() = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
        WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
  }
}
