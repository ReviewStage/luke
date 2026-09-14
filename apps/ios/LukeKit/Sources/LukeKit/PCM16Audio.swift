import Foundation

/// PCM16 mono as the audio route carries it in both directions: the raw
/// little-endian bytes, base64 in JSON, with no container header. The watch
/// sends its microphone this way in `session.input_audio.append` and reads
/// Luke's voice this way out of `session.output_audio.delta`; the guide asks
/// that a chunk hold complete samples, so its byte length is always even.
public enum PCM16Audio {
    /// The samples as the wire carries them.
    public static func base64(_ samples: [Int16]) -> String {
        samples.map(\.littleEndian).withUnsafeBytes { Data($0) }.base64EncodedString()
    }

    /// The samples a wire value carries, or nothing for text that is not
    /// base64 or that splits a sample.
    public static func samples(base64: String) -> [Int16]? {
        guard let bytes = Data(base64Encoded: base64), bytes.count % 2 == 0 else { return nil }
        return bytes.withUnsafeBytes { raw in
            (0 ..< raw.count / 2).map { Int16(littleEndian: raw.loadUnaligned(fromByteOffset: $0 * 2, as: Int16.self)) }
        }
    }

    /// Luke's voice as the audio route relays it: the samples a
    /// `session.output_audio.delta` frame carries in `delta`, in the format the
    /// session was created under, or nothing for an event of another type or
    /// one whose `delta` is not PCM16 in base64. Read off the relayed frame
    /// rather than the renderer grammar in `LiveEvents.swift`, since that
    /// grammar is what a data channel shows and a data channel carries no
    /// audio.
    public static func samples(in frame: LiveServerEventFrame) -> [Int16]? {
        guard frame.type == VoiceServiceContract.outputAudioDelta,
              let delta = frame.payload["delta"]?.stringValue
        else { return nil }
        return samples(base64: delta)
    }
}
