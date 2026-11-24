package com.buckyos.buckyosapp.audio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import android.util.Base64
import androidx.core.content.ContextCompat
import com.buckyos.buckyosapp.Labels
import com.buckyos.buckyosapp.MainActivity
import com.buckyos.buckyosapp.NativeBridge
import com.buckyos.buckyosapp.R
import org.json.JSONObject

/**
 * Keeps the client running while a page plays, and shows the system's media controls. The sound
 * itself comes from the page's `<audio>`; a WebView has no media session of its own.
 */
class PlaybackService : Service() {
  private var session: MediaSession? = null
  private var artworkSource: String? = null
  private var artwork: Bitmap? = null

  private val noisy = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (item?.optBoolean("playing") == true) command("pause")
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    session = MediaSession(this, "BuckyOS").apply {
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() = command("play")
        override fun onPause() = command("pause")
        override fun onStop() = command("stop")
        override fun onSkipToNext() = command("next")
        override fun onSkipToPrevious() = command("previous")
      })
      setSessionActivity(openIntent(this@PlaybackService))
      isActive = true
    }
    ContextCompat.registerReceiver(this, noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    intent?.getStringExtra(COMMAND)?.let { command(it) }
    val notification = refresh()
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION, notification)
    }
    if (item == null) stopSelf()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    instance = null
    unregisterReceiver(noisy)
    session?.release()
    session = null
    super.onDestroy()
  }

  /** The session and the notification, as `item` says. */
  private fun refresh(): Notification {
    val labels = Labels.load(this)
    val now = item ?: JSONObject()
    val playing = now.optBoolean("playing")
    val title = now.optString("title").ifBlank { labels.playing }
    val artist = now.optString("artist").ifBlank { now.optString("app") }
    val picture = now.optString("artwork")
    if (picture != artworkSource) {
      artworkSource = picture
      artwork = if (picture.isEmpty()) null else try {
        val bytes = Base64.decode(picture, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
      } catch (_: IllegalArgumentException) {
        null
      }
    }
    session?.setMetadata(
      MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_TITLE, title)
        .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
        .apply { artwork?.let { putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it) } }
        .build()
    )
    session?.setPlaybackState(
      PlaybackState.Builder()
        .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, if (playing) 1f else 0f)
        .setActions(
          PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP or
            PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS
        )
        .build()
    )
    val builder = if (Build.VERSION.SDK_INT >= 26) {
      getSystemService(NotificationManager::class.java)
        .createNotificationChannel(NotificationChannel(CHANNEL, labels.channelPlayback, NotificationManager.IMPORTANCE_LOW))
      Notification.Builder(this, CHANNEL)
    } else {
      @Suppress("DEPRECATION") Notification.Builder(this)
    }
    val toggle = if (playing) action(android.R.drawable.ic_media_pause, labels.pause, "pause") else action(android.R.drawable.ic_media_play, labels.play, "play")
    return builder
      .setSmallIcon(R.drawable.ic_notify)
      .setContentTitle(title)
      .setContentText(artist)
      .setLargeIcon(artwork)
      .setContentIntent(openIntent(this))
      .setOngoing(playing)
      .setShowWhen(false)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .addAction(action(android.R.drawable.ic_media_previous, labels.previous, "previous"))
      .addAction(toggle)
      .addAction(action(android.R.drawable.ic_media_next, labels.next, "next"))
      .setStyle(Notification.MediaStyle().setMediaSession(session?.sessionToken).setShowActionsInCompactView(1))
      .build()
  }

  private fun action(icon: Int, title: String, command: String): Notification.Action {
    val intent = Intent(this, PlaybackService::class.java).setAction(command).putExtra(COMMAND, command)
    val pending = PendingIntent.getService(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return Notification.Action.Builder(Icon.createWithResource(this, icon), title, pending).build()
  }

  companion object {
    private const val CHANNEL = "playback"
    private const val COMMAND = "command"
    private const val NOTIFICATION = 2
    private var instance: PlaybackService? = null

    /** What plays, as the Rust side last said; null when nothing asks to be kept alive. */
    private var item: JSONObject? = null

    private fun command(command: String) {
      val view = item?.optString("view") ?: return
      NativeBridge.onEvent(JSONObject().put("kind", "media").put("view", view).put("command", command).toString())
    }

    private fun openIntent(context: Context) = PendingIntent.getActivity(
      context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    fun update(context: Context, args: JSONObject) {
      item = args.optJSONObject("item")
      val intent = Intent(context, PlaybackService::class.java)
      val running = instance
      when {
        item == null -> context.stopService(intent)
        running != null -> running.getSystemService(NotificationManager::class.java).notify(NOTIFICATION, running.refresh())
        else -> ContextCompat.startForegroundService(context, intent)
      }
    }
  }
}
