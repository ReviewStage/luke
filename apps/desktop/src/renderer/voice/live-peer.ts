import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";

/**
 * The WebRTC peer the voice window is, as the WebRTC guide builds one: the
 * microphone track added first, the `oai-events` data channel created before
 * the offer, ICE gathered under a bound, the offer handed to the host that
 * holds the key, and the host's answer applied. The HTTP request the host
 * makes is what starts the session, so nothing here sends `session.start`.
 * The peer is written over the narrowest slice of the browser's objects the
 * peer touches, so a test can stand a fake in for each without a browser.
 */

/** How long ICE gathering may run before the offer goes with what it has. */
const ICE_GATHERING_TIMEOUT_MS = 5_000;

/** The label the guide gives the event channel. */
export const LIVE_EVENTS_CHANNEL_LABEL = "oai-events";

const ICE_GATHERING_COMPLETE = "complete";

export interface LiveDataChannel {
  readonly readyState: string;
  send(data: string): void;
  close(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: Event) => void) | null;
}

export interface LiveTrackSender {
  replaceTrack(track: MediaStreamTrack | null): Promise<void>;
}

export interface LivePeerConnection {
  readonly connectionState: string;
  readonly iceGatheringState: string;
  readonly localDescription: { readonly sdp: string } | null;
  createDataChannel(label: string): LiveDataChannel;
  addTrack(track: MediaStreamTrack, stream: MediaStream): LiveTrackSender;
  /** A sending audio line with no track yet, for a session opened before the microphone is granted. */
  addTransceiver(kind: "audio", init: { direction: "sendrecv" }): { sender: LiveTrackSender };
  createOffer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  close(): void;
  onicegatheringstatechange: ((event: Event) => void) | null;
  onconnectionstatechange: ((event: Event) => void) | null;
  ontrack: ((event: RTCTrackEvent) => void) | null;
}

export interface LivePeerSeams {
  createPeerConnection: () => LivePeerConnection;
  /** The preferred capture device; a refusal opens the session with no track until the first unmute. */
  openMicrophone: () => Promise<MediaStream>;
  /** The host: the peer's offer becomes the one session, answered with the SDP the peer sets. */
  createSession: (sdp: string) => Promise<{ sessionId: string; sdpAnswer: string } | undefined>;
  onRemoteStream: (stream: MediaStream) => void;
  schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel: (timer: ScheduledTimer) => void;
}

export interface LivePeer {
  connection: LivePeerConnection;
  channel: LiveDataChannel;
  /** The developer's track, disabled until the session is unmuted; absent when the microphone was refused. */
  microphone: MediaStreamTrack | undefined;
  microphoneStream: MediaStream | undefined;
  sender: LiveTrackSender;
}

export const LIVE_PEER_OUTCOME = {
  OPENED: "opened",
  /** The host created no session for the offer, or the browser could not build the peer or set the answer. */
  FAILED: "failed",
} as const;

export type LivePeerOpening =
  | { outcome: typeof LIVE_PEER_OUTCOME.OPENED; peer: LivePeer }
  | { outcome: typeof LIVE_PEER_OUTCOME.FAILED; message: string };

const SESSION_REFUSED_MESSAGE = "Luke could not open a voice session.";

async function gatherIce(connection: LivePeerConnection, seams: LivePeerSeams): Promise<void> {
  if (connection.iceGatheringState === ICE_GATHERING_COMPLETE) return;
  await new Promise<void>((resolve) => {
    const timer = seams.schedule(() => {
      connection.onicegatheringstatechange = null;
      resolve();
    }, ICE_GATHERING_TIMEOUT_MS);
    connection.onicegatheringstatechange = () => {
      if (connection.iceGatheringState !== ICE_GATHERING_COMPLETE) return;
      seams.cancel(timer);
      connection.onicegatheringstatechange = null;
      resolve();
    };
  });
}

/**
 * Opens the peer in the guide's order. The microphone rides the offer with
 * its track disabled, so a session opened for Luke's own speech hears nothing
 * until the talk key; a microphone the system refuses leaves a sending line
 * with no track, which the first unmute fills.
 */
export async function openLivePeer(seams: LivePeerSeams): Promise<LivePeerOpening> {
  let connection: LivePeerConnection | undefined;
  let microphoneStream: MediaStream | undefined;
  try {
    connection = seams.createPeerConnection();
    connection.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      seams.onRemoteStream(stream);
    };
    let microphone: MediaStreamTrack | undefined;
    try {
      microphoneStream = await seams.openMicrophone();
      microphone = microphoneStream.getAudioTracks()[0];
    } catch {
      microphoneStream = undefined;
    }
    let sender: LiveTrackSender;
    if (microphone && microphoneStream) {
      microphone.enabled = false;
      sender = connection.addTrack(microphone, microphoneStream);
    } else {
      sender = connection.addTransceiver("audio", { direction: "sendrecv" }).sender;
    }
    const channel = connection.createDataChannel(LIVE_EVENTS_CHANNEL_LABEL);
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await gatherIce(connection, seams);
    const sdp = connection.localDescription?.sdp;
    if (!sdp) throw new Error("the peer produced no local description");
    const created = await seams.createSession(sdp);
    if (!created) {
      teardown(connection, microphoneStream);
      return { outcome: LIVE_PEER_OUTCOME.FAILED, message: SESSION_REFUSED_MESSAGE };
    }
    await connection.setRemoteDescription({ type: "answer", sdp: created.sdpAnswer });
    return {
      outcome: LIVE_PEER_OUTCOME.OPENED,
      peer: {
        connection,
        channel,
        microphone,
        microphoneStream,
        sender,
      },
    };
  } catch (error) {
    if (connection) teardown(connection, microphoneStream);
    return {
      outcome: LIVE_PEER_OUTCOME.FAILED,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Closes the peer and stops the capture device it opened. */
export function teardown(
  connection: LivePeerConnection,
  microphoneStream: MediaStream | undefined,
): void {
  for (const track of microphoneStream?.getTracks() ?? []) track.stop();
  connection.close();
}
