import AVFoundation
import LukeKit

/// Captures 24 kHz PCM16 mono audio from the microphone using AVAudioEngine.
/// Taps the input node at Float32 (the native tap format AVAudioEngine requires)
/// and converts each frame to Int16 before yielding it to the stream.
final class VoiceAudioCapturer: AudioCapturer, @unchecked Sendable {
    private let engine = AVAudioEngine()

    func start() throws -> AsyncStream<[Int16]> {
        let inputNode = engine.inputNode
        // Float32 mono at 24 kHz: AVAudioEngine requires Float32 for installTap,
        // so we convert to Int16 in the tap callback.
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: Double(PressAudioBuffer.sampleRate),
            channels: 1,
            interleaved: false
        ) else {
            throw CocoaError(.fileReadUnknown)
        }
        let (stream, continuation) = AsyncStream<[Int16]>.makeStream()

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
            guard
                let channelData = buffer.floatChannelData,
                buffer.frameLength > 0
            else { return }
            let count = Int(buffer.frameLength)
            let ptr = channelData[0]
            var samples = [Int16](repeating: 0, count: count)
            for i in 0 ..< count {
                // Clamp and convert float [-1, 1] → Int16
                let clamped = max(-1.0, min(1.0, ptr[i]))
                samples[i] = Int16(clamped * 32767.0)
            }
            continuation.yield(samples)
        }

        try engine.start()
        continuation.onTermination = { [weak self] _ in self?.engine.stop() }
        return stream
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}
