import AVFoundation
import LukeKit

/// Plays 24 kHz PCM16 mono audio through the speaker using AVAudioPlayerNode.
/// Converts incoming Int16 samples to Float32 (AVAudioEngine's native format)
/// before scheduling them on the player node.
final class VoiceAudioPlayer: AudioPlayer, @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private let format: AVAudioFormat

    init() {
        // Float32 mono at 24 kHz — AVAudioPlayerNode's native scheduling format.
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
                // Convert Int16 → Float32 [-1, 1]
                channelData[0][i] = Float(sample) / 32768.0
            }
        }
        playerNode.scheduleBuffer(buffer, completionHandler: nil)
    }

    func stop() {
        playerNode.stop()
        engine.stop()
    }
}
