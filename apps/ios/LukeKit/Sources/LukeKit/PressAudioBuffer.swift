import Foundation

/// Pre-connect audio buffer for push-to-talk. Holds PCM16 mono samples captured
/// while the WebSocket is still opening so words said before the channel is ready
/// are not lost. Matches the shape of `PressAudioBuffer` in `@sidecar/realtime`:
/// same 24 kHz sample rate, same 30-second ceiling, same oldest-trimmed overflow rule.
public struct PressAudioBuffer: Sendable {
    /// Sample rate that pairs with the realtime session config's audio input format.
    public static let sampleRate: Int = 24_000

    // 30 seconds of mono audio at 24 kHz is 720,000 samples.
    private static let maximumSamples: Int = 30 * sampleRate

    private var chunks: [[Int16]] = []
    private var totalSamples: Int = 0

    /// How many milliseconds of audio are currently held.
    public var bufferedMs: Int { totalSamples * 1000 / Self.sampleRate }
    public var isEmpty: Bool { chunks.isEmpty }

    /// Appends a PCM16 chunk. When the buffer would exceed 30 seconds, the
    /// oldest chunks are dropped to make room — the newest words survive.
    public mutating func push(_ chunk: [Int16]) {
        guard !chunk.isEmpty else { return }
        chunks.append(chunk)
        totalSamples += chunk.count
        while totalSamples > Self.maximumSamples, let oldest = chunks.first {
            totalSamples -= oldest.count
            chunks.removeFirst()
        }
    }

    /// Returns all buffered chunks and resets the buffer.
    public mutating func drain() -> [[Int16]] {
        defer { chunks = []; totalSamples = 0 }
        return chunks
    }
}
