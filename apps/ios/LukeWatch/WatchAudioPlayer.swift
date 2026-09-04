import AVFoundation
import LukeKit

/// Plays 24 kHz PCM16 mono audio through the speaker using AVAudioPlayerNode.
/// Mirror of VoiceAudioPlayer without allowBluetoothHFP, which is unnecessary
/// on watchOS where the watch owns its own Bluetooth audio routing.
final class WatchAudioPlayer: AudioPlayer, @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private let format: AVAudioFormat

    init() {
        let audioSession = AVAudioSession.sharedInstance()
        try? audioSession.setCategory(.playAndRecord, mode: .default)
        try? audioSession.setActive(true)
        format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: Double(PressAudioBuffer.sampleRate),
            channels: 1,
            interleaved: false
        )!
        engine.attach(playerNode)
        engine.connect(playerNode, to: engine.mainMixerNode, format: format)
        try? engine.start()
        playerNode.play()
    }

    func enqueue(_ samples: [Int16]) {
        guard !samples.isEmpty else { return }
        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(samples.count)
        ) else { return }
        buffer.frameLength = buffer.frameCapacity
        if let channelData = buffer.floatChannelData {
            for (i, sample) in samples.enumerated() {
                channelData[0][i] = Float(sample) / 32768.0
            }
        }
        playerNode.scheduleBuffer(buffer, completionHandler: nil)
    }

    func drain(then completion: @MainActor @Sendable @escaping () -> Void) {
        guard let sentinel = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1) else {
            Task { @MainActor in completion() }
            return
        }
        sentinel.frameLength = 1
        sentinel.floatChannelData?[0][0] = 0
        playerNode.scheduleBuffer(sentinel, completionCallbackType: .dataConsumed) { _ in
            Task { @MainActor in completion() }
        }
    }

    func stop() {
        playerNode.stop()
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
