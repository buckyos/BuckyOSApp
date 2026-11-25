package com.buckyos.buckyosapp.content

import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Rect
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.core.app.NotificationManagerCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.buckyos.buckyosapp.Labels
import com.buckyos.buckyosapp.MainActivity
import com.buckyos.buckyosapp.NativeBridge
import com.buckyos.buckyosapp.Secrets
import com.buckyos.buckyosapp.Wifi
import com.buckyos.buckyosapp.audio.PlaybackService
import com.buckyos.buckyosapp.audio.RecorderService
import com.buckyos.buckyosapp.notify.NotifyService
import org.json.JSONObject

/** The content views and the other native parts of the client, for the Rust side. */
@TauriPlugin
class ClientPlugin(private val activity: Activity) : Plugin(activity) {
  private val main = activity as MainActivity
  private val views = LinkedHashMap<String, ContentView>()
  private val replies = HashMap<Long, JavaScriptReplyProxy>()
  private var nextReply = 1L
  private var shown: String? = null
  private val stage = Rect()
  private var keyboard = 0
  private var signPrompt: Dialogs.SignPrompt? = null
  private var signInvoke: Invoke? = null
  private val connectivity = activity.getSystemService(ConnectivityManager::class.java)
  private val network = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) = event("online")
  }
  private val wifi = Wifi(activity) { event("online") }
  val downloads = Downloads(activity.applicationContext)

  private val density get() = activity.resources.displayMetrics.density

  override fun load(webView: WebView) {
    Profiles.cleanUp(activity)
    val host = main.container.contentHost
    ViewCompat.setOnApplyWindowInsetsListener(host) { _, insets ->
      keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      place()
      // A content view is placed clear of the bars and the keyboard; it must not inset itself again.
      WindowInsetsCompat.CONSUMED
    }
    host.viewTreeObserver.addOnGlobalFocusChangeListener { _, _ -> place() }
    ViewCompat.requestApplyInsets(host)
    connectivity.registerDefaultNetworkCallback(network)
    wifi.watch()
    if (Build.VERSION.SDK_INT >= 26) webView.webViewClient = LocalClient(webView.webViewClient)
    takeAlert(activity.intent)
  }

  private fun onMain(work: () -> Unit) = activity.runOnUiThread(work)

  private fun event(kind: String, fill: JSONObject.() -> Unit = {}) =
    NativeBridge.onEvent(JSONObject().put("kind", kind).apply(fill).toString())

  private fun px(value: Double) = Math.round(value * density).toInt()

  private fun rect(json: JSONObject) = Rect(
    px(json.optDouble("x", 0.0)),
    px(json.optDouble("y", 0.0)),
    px(json.optDouble("x", 0.0) + json.optDouble("width", 0.0)),
    px(json.optDouble("y", 0.0) + json.optDouble("height", 0.0)),
  )

  // ---- the ways to the Zones ----

  /** Pages of these hosts, and of all below them, go through the client's proxy. All profiles share the setting. */
  @Command
  fun setProxy(invoke: Invoke) = onMain {
    val args = invoke.getArgs()
    val supported = WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE) &&
      WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE_REVERSE_BYPASS)
    val done = { invoke.resolve(JSObject().put("supported", supported)) }
    val hosts = args.getJSONArray("hosts").let { list -> (0 until list.length()).map { list.getString(it) } }
    if (!supported) {
      done()
    } else if (hosts.isEmpty()) {
      ProxyController.getInstance().clearProxyOverride({ it.run() }, done)
    } else {
      val config = ProxyConfig.Builder()
        .addProxyRule("http://127.0.0.1:${args.getInt("port")}", ProxyConfig.MATCH_HTTPS)
        .addDirect(ProxyConfig.MATCH_HTTPS)
        .setReverseBypassEnabled(true)
      for (host in hosts) config.addBypassRule(host).addBypassRule("*.$host")
      ProxyController.getInstance().setProxyOverride(config.build(), { it.run() }, done)
    }
  }

  // ---- views ----

  private fun place() {
    val view = views[shown] ?: return
    val host = main.container.contentHost
    var bottom = stage.bottom
    // Only for typing in the page: the local pages deal with their own keyboard.
    if (keyboard > 0 && host.hasFocus()) bottom = minOf(bottom, host.height - keyboard)
    val params = view.web.layoutParams as FrameLayout.LayoutParams
    val height = maxOf(0, bottom - stage.top)
    if (params.leftMargin == stage.left && params.topMargin == stage.top && params.width == stage.width() && params.height == height) return
    params.leftMargin = stage.left
    params.topMargin = stage.top
    params.width = stage.width()
    params.height = height
    view.web.layoutParams = params
  }

  @Command
  fun create(invoke: Invoke) = onMain {
    val args = invoke.getArgs()
    val id = args.getString("id")
    views.remove(id)?.destroy()
    val rules = args.getJSONArray("rules").let { list -> (0 until list.length()).mapTo(HashSet()) { list.getString(it) } }
    try {
      val view = ContentView(
        main, this, id, args.getString("profile"), args.getString("zoneHost").lowercase(), args.getString("label"), rules,
        args.getString("script") + "\n" + Downloads.SCRIPT,
      )
      views[id] = view
      view.web.visibility = View.INVISIBLE
      main.container.contentHost.addView(view.web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject(error.toString())
    }
  }

  @Command
  fun load(invoke: Invoke) = onMain {
    val args = invoke.getArgs()
    val view = views[args.getString("id")]
    if (view == null) {
      invoke.reject("no such view")
    } else {
      view.load(args.getString("url"))
      invoke.resolve()
    }
  }

  /** A page of the same host, as a step the user can go back from. */
  @Command
  fun goTo(invoke: Invoke) = onMain {
    val args = invoke.getArgs()
    views[args.getString("id")]?.web?.loadUrl(args.getString("url"))
    invoke.resolve()
  }

  @Command
  fun close(invoke: Invoke) = onMain {
    val id = invoke.getArgs().getString("id")
    if (shown == id) conceal()
    views.remove(id)?.destroy()
    invoke.resolve()
  }

  /** The renderer of a view is gone, and the view with it. */
  fun dropped(view: ContentView) {
    if (views[view.id] === view) {
      views.remove(view.id)
      if (shown == view.id) conceal()
    }
    view.web.post { view.destroy() }
  }

  private fun conceal() {
    main.leaveFullscreen()
    views[shown]?.setShown(false)
    shown = null
    main.container.mainHost.pass = null
    main.container.mainView.requestFocus()
  }

  @Command
  fun show(invoke: Invoke) = onMain {
    val args = invoke.getArgs()
    if (!args.isNull("background")) {
      try {
        main.container.setBackgroundColor(Color.parseColor(args.getString("background")))
      } catch (_: IllegalArgumentException) {
      }
    }
    val id = if (args.isNull("view")) null else args.getString("view")
    val view = views[id]
    if (view == null) {
      conceal()
    } else {
      stage.set(rect(args.getJSONObject("rect")))
      if (shown != id) {
        main.leaveFullscreen()
        views[shown]?.setShown(false)
        shown = id
        view.setShown(true)
        view.web.requestFocus()
      }
      main.container.mainHost.pass = Rect(stage)
      place()
    }
    invoke.resolve()
  }

  @Command
  fun overlay(invoke: Invoke) = onMain {
    val args = invoke.getArgs()
    val blocks = args.optJSONArray("blocks")
    main.container.mainHost.modal = args.optBoolean("modal")
    main.container.mainHost.blocks = if (blocks == null) emptyList() else (0 until blocks.length()).map { rect(blocks.getJSONObject(it)) }
    invoke.resolve()
  }

  @Command
  fun eval(invoke: Invoke) = onMain {
    val args = invoke.getArgs()
    views[args.getString("id")]?.web?.evaluateJavascript(args.getString("script"), null)
    invoke.resolve()
  }

  @Command
  fun back(invoke: Invoke) = onMain {
    val web = views[invoke.getArgs().getString("id")]?.web
    val moved = web?.canGoBack() == true
    if (moved) web?.goBack()
    invoke.resolve(JSObject().put("moved", moved))
  }

  @Command
  fun stop(invoke: Invoke) = onMain {
    val web = views[invoke.getArgs().getString("id")]?.web
    web?.stopLoading()
    if (web?.canGoBack() == true) web.goBack()
    invoke.resolve()
  }

  @Command
  fun toBackground(invoke: Invoke) = onMain {
    activity.moveTaskToBack(true)
    invoke.resolve()
  }

  // ---- the bridge ----

  fun onMessage(view: ContentView, origin: String, isMainFrame: Boolean, text: String, reply: JavaScriptReplyProxy) {
    if (isMainFrame && text.startsWith("{\"download\"")) {
      val message = try {
        JSONObject(text)
      } catch (_: org.json.JSONException) {
        return
      }
      if (downloads.receive(view, message)) return
    }
    val id = nextReply++
    replies[id] = reply
    NativeBridge.onCall(view.id, origin, isMainFrame, text, id)
  }

  @Command
  fun reply(invoke: Invoke) = onMain {
    val args = invoke.getArgs()
    replies.remove(args.getLong("replyId"))?.postMessage(args.getString("json"))
    invoke.resolve()
  }

  // ---- cookies and storage ----

  @Command
  fun getCookies(invoke: Invoke) = onMain {
    val args = invoke.getArgs()
    invoke.resolve(JSObject().put("cookies", Profiles.cookies(args.getString("profile")).getCookie(args.getString("url")).orEmpty()))
  }

  @Command
  fun setCookies(invoke: Invoke) = onMain {
    val args = invoke.getArgs()
    val manager: CookieManager = Profiles.cookies(args.getString("profile"))
    val cookies = args.getJSONArray("cookies")
    for (index in 0 until cookies.length()) manager.setCookie(args.getString("url"), cookies.getString(index))
    manager.flush()
    invoke.resolve()
  }

  @Command
  fun clearProfile(invoke: Invoke) = onMain {
    val args = invoke.getArgs()
    val origins = args.getJSONArray("origins").let { list -> (0 until list.length()).map { list.getString(it) } }
    Profiles.clear(activity, args.getString("profile"), origins) { invoke.resolve() }
  }

  // ---- questions ----

  @Command
  fun signPrompt(invoke: Invoke) = onMain {
    val args = invoke.getArgs()
    signInvoke = invoke
    if (args.optBoolean("wrong")) {
      val prompt = signPrompt
      if (prompt == null) invoke.reject("closed") else prompt.wrong()
      return@onMain
    }
    signPrompt?.close()
    val labels = Labels.load(activity)
    val question = (if (args.optBoolean("device")) labels.signDevice else labels.signAsk)
      .replace("{zone}", args.getString("zone"))
      .replace("{app}", args.getString("app"))
    val message = question + "\n\n" + labels.signIdentity.replace("{app}", args.getString("identity"))
    signPrompt = Dialogs.SignPrompt(main, message, args.getString("content")) { password ->
      val waiting = signInvoke
      signInvoke = null
      if (password == null) signPrompt = null
      waiting?.resolve(JSObject().put("password", password ?: JSONObject.NULL))
    }
  }

  @Command
  fun signDone(invoke: Invoke) = onMain {
    signPrompt?.close()
    signPrompt = null
    signInvoke?.resolve(JSObject().put("password", JSONObject.NULL))
    signInvoke = null
    invoke.resolve()
  }

  @Command
  fun askMicrophone(invoke: Invoke) = onMain {
    val view = views[invoke.getArgs().getString("view")]
    if (view == null) {
      invoke.resolve(JSObject().put("granted", false))
    } else {
      view.askMicrophone { granted -> invoke.resolve(JSObject().put("granted", granted)) }
    }
  }

  // ---- the system ----

  @Command
  fun notificationPermission(invoke: Invoke) = onMain {
    val ask = invoke.getArgs().optBoolean("ask")
    val enabled = NotificationManagerCompat.from(activity).areNotificationsEnabled()
    if (ask && !enabled && Build.VERSION.SDK_INT >= 33) {
      main.notifications.request { granted ->
        // What the service wanted to show before was dropped.
        if (granted) NotifyService.send(activity, NotifyService.LABELS)
        invoke.resolve(JSObject().put("granted", granted))
      }
    } else {
      invoke.resolve(JSObject().put("granted", enabled))
    }
  }

  /** Asked when there is a device of a Zone to connect to; without it all goes over the internet. */
  @Command
  fun localNetworkPermission(invoke: Invoke) = onMain {
    if (Build.VERSION.SDK_INT < 37 || activity.applicationInfo.targetSdkVersion < 37) {
      invoke.resolve(JSObject().put("granted", true))
    } else {
      main.localNetwork.request { granted ->
        if (granted) event("online")
        invoke.resolve(JSObject().put("granted", granted))
      }
    }
  }

  @Command
  fun status(invoke: Invoke) = onMain {
    val power = activity.getSystemService(Activity.POWER_SERVICE) as PowerManager
    invoke.resolve(
      JSObject()
        .put("batteryUnrestricted", power.isIgnoringBatteryOptimizations(activity.packageName))
        .put("serviceRunning", NotifyService.running(activity))
        .put("multiProfile", Profiles.supported)
        .put("bridge", ContentView.bridgeSupported)
        .put("webview", WebView_version())
    )
  }

  @Suppress("FunctionName")
  private fun WebView_version(): String = if (Build.VERSION.SDK_INT >= 26) WebView.getCurrentWebViewPackage()?.versionName.orEmpty() else ""

  @Command
  fun openSettings(invoke: Invoke) = onMain {
    val app = Uri.parse("package:${activity.packageName}")
    val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, app)
    val intent = when (invoke.getArgs().getString("page")) {
      "battery" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
      "notifications" -> if (Build.VERSION.SDK_INT >= 26) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
      } else details
      else -> details
    }
    try {
      activity.startActivity(intent)
    } catch (_: android.content.ActivityNotFoundException) {
      activity.startActivity(details)
    }
    invoke.resolve()
  }

  // ---- notifications ----

  /** `action`: `reload` (its settings changed), `stop`, `labels`, `front` with a `zone`. */
  @Command
  fun service(invoke: Invoke) = onMain {
    val args = invoke.getArgs()
    when (args.getString("action")) {
      "reload" -> NotifyService.reload(activity)
      "stop" -> NotifyService.stop(activity)
      "labels" -> NotifyService.send(activity, NotifyService.LABELS)
      "front" -> NotifyService.send(activity, NotifyService.FRONT, args.optString("zone"))
    }
    invoke.resolve()
  }

  /** A notification of the client itself; the ones of a Zone come from the service. */
  @Command
  fun alert(invoke: Invoke) {
    NotifyService.alert(activity, invoke.getArgs().getString("alert"))
    invoke.resolve()
  }

  override fun onNewIntent(intent: Intent) = takeAlert(intent)

  private fun takeAlert(intent: Intent?) {
    val alert = intent?.getStringExtra(NotifyService.EXTRA_ALERT) ?: return
    val token = intent.getStringExtra(NotifyService.EXTRA_TOKEN)
    intent.removeExtra(NotifyService.EXTRA_ALERT)
    intent.removeExtra(NotifyService.EXTRA_TOKEN)
    if (token != Secrets.token(activity, NotifyService.TOKEN)) return
    // From the recent apps list the old intent comes again.
    if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
    event("alert") { put("alert", alert) }
    main.container.postDelayed({ NotifyService.tidy(activity) }, 1500)
  }

  // ---- audio ----

  @Command
  fun playback(invoke: Invoke) = onMain {
    try {
      PlaybackService.update(main, invoke.getArgs())
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject(error.toString(), "denied")
    }
  }

  @Command
  fun record(invoke: Invoke) = onMain {
    RecorderService.command(main, invoke)
  }

  // ---- the activity ----

  override fun onPause() {
    Profiles.flush()
    event("paused")
  }

  override fun onResume() = event("resumed")

  override fun onConfigurationChanged(newConfig: Configuration) = place()

  override fun onDestroy() {
    connectivity.unregisterNetworkCallback(network)
    wifi.stop()
    downloads.close()
  }
}
