import AVFoundation
import Foundation

/// Records the microphone into one file. AAC in an ADTS stream: whatever is in the file plays, even
/// when the process ends in the middle. Everything is done on a queue of its own: the system may take
/// seconds to start a recorder (a Bluetooth microphone).
final class Recorder: NSObject {
  struct Failure: Error {
    let code: String
    let message: String
  }

  private let queue = DispatchQueue(label: "com.buckyos.recorder")
  private var recorder: AVAudioRecorder?
  private var state = "idle"
  private var recordedMs: Double = 0
  private var runningSince = Date()

  override init() {
    super.init()
    let center = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    center.addObserver(self, selector: #selector(interrupted), name: AVAudioSession.interruptionNotification, object: session)
    center.addObserver(self, selector: #selector(reset), name: AVAudioSession.mediaServicesWereResetNotification, object: session)
  }

  /// Does one thing after another; `done` is called on the main queue.
  func run<T>(_ work: @escaping (Recorder) throws -> T, done: @escaping (Result<T, Failure>) -> Void) {
    queue.async {
      let result: Result<T, Failure>
      do {
        result = .success(try work(self))
      } catch let failure as Failure {
        result = .failure(failure)
      } catch {
        result = .failure(Failure(code: "failed", message: error.localizedDescription))
      }
      DispatchQueue.main.async { done(result) }
    }
  }

  // ---- on the queue ----

  func start(path: String, sampleRate: Double, channels: Int, bitRate: Int) throws {
    guard recorder == nil else { throw Failure(code: "busy", message: "already recording") }
    guard AVAudioApplication.shared.recordPermission == .granted else {
      throw Failure(code: "denied", message: "the microphone was refused")
    }
    let session = AVAudioSession.sharedInstance()
    // What plays meanwhile goes on.
    try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker, .allowBluetoothHFP])
    try session.setActive(true)
    let made = try AVAudioRecorder(
      url: URL(fileURLWithPath: path),
      settings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: sampleRate,
        AVNumberOfChannelsKey: channels,
        AVEncoderBitRateKey: bitRate,
      ])
    made.delegate = self
    guard made.record() else { throw Failure(code: "failed", message: "the recorder did not start") }
    recorder = made
    recordedMs = 0
    enter("recording")
  }

  func pause() throws {
    guard state == "recording" else { throw Failure(code: "invalid_state", message: "not recording") }
    recorder?.pause()
    change("paused")
  }

  func resume() throws {
    guard state == "paused" || state == "interrupted" else { throw Failure(code: "invalid_state", message: "not paused") }
    guard recorder?.record() == true else { throw Failure(code: "failed", message: "the recorder did not start again") }
    change("recording")
  }

  /// Ends the file; its length in milliseconds.
  func stop() throws -> Int {
    guard let made = recorder else { throw Failure(code: "invalid_state", message: "not recording") }
    let length = elapsed
    made.delegate = nil
    made.stop()
    release()
    return length
  }

  struct Status {
    let state: String
    let elapsedMs: Int
  }

  var status: Status { Status(state: state, elapsedMs: elapsed) }

  private var elapsed: Int {
    Int(recordedMs + (state == "recording" ? Date().timeIntervalSince(runningSince) * 1000 : 0))
  }

  private func enter(_ next: String) {
    recordedMs = Double(elapsed)
    runningSince = Date()
    state = next
  }

  private func tell(_ event: [String: Any]) {
    DispatchQueue.main.async { Native.event("record", event) }
  }

  private func change(_ next: String) {
    enter(next)
    tell(["state": state, "elapsedMs": elapsed])
  }

  private func release() {
    recorder = nil
    enter("idle")
    // What plays is the only sound again.
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
  }

  private func fail(_ message: String) {
    release()
    tell(["state": "failed", "error": message])
  }

  // ---- from the system ----

  /// Another app took the microphone (a call).
  @objc private func interrupted(_ notification: Notification) {
    guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      let type = AVAudioSession.InterruptionType(rawValue: raw)
    else { return }
    queue.async {
      switch type {
      case .began where self.state == "recording":
        self.change("interrupted")
      case .ended where self.state == "interrupted":
        try? AVAudioSession.sharedInstance().setActive(true)
        if self.recorder?.record() == true { self.change("recording") } else { self.fail("the recorder did not start again") }
      default:
        break
      }
    }
  }

  @objc private func reset(_ notification: Notification) {
    queue.async {
      if self.recorder != nil { self.fail("the system's audio was reset") }
    }
  }
}

extension Recorder: AVAudioRecorderDelegate {
  func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
    let message = error?.localizedDescription ?? "the encoder failed"
    queue.async {
      recorder.stop()
      if self.recorder === recorder { self.fail(message) }
    }
  }

  func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
    // `stop` takes the delegate away: this one ended by itself.
    queue.async {
      if self.recorder === recorder { self.fail("the recorder ended") }
    }
  }
}
