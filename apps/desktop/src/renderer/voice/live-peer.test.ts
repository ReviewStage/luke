import assert from "node:assert/strict";
import { test } from "vitest";
import { createBrowserSilence, type LiveSilenceContext, type LiveSilenceSource } from "./live-peer";

class FakeTrack {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getAudioTracks(): FakeTrack[] {
    return this.tracks;
  }
}

class FakeDestination {
  readonly upstream: LiveSilenceSource[] = [];
  constructor(tracks: FakeTrack[]) {
    // SAFETY: the silence reads the stream's audio tracks and hands them on; nothing else is read off it.
    this.stream = new FakeStream(tracks) as unknown as MediaStream;
  }
  readonly stream: MediaStream;
}

class FakeConstantSource implements LiveSilenceSource {
  readonly offset = { value: 1 };
  started = false;
  stopped = false;
  disconnected = false;
  constructor(private readonly destination: FakeDestination) {}
  connect(destination: AudioNode): void {
    // SAFETY: the fake context hands out one destination, compared by identity.
    assert.equal(destination as unknown, this.destination);
    this.destination.upstream.push(this);
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeAudioContext implements LiveSilenceContext {
  readonly destination: FakeDestination;
  readonly sources: FakeConstantSource[] = [];
  resumed = 0;
  closed = 0;
  constructor(readonly tracks: FakeTrack[] = [new FakeTrack()]) {
    this.destination = new FakeDestination(tracks);
  }
  createMediaStreamDestination(): MediaStreamAudioDestinationNode {
    // SAFETY: the silence reads the node's stream and connects a source into it; nothing else is read off it.
    return this.destination as unknown as MediaStreamAudioDestinationNode;
  }
  createConstantSource(): LiveSilenceSource {
    const source = new FakeConstantSource(this.destination);
    this.sources.push(source);
    return source;
  }
  resume(): Promise<void> {
    this.resumed += 1;
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed += 1;
    return Promise.resolve();
  }
}

test("the destination is fed by one started constant source at offset zero", () => {
  const context = new FakeAudioContext();
  const silence = createBrowserSilence(() => context);

  assert.equal(context.destination.upstream.length, 1);
  const [source] = context.sources;
  assert.equal(context.destination.upstream[0], source);
  assert.equal(source?.offset.value, 0);
  assert.equal(source?.started, true);
  assert.equal(source?.stopped, false);
  assert.equal(context.resumed, 1);
  assert.equal(silence.stream, context.destination.stream);
  assert.equal(silence.track, context.tracks[0]);
});

test("release stops the source, the track, and the context", () => {
  const context = new FakeAudioContext();
  const silence = createBrowserSilence(() => context);

  silence.release();

  const [source] = context.sources;
  assert.equal(source?.stopped, true);
  assert.equal(source?.disconnected, true);
  assert.equal(context.tracks[0]?.stopped, true);
  assert.equal(context.closed, 1);
});

test("a destination that yields no track stops the source and closes the context", () => {
  const context = new FakeAudioContext([]);

  assert.throws(() => createBrowserSilence(() => context));

  assert.equal(context.sources[0]?.stopped, true);
  assert.equal(context.closed, 1);
});
