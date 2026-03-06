import AVFoundation
import Foundation
import Tauri

struct RecordingConfigArgs: Decodable {
    let outputPath: String
    let recordId: String?
    let format: String?
    let sampleRate: Int
    let channels: Int
    let bitRate: Int
}

struct PlaybackArgs: Decodable {
    let filePath: String
}

class AudioRecorderPlugin: Plugin, AVAudioPlayerDelegate {
    private let audioSession = AVAudioSession.sharedInstance()
    private var recorder: AVAudioRecorder?
    private var engine: AVAudioEngine?
    private var audioFile: AVAudioFile?
    private var player: AVAudioPlayer?

    private var currentFilePath: String?
    private var recordingStartTime: Date?
    private var pausedStartedAt: Date?
    private var pausedDuration: TimeInterval = 0

    private var isRecording = false
    private var isPaused = false
    private var isInterrupted = false

    private var currentSampleRate = 44_100
    private var currentChannels = 1
    private var currentRecordId: String?

    override init() {
        super.init()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: audioSession,
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func permissionState() -> (granted: Bool, canRequest: Bool) {
        switch audioSession.recordPermission {
        case .granted:
            return (true, false)
        case .denied:
            return (false, false)
        case .undetermined:
            return (false, true)
        @unknown default:
            return (false, false)
        }
    }

    private func formatDurationMs(
        isRecording: Bool,
        recordingStartTime: Date?,
        pausedDuration: TimeInterval,
        pausedStartedAt: Date?,
        isPaused: Bool,
    ) -> Int64 {
        guard let startedAt = recordingStartTime, isRecording else {
            return 0
        }

        let now = Date()
        let activePause = pausedDuration
        let inPause = isPaused ? now.timeIntervalSince(pausedStartedAt ?? now) : 0
        return max(0, Int64((now.timeIntervalSince(startedAt) - (activePause + inPause)) * 1000))
    }

    private func emitInterruptionBegin(reason: String) {
        guard let recordId = currentRecordId else {
            return
        }
        DispatchQueue.main.async {
            self.trigger("audio_interruption_begin", data: ["record_id": recordId, "reason": reason])
        }
    }

    private func emitInterruptionEnd() {
        guard let recordId = currentRecordId else {
            return
        }
        DispatchQueue.main.async {
            self.trigger("audio_interruption_end", data: ["record_id": recordId])
        }
    }

    @objc private func handleInterruption(_ notification: Notification) {
        guard isRecording else { return }
        guard let userInfo = notification.userInfo else { return }
        guard let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: typeValue)
        else {
            return
        }

        switch type {
        case .began:
            if !isPaused, let recorder = recorder {
                recorder.pause()
            }
            isPaused = true
            isInterrupted = true
            if pausedStartedAt == nil {
                pausedStartedAt = Date()
            }
            emitInterruptionBegin(reason: "audio_session_interruption_began")
        case .ended:
            emitInterruptionEnd()
            isInterrupted = false
        @unknown default:
            break
        }
    }

    private func audioRouteSummary() -> String {
        let inputs = audioSession.currentRoute.inputs.map { "\($0.portType.rawValue):\($0.portName)" }
        let outputs = audioSession.currentRoute.outputs.map { "\($0.portType.rawValue):\($0.portName)" }
        let available = (audioSession.availableInputs ?? []).map { "\($0.portType.rawValue):\($0.portName)" }
        return [
            "inputAvailable=\(audioSession.isInputAvailable)",
            "preferredSampleRate=\(audioSession.preferredSampleRate)",
            "sampleRate=\(audioSession.sampleRate)",
            "currentInputs=\(inputs)",
            "currentOutputs=\(outputs)",
            "availableInputs=\(available)",
        ].joined(separator: ", ")
    }

