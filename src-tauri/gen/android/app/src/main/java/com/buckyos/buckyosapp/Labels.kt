package com.buckyos.buckyosapp

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * Texts of what is drawn natively, in the language of the local pages. They are kept in a file the
 * Rust side writes: the notification service needs them after a boot, when no page ran yet.
 */
class Labels private constructor(private val values: JSONObject) {
  private fun text(key: String, default: String) = values.optString(key).ifBlank { default }

  val serviceTitle get() = text("serviceTitle", "Notifications are on")
  val serviceConnected get() = text("serviceConnected", "Connected")
  val serviceWaiting get() = text("serviceWaiting", "Waiting for the network")
  val serviceSignIn get() = text("serviceSignIn", "Sign in again to receive notifications")
  val channelService get() = text("channelService", "Connection")
  val channelSilent get() = text("channelSilent", "Silent notifications")
  val channelSound get() = text("channelSound", "Notifications")
  val channelUrgent get() = text("channelUrgent", "Urgent notifications")
  val channelDownloads get() = text("channelDownloads", "Downloads")
  val channelPlayback get() = text("channelPlayback", "Playback")
  val channelRecording get() = text("channelRecording", "Recording")
  val playing get() = text("playing", "Playing audio")
  val play get() = text("play", "Play")
  val pause get() = text("pause", "Pause")
  val previous get() = text("previous", "Previous")
  val next get() = text("next", "Next")
  val stop get() = text("stop", "Stop")
  val recording get() = text("recording", "{app} is recording")
  val signTitle get() = text("signTitle", "Sign")
  val signAsk get() = text("signAsk", "{app} ({zone}) asks you to sign this:")
  val signDevice get() = text("signDevice", "The device at {zone} asks you to sign this, and gets the digest of your wallet password:")
  val signIdentity get() = text("signIdentity", "Identity: {app}")
  val signPassword get() = text("signPassword", "Wallet password")
  val signWrong get() = text("signWrong", "Wrong password")
  val confirm get() = text("confirm", "Confirm")
  val cancel get() = text("cancel", "Cancel")
  val allow get() = text("allow", "Allow")
  val deny get() = text("deny", "Don't allow")
  val micAsk get() = text("micAsk", "{app} ({zone}) wants to use the microphone")

  companion object {
    const val FILE = "native-labels.json"

    fun load(context: Context): Labels = Labels(
      try {
        JSONObject(File(context.applicationInfo.dataDir, FILE).readText())
      } catch (_: Exception) {
        JSONObject()
      }
    )
  }
}
