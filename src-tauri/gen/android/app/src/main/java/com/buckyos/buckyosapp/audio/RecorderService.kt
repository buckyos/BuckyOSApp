package com.buckyos.buckyosapp.audio

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import com.buckyos.buckyosapp.Labels
import com.buckyos.buckyosapp.MainActivity
import com.buckyos.buckyosapp.NativeBridge
import com.buckyos.buckyosapp.R
import org.json.JSONObject

/**
 * Records the microphone into one file. AAC in an ADTS stream: whatever is in the file plays, even
 * when the process ends in the middle.
 */
class RecorderService : Service() {
  private var recorder: MediaRecorder? = null
  private var state = "idle"
  private var recordedMs = 0L
  private var runningSince = 0L
  private var silenced: AudioManager.AudioRecordingCallback? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == STOP) {
      event { put("state", "stop") }
      return START_NOT_STICKY
    }
    val start = pending
    pending = null
    try {
      show(start?.args)
      if (start == null) {
        stopSelf()
        return START_NOT_STICKY
      }
      begin(start.args)
      start.invoke.resolve()
    } catch (error: Exception) {
      Log.w("BuckyOS", "recording did not start: $error")
      release()
      stopSelf()
      start?.invoke?.reject(error.toString(), if (error is SecurityException) "denied" else "failed")
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    finish()
    instance = null
    super.onDestroy()
  }

  private fun show(args: JSONObject?) {
    val labels = Labels.load(this)
    if (Build.VERSION.SDK_INT >= 26) {
      getSystemService(NotificationManager::class.java)
        .createNotificationChannel(NotificationChannel(CHANNEL, labels.channelRecording, NotificationManager.IMPORTANCE_LOW))
    }
    val immutable = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.ic_notify)
      .setContentTitle(labels.recording.replace("{app}", args?.optString("app").orEmpty()))
      .setOngoing(true)
      .setUsesChronometer(true)
      .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), immutable))
      .addAction(0, labels.stop, PendingIntent.getService(this, 1, Intent(this, RecorderService::class.java).setAction(STOP), immutable))
      .build()
    if (Build.VERSION.SDK_INT >= 30) {
      startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION, notification)
    }
  }

  private fun begin(args: JSONObject) {
    val made = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()
    recorder = made
    made.setAudioSource(MediaRecorder.AudioSource.MIC)
    made.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS)
    made.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
    made.setAudioSamplingRate(args.optInt("sampleRate", 44100))
    made.setAudioChannels(args.optInt("channels", 1))
    made.setAudioEncodingBitRate(args.optInt("bitRate", 96000))
    made.setOutputFile(args.getString("path"))
    made.setOnErrorListener { _, what, extra ->
      release()
      event {
        put("state", "failed")
        put("error", "recorder error $what/$extra")
      }
      stopSelf()
    }
    made.prepare()
    made.start()
    recordedMs = 0
    run("recording")
    watchSilence(made)
  }

  /** Another app took the microphone (a call): what is recorded meanwhile is silence. */
  private fun watchSilence(made: MediaRecorder) {
    if (Build.VERSION.SDK_INT < 29) return
    val callback = object : AudioManager.AudioRecordingCallback() {
      override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>) {
        val taken = Build.VERSION.SDK_INT >= 29 && configs.any { it.isClientSilenced }
        if (taken && state == "recording") change("interrupted") else if (!taken && state == "interrupted") change("recording")
      }
    }
    silenced = callback
    made.registerAudioRecordingCallback(mainExecutor, callback)
  }

  private fun elapsed() = recordedMs + if (state == "recording") SystemClock.elapsedRealtime() - runningSince else 0

  private fun run(next: String) {
    recordedMs = elapsed()
    runningSince = SystemClock.elapsedRealtime()
    state = next
  }

  private fun change(next: String) {
    run(next)
    event {
      put("state", state)
      put("elapsedMs", elapsed())
    }
  }

  private fun status() = JSObject().put("state", state).put("elapsedMs", elapsed())

  private fun event(fill: JSONObject.() -> Unit) = NativeBridge.onEvent(JSONObject().put("kind", "record").apply(fill).toString())

  private fun release() {
    recorder?.release()
    recorder = null
    silenced = null
    run("idle")
  }

  /** Ends the file; its length in milliseconds. */
  fun finish(): Long {
    val made = recorder ?: return 0
    val length = elapsed()
    try {
      made.stop()
    } catch (error: RuntimeException) {
      Log.w("BuckyOS", "recording ended badly: $error")
    }
    release()
    return length
  }

  private class Start(val args: JSONObject, val invoke: Invoke)

  companion object {
    private const val CHANNEL = "recording"
    private const val NOTIFICATION = 3
    private const val STOP = "stop"
    private var instance: RecorderService? = null
    private var pending: Start? = null

    fun command(activity: MainActivity, invoke: Invoke) {
      val args = invoke.getArgs()
      val service = instance
      when (args.getString("action")) {
        "start" -> {
          if (service?.recorder != null || pending != null) {
            invoke.reject("already recording", "busy")
            return
          }
          pending = Start(args, invoke)
          try {
            ContextCompat.startForegroundService(activity, Intent(activity, RecorderService::class.java))
          } catch (error: Exception) {
            pending = null
            invoke.reject(error.toString(), "denied")
          }
        }
        "pause" -> {
          if (service?.state != "recording") return invoke.reject("not recording", "invalid_state")
          service.recorder?.pause()
          service.change("paused")
          invoke.resolve()
        }
        "resume" -> {
          if (service?.state != "paused") return invoke.reject("not paused", "invalid_state")
          service.recorder?.resume()
          service.change("recording")
          invoke.resolve()
        }
        "stop" -> {
          if (service?.recorder == null) return invoke.reject("not recording", "invalid_state")
          val length = service.finish()
          service.stopSelf()
          invoke.resolve(JSObject().put("durationMs", length))
        }
        else -> invoke.resolve(service?.status() ?: JSObject().put("state", "idle").put("elapsedMs", 0))
      }
    }

    /** The activity goes away and the process with it. */
    fun finishNow() {
      instance?.finish()
    }
  }
}