    @objc public func startRecording(_ invoke: Invoke) throws {
        do {
            let args = try invoke.parseArgs(RecordingConfigArgs.self)
            if isRecording {
                invoke.reject("Already recording")
                return
            }

            guard !args.outputPath.isEmpty else {
                invoke.reject("Invalid output path")
                return
            }

            let outputURL = URL(fileURLWithPath: args.outputPath)

            currentRecordId = args.recordId

            let status = permissionState()
            if !status.granted {
                invoke.reject("Microphone permission required")
                return
            }

            try audioSession.setCategory(.record, mode: .default, options: [])
            try audioSession.setPreferredSampleRate(Double(args.sampleRate))
            if args.channels > 0 {
                try? audioSession.setPreferredInputNumberOfChannels(args.channels)
            }
            try audioSession.setActive(true)

            currentSampleRate = args.sampleRate
            currentChannels = args.channels > 0 ? args.channels : 1
            let requestedFormat = (args.format ?? "caf").lowercased()

            let directory = outputURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

            if FileManager.default.fileExists(atPath: outputURL.path) {
                try? FileManager.default.removeItem(at: outputURL)
            }

            let engine = AVAudioEngine()
            let inputNode = engine.inputNode
            let inputFormat = inputNode.inputFormat(forBus: 0)
            guard inputFormat.channelCount > 0 else {
                invoke.reject("No input channels available: \(audioRouteSummary())")
                return
            }

            let settings: [String: Any]
            if requestedFormat == "wav" {
                settings = [
                    AVFormatIDKey: Int(kAudioFormatLinearPCM),
                    AVSampleRateKey: inputFormat.sampleRate,
                    AVNumberOfChannelsKey: inputFormat.channelCount,
                    AVLinearPCMBitDepthKey: 16,
                    AVLinearPCMIsFloatKey: false,
                    AVLinearPCMIsBigEndianKey: false,
                ]
            } else {
                settings = inputFormat.settings
            }

            let audioFile = try AVAudioFile(forWriting: outputURL, settings: settings)
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { buffer, _ in
                do {
                    try audioFile.write(from: buffer)
                } catch {
                    NSLog("AudioRecorderPlugin write failed: \(error.localizedDescription)")
                }
            }

            engine.prepare()
            try engine.start()

            self.engine = engine
            self.audioFile = audioFile
            self.recorder = nil
            currentSampleRate = Int(inputFormat.sampleRate)
            currentChannels = Int(inputFormat.channelCount)

            isRecording = true
            isPaused = false
            isInterrupted = false
            pausedDuration = 0
            pausedStartedAt = nil
            currentFilePath = outputURL.path
            recordingStartTime = Date()

            invoke.resolve()
        } catch {
            invoke.reject(error.localizedDescription)
        }
    }

    @objc public func stopRecording(_ invoke: Invoke) throws {
        guard isRecording else {
            invoke.reject("Not recording")
            return
        }

        let recorder = self.recorder
        let engine = self.engine
        self.recorder = nil
        self.engine = nil
        self.audioFile = nil
        isRecording = false

        let endTime = Date()
        let startedAt = recordingStartTime ?? endTime
        let activePause = isPaused ? (endTime.timeIntervalSince(pausedStartedAt ?? endTime)) : 0
        let totalPaused = pausedDuration + max(0, activePause)
        let elapsed = max(0, endTime.timeIntervalSince(startedAt) - totalPaused)

        if isInterrupted || isPaused {
            pausedStartedAt = nil
        }
        isPaused = false
        isInterrupted = false
        recordingStartTime = nil
        let path = currentFilePath
        currentFilePath = nil
        currentRecordId = nil

        recorder?.stop()
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine?.reset()
        if let path = path {
            let url = URL(fileURLWithPath: path)
            try? audioSession.setActive(false)
            let fileSize: Int64
            do {
                fileSize = (try FileManager.default.attributesOfItem(atPath: path)[.size] as? NSNumber)
                    .flatMap { Int64(truncating: $0) } ?? 0
            } catch {
                fileSize = 0
            }

            invoke.resolve([
                "filePath": url.path,
                "durationMs": Int64(elapsed * 1000),
                "fileSize": fileSize,
                "sampleRate": currentSampleRate,
                "channels": currentChannels,
            ])
            return
        }

        invoke.resolve(["filePath": "", "durationMs": 0, "fileSize": 0, "sampleRate": currentSampleRate, "channels": currentChannels])
    }

