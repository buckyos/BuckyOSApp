import AVFoundation
import MediaPlayer
import UIKit

/// Keeps the client running while a page plays, and shows the system's media controls. The sound
/// itself comes from the page's `<audio>`.
@MainActor
final class Playback {
  private var item: [String: Any]?
  private var artworkSource = ""
  private var artwork: MPMediaItemArtwork?
  private var targets: [(MPRemoteCommand, Any)] = []

  /// The view whose sound goes on, as the Rust side last said.
  var view: String? { (item?["playing"] as? Bool) == true ? item?["view"] as? String : nil }

  func update(_ next: [String: Any]?) throws {
    let before = item
    item = next
    guard let next else {
      if before != nil { end() }
      return
    }
    if before == nil { try begin() }
    show(next)
  }

  private func begin() throws {
    try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
    try AVAudioSession.sharedInstance().setActive(true)
    let center = MPRemoteCommandCenter.shared()
    let commands: [(MPRemoteCommand, String)] = [
      (center.playCommand, "play"), (center.pauseCommand, "pause"), (center.stopCommand, "stop"),
      (center.nextTrackCommand, "next"), (center.previousTrackCommand, "previous"),
    ]
    for (command, name) in commands {
      targets.append((command, command.addTarget { [weak self] _ in self?.command(name) ?? .commandFailed }))
      command.isEnabled = true
    }
    targets.append(
      (
        center.togglePlayPauseCommand,
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
          guard let self else { return .commandFailed }
          return self.command((self.item?["playing"] as? Bool) == true ? "pause" : "play")
        }
      ))
  }

  private func end() {
    for (command, target) in targets { command.removeTarget(target) }
    targets.removeAll()
    artworkSource = ""
    artwork = nil
    let center = MPNowPlayingInfoCenter.default()
    center.nowPlayingInfo = nil
    center.playbackState = .stopped
  }

  private func show(_ item: [String: Any]) {
    let text = { (key: String) -> String in (item[key] as? String)?.trimmingCharacters(in: .whitespaces) ?? "" }
    let picture = text("artwork")
    if picture != artworkSource {
      artworkSource = picture
      let image = picture.isEmpty ? nil : Data(base64Encoded: picture).flatMap { UIImage(data: $0) }
      artwork = image.map { image in MPMediaItemArtwork(boundsSize: image.size) { _ in image } }
    }
    let playing = (item["playing"] as? Bool) == true
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: text("title").isEmpty ? Labels.load().playing : text("title"),
      MPMediaItemPropertyArtist: text("artist").isEmpty ? text("app") : text("artist"),
      MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
    ]
    if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
    let center = MPNowPlayingInfoCenter.default()
    center.nowPlayingInfo = info
    center.playbackState = playing ? .playing : .paused
  }

  private func command(_ command: String) -> MPRemoteCommandHandlerStatus {
    guard let view = item?["view"] as? String else { return .noActionableNowPlayingItem }
    Native.event("media", ["view": view, "command": command])
    return .success
  }
}
