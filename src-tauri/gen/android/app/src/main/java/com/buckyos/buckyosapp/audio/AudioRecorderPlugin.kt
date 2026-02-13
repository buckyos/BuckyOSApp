package com.buckyos.buckyosapp.audio

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class RecordingConfigArgs {
    var outputPath: String = ""
    var sampleRate: Int = 44100
    var channels: Int = 1
    var bitRate: Int = 128000
}

@InvokeArg
class PlaybackArgs {
    var filePath: String = ""
}

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")
    ]
)
class AudioRecorderPlugin(private val activity: Activity) : Plugin(activity) {
    private var mediaRecorder: MediaRecorder? = null
    private var currentFilePath: String? = null
    private var recordingStartTime: Long = 0
    private var pausedDuration: Long = 0
    private var pauseStartTime: Long = 0
    private var isPaused: Boolean = false
    private var isInterrupted: Boolean = false
    private var isRecording: Boolean = false
    private var isStopping: Boolean = false
    private var currentSampleRate: Int = 44100
    private var currentChannels: Int = 1
    private var maxDurationHandler: Handler? = null

    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var hasAudioFocus: Boolean = false

    private var player: MediaPlayer? = null
    private var isPlaying: Boolean = false

    companion object {
        private const val REQUEST_RECORD_AUDIO = 1001
    }

    init {
        audioManager = activity.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    }

