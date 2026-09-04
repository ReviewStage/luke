import AVFoundation
import LukeKit

/// Captures 24 kHz PCM16 mono audio from the microphone using AVAudioEngine.
/// Mirror of VoiceAudioCapturer without allowBluetoothHFP, which is unnecessary
/// on watchOS where the watch owns its own Bluetooth audio routing.
///
/// Callers should request microphone permission before this is instantiated;
/// on watchOS 10 the system presents the permission sheet when the engine tap
/// begins if permission is undetermined, and engine.start() raises an error
/// if permission was denied.
final class WatchAudioCapturer: AudioCapturer, @unchecked Sendable {
    private let engine = AVAudioEngine()
    private var hasTap = false

    func start() throws -> AsyncStream<[Int16]> {
        guard AVAudioApplication.shared.recordPermission != .denied else {
            throw CocoaError(.fileReadUnknown)
        }

        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playAndRecord, mode: .default)
        try audioSession.setActive(true)

        let inputNode = engine.inputNode
        let hwFormat = inputNode.outputFormat(forBus: 0)
        // Reject the zero-channel format the simulator can report while its
        // microphone route changes, the same guard VoiceAudioCapturer keeps.
        guard hwFormat.sampleRate > 0, hwFormat.channelCount > 0,
              let targetFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: Double(PressAudioBuffer.sampleRate),
                channels: 1,
                interleaved: false
              ),
              let converter = AVAudioConverter(from: hwFormat, to: targetFormat)
        else {
            throw CocoaError(.fileReadUnknown)
        }

        let hwRate = hwFormat.sampleRate
        let targetRate = targetFormat.sampleRate
        let (stream, continuation) = AsyncStream<[Int16]>.makeStream()

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: hwFormat) { buffer, _ in
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * targetRate / hwRate)
            guard capacity > 0,
                  let converted = AVAudioPCMBuffer(
                    pcmFormat: targetFormat, frameCapacity: max(capacity, 1))
            else { return }
            var error: NSError?
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
