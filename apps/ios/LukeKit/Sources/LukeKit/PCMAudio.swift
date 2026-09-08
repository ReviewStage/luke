import AVFoundation

public enum PCMAudio {
    /// Float32 mono at 24 kHz — `AVAudioPlayerNode`'s native scheduling
    /// format, at the rate the Realtime wire speaks. A new value per call
    /// rather than one shared: `AVAudioFormat` is not `Sendable`, so each
    /// owner holds its own and nothing crosses an isolation boundary.
    public static func format() -> AVAudioFormat {
        AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: Double(PressAudioBuffer.sampleRate),
            channels: 1,
            interleaved: false
        )!
    }
}

#if os(iOS) || os(watchOS)

/// Who owns the audio session under a PCM player or capturer. The phone
/// configures and activates its own; on the watch the session is
/// `WatchVoiceAudioSession`'s, active for the whole call before either of
/// these exists, so nothing here touches it. The three differences travel as
/// one value, because a caller picking them separately could pick a
/// combination neither platform has.
public enum PCMAudioSessionPolicy: Sendable {
    case phone
    case hostOwned

    var configuresSession: Bool {
        switch self {
        case .phone: true
        case .hostOwned: false
        }
    }

    /// watchOS routes its own Bluetooth audio and has no speaker option, so
    /// the options exist on the phone alone.
    var categoryOptions: AVAudioSession.CategoryOptions {
        #if os(iOS)
        switch self {
        case .phone: [.defaultToSpeaker, .allowBluetoothHFP]
        case .hostOwned: []
        }
        #else
        []
        #endif
    }

    /// Refuses to start when the microphone has already been denied. On
    /// watchOS the engine raises on a denied permission rather than failing,
    /// so the turn has to be refused before the tap begins.
    var checksRecordPermission: Bool {
        switch self {
        case .phone: false
        case .hostOwned: true
        }
    }
}

/// Plays 24 kHz PCM16 mono audio through the speaker using
/// `AVAudioPlayerNode`, converting incoming Int16 samples to Float32 —
/// `AVAudioEngine`'s native format — before scheduling them.
public final class PCMAudioPlayer: AudioPlayer, @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private let format = PCMAudio.format()
    private let policy: PCMAudioSessionPolicy

    public init(policy: PCMAudioSessionPolicy) {
        self.policy = policy
        if policy.configuresSession {
            let audioSession = AVAudioSession.sharedInstance()
            try? audioSession.setCategory(
                .playAndRecord,
                mode: .default,
                options: policy.categoryOptions
            )
            try? audioSession.setActive(true)
        }
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

    public func drain(then completion: @MainActor @Sendable @escaping () -> Void) {
        // A 1-sample silent sentinel: the .dataConsumed callback fires only
        // after the hardware has played every previously-scheduled buffer, so
        // the tail of the response is not cut off.
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

    public func stop() {
        playerNode.stop()
        engine.stop()
        guard policy.configuresSession else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

/// Captures 24 kHz PCM16 mono audio from the microphone using
/// `AVAudioEngine`: taps the input node at its hardware format, converts each
/// frame through `AVAudioConverter`, and yields Int16 samples to the stream.
public final class PCMAudioCapturer: AudioCapturer, @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let policy: PCMAudioSessionPolicy
    private var hasTap = false

    public init(policy: PCMAudioSessionPolicy) {
        self.policy = policy
    }

    public func start() throws -> AsyncStream<[Int16]> {
        if policy.checksRecordPermission, AVAudioApplication.shared.recordPermission == .denied {
            throw CocoaError(.fileReadUnknown)
        }
        if policy.configuresSession {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(
                .playAndRecord,
                mode: .default,
                options: policy.categoryOptions
            )
            try audioSession.setActive(true)
        }

        let inputNode = engine.inputNode
        let hwFormat = inputNode.outputFormat(forBus: 0)
        // AVAudioEngine raises an Objective-C exception (rather than a Swift
        // error) when installTap receives the zero-channel format that the
        // simulator can briefly report while its microphone route changes.
        // Reject it before installTap so the turn can fail normally instead
        // of terminating the app.
        let targetFormat = PCMAudio.format()
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
        guard policy.configuresSession else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

#endif