    private fun requestAudioFocus() {
        if (hasAudioFocus) return
        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setOnAudioFocusChangeListener { focusChange ->
                    if (focusChange == AudioManager.AUDIOFOCUS_LOSS || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                        if (isRecording && !isPaused && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                            try {
                                mediaRecorder?.pause()
                                isPaused = true
                                isInterrupted = true
                                pauseStartTime = System.currentTimeMillis()
                            } catch (_: Exception) {
                            }
                        }
                    }
                }
                .build()
            audioFocusRequest = focusRequest
            audioManager?.requestAudioFocus(focusRequest)
        } else {
            @Suppress("DEPRECATION")
            audioManager?.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
        }
        hasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun releaseAudioFocus() {
        if (!hasAudioFocus) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager?.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            audioManager?.abandonAudioFocus(null)
        }
        hasAudioFocus = false
        audioFocusRequest = null
    }

    @Command
    fun startRecording(invoke: Invoke) {
        val config = invoke.parseArgs(RecordingConfigArgs::class.java)
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                REQUEST_RECORD_AUDIO,
            )
            invoke.reject("Microphone permission required")
            return
        }
        if (isRecording) {
            invoke.reject("Already recording")
            return
        }
        if (isPlaying) {
            stopPlaybackInternal()
        }

        try {
            currentSampleRate = config.sampleRate.coerceIn(8000, 48000)
            currentChannels = if (config.channels >= 2) 2 else 1

            val output = if (config.outputPath.endsWith(".m4a")) config.outputPath else "${config.outputPath}.m4a"
            val file = File(output)
            file.parentFile?.mkdirs()
            currentFilePath = file.absolutePath

            requestAudioFocus()

            mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(activity)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }

            mediaRecorder?.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioSamplingRate(currentSampleRate)
                setAudioEncodingBitRate(config.bitRate.coerceAtLeast(64000))
                setAudioChannels(currentChannels)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }

            isRecording = true
            isPaused = false
            isInterrupted = false
            recordingStartTime = System.currentTimeMillis()
            pausedDuration = 0
            pauseStartTime = 0

            invoke.resolve()
        } catch (e: Exception) {
            cleanupRecording()
            invoke.reject("Failed to start recording: ${e.message}")
        }
    }

    @Command
    fun stopRecording(invoke: Invoke) {
        if (!isRecording) {
            invoke.reject("Not recording")
            return
        }
        val result = stopRecordingInternal()
        if (result == null) {
            invoke.reject("Failed to stop recording")
            return
        }
        invoke.resolve(result)
    }

    private fun stopRecordingInternal(): JSObject? {
        synchronized(this) {
            if (isStopping) return null
            isStopping = true
        }
        try {
            maxDurationHandler = null
            releaseAudioFocus()
            val filePath = currentFilePath ?: return null

            mediaRecorder?.apply {
                try {
                    stop()
                } catch (_: Exception) {
                }
                release()
            }
            mediaRecorder = null

            val endTime = System.currentTimeMillis()
            val duration = if (isPaused) {
                pauseStartTime - recordingStartTime - pausedDuration
            } else {
                endTime - recordingStartTime - pausedDuration
            }.coerceAtLeast(0)

            val file = File(filePath)
            val ret = JSObject()
            ret.put("filePath", filePath)
            ret.put("durationMs", duration)
            ret.put("fileSize", if (file.exists()) file.length() else 0L)
            ret.put("sampleRate", currentSampleRate)
            ret.put("channels", currentChannels)

            cleanupRecording()
            return ret
        } finally {
            isStopping = false
        }
    }

    @Command
    fun pauseRecording(invoke: Invoke) {
        if (!isRecording) {
            invoke.reject("Not recording")
            return
        }
        if (isPaused) {
            invoke.reject("Already paused")
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            invoke.reject("Pause not supported on this Android version")
            return
        }

        try {
            mediaRecorder?.pause()
            isPaused = true
            pauseStartTime = System.currentTimeMillis()
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Failed to pause: ${e.message}")
        }
    }

    @Command
    fun resumeRecording(invoke: Invoke) {
        if (!isRecording) {
            invoke.reject("Not recording")
            return
        }
        if (!isPaused) {
            invoke.reject("Not paused")
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            invoke.reject("Resume not supported on this Android version")
            return
        }

        try {
            mediaRecorder?.resume()
            val delta = System.currentTimeMillis() - pauseStartTime
            pausedDuration += delta
            pauseStartTime = 0
            isPaused = false
            isInterrupted = false
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Failed to resume: ${e.message}")
        }
    }

    @Command
    fun getStatus(invoke: Invoke) {
        val ret = JSObject()
        val state = when {
            !isRecording -> "idle"
            isInterrupted -> "interrupted"
            isPaused -> "paused"
            else -> "recording"
        }
        ret.put("state", state)
        val duration = if (!isRecording) {
            0L
        } else if (isPaused || isInterrupted) {
            pauseStartTime - recordingStartTime - pausedDuration
        } else {
            System.currentTimeMillis() - recordingStartTime - pausedDuration
        }.coerceAtLeast(0)
        ret.put("durationMs", duration)
        ret.put("outputPath", currentFilePath)
        invoke.resolve(ret)
    }

    @Command
    fun checkPermission(invoke: Invoke) {
        val granted = ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        val ret = JSObject()
        ret.put("granted", granted)
        ret.put("canRequest", !granted)
        invoke.resolve(ret)
    }

    @Command
    fun requestPermission(invoke: Invoke) {
        val granted = ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

        if (granted) {
            val ret = JSObject()
            ret.put("granted", true)
            ret.put("canRequest", false)
            invoke.resolve(ret)
            return
        }

        ActivityCompat.requestPermissions(
            activity,
            arrayOf(Manifest.permission.RECORD_AUDIO),
            REQUEST_RECORD_AUDIO,
        )

        Handler(Looper.getMainLooper()).postDelayed({
            val nowGranted = ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
            val ret = JSObject()
            ret.put("granted", nowGranted)
            ret.put("canRequest", !nowGranted)
            invoke.resolve(ret)
        }, 700)
    }

    @Command
    fun playRecording(invoke: Invoke) {
        val args = invoke.parseArgs(PlaybackArgs::class.java)
        val path = args.filePath
        if (path.isBlank()) {
            invoke.reject("filePath is required")
            return
        }
        try {
            stopPlaybackInternal()
            val player = MediaPlayer()
            player.setDataSource(path)
            player.setOnCompletionListener {
                stopPlaybackInternal()
            }
            player.prepare()
            player.start()
            this.player = player
            isPlaying = true
            invoke.resolve()
        } catch (e: Exception) {
            stopPlaybackInternal()
            invoke.reject("Failed to play recording: ${e.message}")
        }
    }

    @Command
    fun stopPlayback(invoke: Invoke) {
        stopPlaybackInternal()
        invoke.resolve()
    }

    @Command
    fun getPlaybackStatus(invoke: Invoke) {
        val ret = JSObject()
        ret.put("state", if (isPlaying) "playing" else "idle")
        invoke.resolve(ret)
    }

    private fun stopPlaybackInternal() {
        try {
            player?.stop()
        } catch (_: Exception) {
        }
        try {
            player?.release()
        } catch (_: Exception) {
        }
        player = null
        isPlaying = false
    }

    private fun cleanupRecording() {
        isRecording = false
        isPaused = false
        isInterrupted = false
        currentFilePath = null
        recordingStartTime = 0
        pausedDuration = 0
        pauseStartTime = 0
        mediaRecorder = null
    }

    fun dispose() {
        maxDurationHandler = null
        try {
            mediaRecorder?.release()
        } catch (_: Exception) {
        }
        stopPlaybackInternal()
    }
}
