import XCTest

@testable import LukeKit

final class PressAudioBufferTests: XCTestCase {
    func testEmptyOnInit() {
        let buf = PressAudioBuffer()
        XCTAssertTrue(buf.isEmpty)
        XCTAssertEqual(buf.bufferedMs, 0)
    }

    func testPushAndDrainRoundTrip() {
        var buf = PressAudioBuffer()
        let chunk: [Int16] = [1, 2, 3, 4]
        buf.push(chunk)
        XCTAssertFalse(buf.isEmpty)
        let drained = buf.drain()
        XCTAssertEqual(drained.count, 1)
        XCTAssertEqual(drained[0], chunk)
        XCTAssertTrue(buf.isEmpty)
    }

    func testDrainEmptiesBuffer() {
        var buf = PressAudioBuffer()
        buf.push([1, 2])
        buf.push([3, 4])
        _ = buf.drain()
        XCTAssertTrue(buf.isEmpty)
        XCTAssertEqual(buf.bufferedMs, 0)
    }

    func testBufferedMsMatchesSampleRate() {
        var buf = PressAudioBuffer()
        // One second of audio = sampleRate samples.
        let oneSecond = [Int16](repeating: 0, count: PressAudioBuffer.sampleRate)
        buf.push(oneSecond)
        XCTAssertEqual(buf.bufferedMs, 1000)
    }

    func testIgnoresEmptyChunk() {
        var buf = PressAudioBuffer()
        buf.push([])
        XCTAssertTrue(buf.isEmpty)
    }

    func testTrimsOldestWhenOverCeiling() {
        var buf = PressAudioBuffer()
        // Fill with slightly over 30 seconds of audio.
        let chunkSamples = PressAudioBuffer.sampleRate  // 1 second per chunk
        let firstChunk: [Int16] = [Int16](repeating: 1, count: chunkSamples)
        let noisyChunk: [Int16] = [Int16](repeating: 2, count: chunkSamples)
        // Push 30 chunks (30 seconds) of first marker
        for _ in 0 ..< 30 { buf.push(firstChunk) }
        // Push one more chunk over the limit — oldest should be trimmed
        buf.push(noisyChunk)
        let drained = buf.drain()
        // Should have exactly 30 chunks (ceiling maintained)
        XCTAssertEqual(drained.count, 30)
        // The first retained chunk is the second firstChunk (the very first was dropped)
        XCTAssertEqual(drained[0][0], 1)
        // The last chunk is the noisy one
        XCTAssertEqual(drained[29][0], 2)
    }

    func testMultipleDrainCallsAreIdempotent() {
        var buf = PressAudioBuffer()
        buf.push([1, 2, 3])
        _ = buf.drain()
        let second = buf.drain()
        XCTAssertEqual(second.count, 0)
        XCTAssertTrue(buf.isEmpty)
    }
}