    @objc public func pauseRecording(_ invoke: Invoke) throws {
        if !isRecording {
            invoke.reject("Not recording")
            return
        }
        if isPaused {
            invoke.reject("Already paused")
            return
        }
        if let recorder = recorder {
            recorder.pause()
        } else if let engine = engine {
            engine.pause()
        } else {
            invoke.reject("Recorder unavailable")
            return
        }
        isPaused = true
        pausedStartedAt = Date()
        invoke.resolve()
    }

    @objc public func resumeRecording(_ invoke: Invoke) throws {
        if !isRecording {
            invoke.reject("Not recording")
            return
        }
        if !isPaused {
            invoke.reject("Not paused")
            return
        }
        let resumed: Bool
        if let recorder = recorder {
            resumed = recorder.record()
        } else if let engine = engine {
            do {
                try engine.start()
                resumed = true
            } catch {
                invoke.reject("Failed to resume: \(error.localizedDescription)")
                return
            }
        } else {
            invoke.reject("Recorder unavailable")
            return
        }
        if resumed {
            isPaused = false
            isInterrupted = false
            if let pausedAt = pausedStartedAt {
                pausedDuration += max(0, Date().timeIntervalSince(pausedAt))
            }
            pausedStartedAt = nil
            invoke.resolve()
            return
        }
        invoke.reject("Failed to resume")
    }

    @objc public func getStatus(_ invoke: Invoke) throws {
        let state = if !isRecording {
            "idle"
        } else if isInterrupted {
            "interrupted"
        } else if isPaused {
            "paused"
        } else {
            "recording"
        }

        let duration = formatDurationMs(
            isRecording: isRecording,
            recordingStartTime: recordingStartTime,
            pausedDuration: pausedDuration,
            pausedStartedAt: pausedStartedAt,
            isPaused: isPaused,
        )

        invoke.resolve([
            "state": state,
            "durationMs": duration,
            "outputPath": currentFilePath,
        ])
    }

    @objc public func checkPermission(_ invoke: Invoke) throws {
        let permission = permissionState()
        invoke.resolve([
            "granted": permission.granted,
            "canRequest": permission.canRequest,
        ])
    }

    @objc public func requestPermission(_ invoke: Invoke) throws {
        let current = permissionState()
        if current.granted || !current.canRequest {
            invoke.resolve([
                "granted": current.granted,
                "canRequest": current.canRequest,
            ])
            return
        }

        self.audioSession.requestRecordPermission { granted in
            let permission = self.permissionState()
            invoke.resolve([
                "granted": granted,
                "canRequest": permission.canRequest,
            ])
        }
    }

    @objc public func playRecording(_ invoke: Invoke) throws {
        do {
            let args = try invoke.parseArgs(PlaybackArgs.self)
            if args.filePath.isEmpty {
                invoke.reject("filePath is required")
                return
            }

            if isRecording {
                invoke.reject("Recording in progress")
                return
            }

            try audioSession.setCategory(.playback, mode: .default, options: [.defaultToSpeaker])
            try audioSession.setActive(true)

            stopPlaybackInternal()
            let url = URL(fileURLWithPath: args.filePath)

            player = try AVAudioPlayer(contentsOf: url)
            player?.delegate = self
            player?.prepareToPlay()
            if player?.play() == true {
                invoke.resolve()
                return
            }
            invoke.reject("Failed to start playback")
        } catch {
            invoke.reject(error.localizedDescription)
        }
    }

    @objc public func stopPlayback(_ invoke: Invoke) throws {
        stopPlaybackInternal()
        invoke.resolve()
    }

    @objc public func getPlaybackStatus(_ invoke: Invoke) throws {
        invoke.resolve([
            "state": player?.isPlaying == true ? "playing" : "idle",
        ])
    }

    private func stopPlaybackInternal() {
        player?.stop()
        player = nil
    }

    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        stopPlaybackInternal()
    }
}

@_cdecl("init_plugin_audio")
func initPlugin() -> Plugin {
    return AudioRecorderPlugin()
}
