export interface MockAudioTrack {
  enabled: boolean;
  stop: () => void;
}

export interface MockMediaStream {
  getAudioTracks: () => MockAudioTrack[];
  getTracks: () => MockAudioTrack[];
}

export interface MockTrackEvent {
  track: { enabled: boolean };
  streams: readonly object[];
}

export interface MockRtpSender {
  track: MockMediaTrack | null;
  replaceTrack: (next: MockMediaTrack | null) => Promise<void>;
}

export interface MockMediaTrack {
  readonly kind: string;
}

export interface MockPeerConnection {
  connectionState: RTCPeerConnectionState | "connected" | "closed";
  getSenders: () => MockRtpSender[];
  addEventListener: (type: "connectionstatechange", listener: () => void) => void;
  ontrack?: ((event: MockTrackEvent) => void) | null;
}

/** Fixture audio stream implementing only the MediaStream surface the session opens. */
export function asMediaStream(stream: MockMediaStream): MediaStream {
  // SAFETY: Fixture audio stream implements only the MediaStream surface the session opens.
  return stream as MediaStream;
}

/** Fixture track implementing only identity and kind, which the session reads. */
export function asMediaTrack(track: MockMediaTrack): MediaStreamTrack {
  // SAFETY: The session uses this synthetic track only to find its sender and restore it.
  return track as MediaStreamTrack;
}

/** Fixture peer connection implementing only the browser surface the session reads. */
export function asPeerConnection(peer: MockPeerConnection): RTCPeerConnection {
  // SAFETY: The session reads only getSenders, ontrack, and connection state changes.
  return peer as RTCPeerConnection;
}
