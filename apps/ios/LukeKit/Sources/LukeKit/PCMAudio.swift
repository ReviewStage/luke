import AVFoundation

public enum PCMAudio {
    /// Float32 mono at the rate the wire speaks — `AVAudioPlayerNode`'s native
    /// scheduling format — which is the rate of the `LiveAudioFormat` the
    /// watch's session was created under. A new value per call rather than
    /// one shared: `AVAudioFormat` is not `Sendable`, so each owner holds its
    /// own and nothing crosses an isolation boundary.
    public static func format(sampleRate: Int) -> AVAudioFormat {
        AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: Double(sampleRate),
            channels: 1,
            interleaved: false
        )!
    }
}

#if os(iOS) || os(watchOS)

/// Plays PCM16 mono audio at the rate given through the speaker using
/// `AVAudioPlayerNode`, converting incoming Int16 samples to Float32 —
/// `AVAudioEngine`'s native format — before scheduling them. The audio
/// session is the host's: on the watch `WatchVoiceAudioSession` holds it
/// active for the whole call before this exists, so nothing here touches it.
public final class PCMAudioPlayer: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private let format: AVAudioFormat

    public init(sampleRate: Int) {
        format = PCMAudio.format(sampleRate: sampleRate)
        engine.attach(playerNode)
        engine.connect(playerNode, to: engine.mainMixerNode, format: format)
        try? engine.start()
        playerNode.play()
    }

    public func enqueue(_ samples: [Int16]) {
        guard !samples.isEmpty else { return }
        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(samples.count)
        ) else { return }
        buffer.frameLength = buffer.frameCapacity
        if let channelData = buffer.floatChannelData {
            for (index, sample) in samples.enumerated() {
                channelData[0][index] = Float(sample) / 32768.0
            }
        }
        playerNode.scheduleBuffer(buffer, completionHandler: nil)
    }

    public func stop() {
        playerNode.stop()
        engine.stop()
    }
}

/// Captures PCM16 mono audio at the rate given from the microphone using
/// `AVAudioEngine`: taps the input node at its hardware format, converts each
/// frame through `AVAudioConverter`, and yields Int16 samples to the stream.
public final class PCMAudioCapturer: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let sampleRate: Int
    private var hasTap = false

    public init(sampleRate: Int) {
        self.sampleRate = sampleRate
    }

    public func start() throws -> AsyncStream<[Int16]> {
        // Refuses to start when the microphone has already been denied: the
        // engine raises on a denied permission rather than failing, so the
        // turn has to be refused before the tap begins.
        if AVAudioApplication.shared.recordPermission == .denied {
            throw CocoaError(.fileReadUnknown)
        }

        let inputNode = engine.inputNode
        let hwFormat = inputNode.outputFormat(forBus: 0)
        // AVAudioEngine raises an Objective-C exception (rather than a Swift
        // error) when installTap receives the zero-channel format that the
        // simulator can briefly report while its microphone route changes.
        // Reject it before installTap so the turn can fail normally instead
        // of terminating the app.
        let targetFormat = PCMAudio.format(sampleRate: sampleRate)
        guard hwFormat.sampleRate > 0, hwFormat.channelCount > 0,
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
                      pcmFormat: targetFormat,
                      frameCapacity: max(capacity, 1)
                  )
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
            let samplePointer = channelData[0]
            var samples = [Int16](repeating: 0, count: count)
            for index in 0 ..< count {
                let clamped = max(-1.0, min(1.0, samplePointer[index]))
                samples[index] = Int16(clamped * 32767.0)
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

    public func stop() {
        if hasTap {
            engine.inputNode.removeTap(onBus: 0)
            hasTap = false
        }
        engine.stop()
    }
}

#endif
