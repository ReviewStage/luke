import type { JsonValue, ParsedJsonObject } from "@sidecar/wire/testing";
import type { PeerConnection } from "#renderer/realtime-session";

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

export interface MockDataChannel {
  readyState: "connecting" | "open" | "closed";
  send: (payload: string) => void;
  close: () => void;
  onmessage?: ((event: { data: string | JsonValue }) => void) | null;
  onclose?: (() => void) | null;
}

export interface MockRtpSender {
  replaceTrack: (next: MockMediaTrack | null) => Promise<void>;
}

export interface MockMediaTrack {
  readonly kind: string;
}

export interface MockTransceiverInit {
  direction?: string;
}

export interface MockPeerConnection {
  localDescription: RTCSessionDescriptionInit;
  connectionState: RTCPeerConnectionState | "connected" | "closed";
  addTransceiver: (kind: string, init?: MockTransceiverInit) => { sender: MockRtpSender };
  createDataChannel: () => MockDataChannel;
  createOffer: () => Promise<RTCSessionDescriptionInit>;
  setLocalDescription: () => Promise<void>;
  setRemoteDescription: () => Promise<void>;
  close: () => void;
  ontrack?: ((event: MockTrackEvent) => void) | null;
  onconnectionstatechange?: (() => void) | null;
}

/** Fixture audio stream implementing only the MediaStream surface the session opens. */
export function asMediaStream(stream: MockMediaStream): MediaStream {
  // SAFETY: Fixture audio stream implements only the MediaStream surface the session opens.
  return stream as MediaStream;
}

/** Fixture peer connection, which is the surface the session names, not a cast. */
export function asPeerConnection(peer: MockPeerConnection): PeerConnection {
  return peer;
}

/** Parsed realtime client event from JSON sent over the data channel. */
export function parseClientEvent(payload: string): ParsedJsonObject {
  // SAFETY: Parsed JSON matches the realtime client event shape this harness records.
  return JSON.parse(payload) as ParsedJsonObject;
}
