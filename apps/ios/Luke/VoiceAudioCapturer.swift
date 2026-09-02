import AVFoundation
import LukeKit

/// Captures 24 kHz PCM16 mono audio from the microphone using AVAudioEngine.
/// Taps the input node at its hardware format, converts each frame to 24 kHz
/// Float32 via AVAudioConverter, then yields Int16 samples to the stream.
final class VoiceAudioCapturer: AudioCapturer, @unchecked Sendable {
    private let engine = AVAudioEngine()
    private var hasTap = false

    func start() throws -> AsyncStream<[Int16]> {
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try audioSession.setActive(true)

        let inputNode = engine.inputNode
        let hwFormat = inputNode.outputFormat(forBus: 0)
        // AVAudioEngine raises an Objective-C exception (rather than a Swift
        // error) when installTap receives the zero-channel format that the
        // simulator can briefly report while its microphone route changes.
        // Reject it before installTap so the turn can fail normally instead
        // of terminating the app.
        guard hwFormat.sampleRate > 0, hwFormat.channelCount > 0,
              let targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: Double(PressAudioBuffer.sampleRate),
            channels: 1,
            interleaved: false
        ), let converter = AVAudioConverter(from: hwFormat, to: targetFormat) else {
            throw CocoaError(.fileReadUnknown)
        }

        let hwRate = hwFormat.sampleRate
        let targetRate = targetFormat.sampleRate
        let (stream, continuation) = AsyncStream<[Int16]>.makeStream()

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: hwFormat) { buffer, _ in
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * targetRate / hwRate)
            guard capacity > 0,
                  let converted = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: max(capacity, 1))
            else { return }
            var error: NSError?
            // The converter may call this block more than once per convert(to:)
            // on non-integer rate ratios. Feed the tap buffer only on the first
            // call; subsequent calls signal .noDataNow so the same frames are
            // not duplicated.
            var consumed = false
            converter.convert(to: converted, error: &error) { _, status in
                if consumed {
                    status.pointee = .noDataNow
                    return nil
                }
                consumed = true
                status.pointee = .haveData
                return buffer
            }
            guard error == nil, converted.frameLength > 0,
                  let channelData = converted.floatChannelData else { return }
            let count = Int(converted.frameLength)
            let ptr = channelData[0]
            var samples = [Int16](repeating: 0, count: count)
            for i in 0 ..< count {
                let clamped = max(-1.0, min(1.0, ptr[i]))
                samples[i] = Int16(clamped * 32767.0)
            }
            continuation.yield(samples)
        }
        hasTap = true

        do {
            try engine.start()
        } catch {
            inputNode.removeTap(onBus: 0)
            hasTap = false
            throw error
        }
        continuation.onTermination = { [weak self] _ in self?.engine.stop() }
        return stream
    }

    func stop() {
        if hasTap {
            engine.inputNode.removeTap(onBus: 0)
            hasTap = false
        }
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
