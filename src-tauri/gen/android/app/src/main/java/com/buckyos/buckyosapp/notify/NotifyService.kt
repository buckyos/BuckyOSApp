package com.buckyos.buckyosapp.notify

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.buckyos.buckyosapp.Labels
import com.buckyos.buckyosapp.MainActivity
import com.buckyos.buckyosapp.NativeBridge
import com.buckyos.buckyosapp.R
import com.buckyos.buckyosapp.Secrets
import com.buckyos.buckyosapp.Wifi
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Receives notifications while the client is not on the screen: a foreground service in its own
 * process (`:notify`), so that neither the end of the activity (which ends Tauri and its process)
 * nor the memory of the WebViews matters. The connections themselves are Rust (`notify/service.rs`).
 */
class NotifyService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private val network = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) = NativeBridge.serviceWake()
  }
  private val wifi by lazy { Wifi(this) { NativeBridge.serviceWake() } }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    NativeBridge.attach(this)
    createChannels(this)
    getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(network)
    wifi.watch()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = notification()
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
      } else {
        startForeground(NOTIFICATION, notification)
      }
    } catch (error: Exception) {
      Log.w("BuckyOS", "the notification service may not run: $error")
      stopSelf()
      return START_NOT_STICKY
    }
    if (!wanted(this)) {
      // Sessions that are left are signed out first; Rust says when that is done.
      NativeBridge.serviceReload(applicationInfo.dataDir)
      main.postDelayed({ ended() }, END_MS)
      return START_NOT_STICKY
    }
    when (intent?.action) {
      HEARTBEAT -> NativeBridge.serviceWake()
      LABELS -> createChannels(this)
      FRONT -> NativeBridge.serviceFront(intent.getStringExtra(EXTRA_ZONE).orEmpty())
      else -> NativeBridge.serviceReload(applicationInfo.dataDir)
    }
    scheduleHeartbeat()
    return START_STICKY
  }

  private fun ended() {
    if (!wanted(this)) stopSelf()
  }

  override fun onTaskRemoved(rootIntent: Intent?) = NativeBridge.serviceFront("")

  override fun onDestroy() {
    instance = null
    getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(network)
    wifi.stop()
    (getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(heartbeat())
    super.onDestroy()
    // Nothing else runs in this process; its connections end with it.
    android.os.Process.killProcess(android.os.Process.myPid())
  }

  private fun heartbeat(): PendingIntent {
    val intent = Intent(this, NotifyService::class.java).setAction(HEARTBEAT)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return if (Build.VERSION.SDK_INT >= 26) PendingIntent.getForegroundService(this, 0, intent, flags) else PendingIntent.getService(this, 0, intent, flags)
  }

  /** While the device sleeps, timers stand still: an alarm finds a connection that died silently. */
  private fun scheduleHeartbeat() {
    (getSystemService(Context.ALARM_SERVICE) as AlarmManager)
      .setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + HEARTBEAT_MS, heartbeat())
  }

  private fun notification(): Notification {
    val labels = Labels.load(this)
    val text = when (current) {
      "need_login" -> labels.serviceSignIn
      "connected" -> labels.serviceConnected
      else -> labels.serviceWaiting
    }
    return NotificationCompat.Builder(this, CHANNEL_SERVICE)
      .setSmallIcon(R.drawable.ic_notify)
      .setContentTitle(labels.serviceTitle)
      .setContentText(text)
      .setOngoing(true)
      .setShowWhen(false)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      .build()
  }

  private fun refresh() = getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification())

  companion object {
    const val LABELS = "labels"
    const val FRONT = "front"
    private const val HEARTBEAT = "heartbeat"
    const val EXTRA_ZONE = "zone"
    const val EXTRA_ALERT = "alert"

    /** Any app may start the activity; an alert counts only with this. */
    const val EXTRA_TOKEN = "token"
    const val TOKEN = "alert-token"
    private const val ACTION_ALERT = "com.buckyos.buckyosapp.ALERT"
    private const val CHANNEL_SERVICE = "connection"
    private const val CHANNEL_SILENT = "alerts_silent"
    private const val CHANNEL_SOUND = "alerts"
    private const val CHANNEL_URGENT = "alerts_urgent"
    private const val NOTIFICATION = 1
    private const val ALERT = 10
    private const val SUMMARY = 11
    private const val MAX_ALERTS = 30
    private const val HEARTBEAT_MS = 15 * 60_000L
    private const val END_MS = 20_000L
    private const val BUSY_MS = 60_000L
    private const val CONFIG = "notify-service.json"

    private var instance: NotifyService? = null
    private var current = "connecting"
    private var lock: PowerManager.WakeLock? = null

    /** Whether the settings the main process left say that there is something to connect to. */
    fun wanted(context: Context): Boolean = try {
      val config = JSONObject(File(context.applicationInfo.dataDir, CONFIG).readText())
      config.optBoolean("enabled") && (config.optJSONArray("zones")?.length() ?: 0) > 0
    } catch (_: Exception) {
      false
    }

    // ---- from the main process ----

    fun reload(context: Context) = start(context, Intent(context, NotifyService::class.java).setAction("reload"))

    fun stop(context: Context) {
      send(context, "reload")
      cancelAlerts(context, "")
    }

    fun send(context: Context, action: String, zone: String = "") {
      if (running(context)) start(context, Intent(context, NotifyService::class.java).setAction(action).putExtra(EXTRA_ZONE, zone))
    }

    private fun start(context: Context, intent: Intent) {
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (error: Exception) {
        Log.w("BuckyOS", "the notification service did not start: $error")
      }
    }

    @Suppress("DEPRECATION")
    fun running(context: Context): Boolean =
      (context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager)
        .getRunningServices(Int.MAX_VALUE)
        .any { it.service.className == NotifyService::class.java.name }

    // ---- from Rust, in the service's process ----

    fun state(json: String) {
      val service = instance ?: return
      service.main.post {
        val next = JSONObject(json).optString("state")
        if (next != current && instance === service) {
          current = next
          service.refresh()
        }
      }
    }

    /** Nothing is connected any more, and the Zones know. */
    fun ended() {
      val service = instance ?: return
      service.main.post { if (instance === service) service.ended() }
    }

    /** Requests are under way: the device stays awake for them. */
    fun busy(context: Context, busy: Boolean) {
      synchronized(this) {
        val held = lock ?: (context.getSystemService(Context.POWER_SERVICE) as PowerManager)
          .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BuckyOS:notify")
          .apply { setReferenceCounted(false) }
          .also { lock = it }
        if (busy) held.acquire(BUSY_MS) else if (held.isHeld) held.release()
      }
    }

    private fun channel(context: Context, id: String, name: String, importance: Int) {
      context.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(id, name, importance))
    }

    fun createChannels(context: Context) {
      if (Build.VERSION.SDK_INT < 26) return
      val labels = Labels.load(context)
      channel(context, CHANNEL_SERVICE, labels.channelService, NotificationManager.IMPORTANCE_MIN)
      channel(context, CHANNEL_SILENT, labels.channelSilent, NotificationManager.IMPORTANCE_LOW)
      channel(context, CHANNEL_SOUND, labels.channelSound, NotificationManager.IMPORTANCE_DEFAULT)
      channel(context, CHANNEL_URGENT, labels.channelUrgent, NotificationManager.IMPORTANCE_HIGH)
    }

    /** Shows an alert (`notify::model::Alert`); one with the same tag is replaced. */
    fun alert(context: Context, json: String) {
      createChannels(context)
      val alert = JSONObject(json)
      val tag = alert.getString("tag")
      val level = alert.optString("level")
      val channel = when (level) {
        "urgent" -> CHANNEL_URGENT
        "sound" -> CHANNEL_SOUND
        else -> CHANNEL_SILENT
      }
      val body = alert.optString("body")
      val notification = NotificationCompat.Builder(context, channel)
        .setSmallIcon(R.drawable.ic_notify)
        .setContentTitle(alert.optString("title"))
        .setContentText(body)
        .setSubText(alert.optString("zoneLabel"))
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setWhen(alert.optLong("atMs", System.currentTimeMillis()))
        .setAutoCancel(true)
        .setPriority(
          when (level) {
            "urgent" -> NotificationCompat.PRIORITY_HIGH
            "sound" -> NotificationCompat.PRIORITY_DEFAULT
            else -> NotificationCompat.PRIORITY_LOW
          }
        )
        .setCategory(if (tag.contains("|message:")) NotificationCompat.CATEGORY_MESSAGE else NotificationCompat.CATEGORY_STATUS)
        .setGroup(alert.getString("zone"))
        .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
        .setContentIntent(openAlert(context, tag, json))
        .build()
      try {
        makeRoom(context, tag)
        context.getSystemService(NotificationManager::class.java).notify(tag, ALERT, notification)
        summarize(context, alert, channel)
      } catch (error: Exception) {
        Log.w("BuckyOS", "a notification was not shown: $error")
      }
    }

    private fun openAlert(context: Context, tag: String, json: String): PendingIntent {
      val open = Intent(context, MainActivity::class.java)
        .setAction(ACTION_ALERT)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        .putExtra(EXTRA_ALERT, json)
        .putExtra(EXTRA_TOKEN, Secrets.token(context, TOKEN))
      return PendingIntent.getActivity(context, tag.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Several alerts of a Zone are one group; tapped while folded it leads to the Activity page. */
    private fun summarize(context: Context, alert: JSONObject, channel: String) {
      val manager = context.getSystemService(NotificationManager::class.java)
      val zone = alert.getString("zone")
      val label = alert.optString("zoneLabel")
      if (manager.activeNotifications.count { it.id == ALERT && it.tag?.startsWith("$zone|") == true } < 2) return
      val json = JSONObject(alert.toString())
        .put("tag", "$zone|summary")
        .put("title", label)
        .put("body", "")
        .put("level", "silent")
        .put("target", JSONObject().put("kind", "activity"))
        .toString()
      val summary = NotificationCompat.Builder(context, channel)
        .setSmallIcon(R.drawable.ic_notify)
        .setContentTitle(label)
        .setSubText(label)
        .setGroup(zone)
        .setGroupSummary(true)
        .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
        .setAutoCancel(true)
        .setContentIntent(openAlert(context, "$zone|summary", json))
        .build()
      manager.notify(zone, SUMMARY, summary)
    }

    /** A summary does not stay behind what it summed up. */
    fun tidy(context: Context) {
      val manager = context.getSystemService(NotificationManager::class.java)
      val shown = manager.activeNotifications
      for (summary in shown.filter { it.id == SUMMARY }) {
        if (shown.none { it.id == ALERT && it.tag?.startsWith("${summary.tag}|") == true }) manager.cancel(summary.tag, SUMMARY)
      }
    }

    /** The system drops what an app shows beyond 50; the oldest go before that. */
    private fun makeRoom(context: Context, tag: String) {
      val manager = context.getSystemService(NotificationManager::class.java)
      val shown = manager.activeNotifications.filter { it.id == ALERT && it.tag != null && it.tag != tag }
      shown.sortedBy { it.postTime }.take(maxOf(0, shown.size - MAX_ALERTS + 1)).forEach { manager.cancel(it.tag, ALERT) }
    }

    /** What these were about was read or dealt with elsewhere. */
    fun cancelAlerts(context: Context, prefix: String) = cancel(context) { it.startsWith(prefix) }

    /** Zones that are not connected (any more) have nothing on the screen. */
    fun keepAlerts(context: Context, zones: String) {
      val list = JSONArray(zones)
      val kept = (0 until list.length()).mapTo(HashSet()) { list.getString(it) }
      cancel(context) { it.startsWith("did:") && it.substringBefore('|') !in kept }
    }

    private fun cancel(context: Context, which: (String) -> Boolean) {
      val manager = context.getSystemService(NotificationManager::class.java)
      for (shown in manager.activeNotifications) {
        val tag = shown.tag ?: continue
        if (shown.id == ALERT && which(tag)) manager.cancel(tag, ALERT)
      }
      // Cancelling takes effect a little later.
      Handler(Looper.getMainLooper()).postDelayed({ tidy(context) }, 1000)
    }
  }
}

/** Starts the service again after a boot or an update of the app. */
class NotifyReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (NotifyService.wanted(context)) NotifyService.reload(context)
  }
}
