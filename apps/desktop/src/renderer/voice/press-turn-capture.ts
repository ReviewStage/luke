import {
  clearInputAudioEvents,
  inputAudioAppendEvents,
  inputAudioFormatUpdateEvents,
  PressAudioBuffer,
} from "@sidecar/realtime";
import type { WireRecord } from "@sidecar/wire";
import {
  createPressCaptureSource,
  type PressCaptureFactory,
  type PressCaptureSource,
} from "./press-audio-capture";

/**
 * The browser piece a captured turn hands its track back to, stated as the
 * one member this file touches rather than as the whole `RTCRtpSender`. A real
 * sender satisfies this; the whole browser type does not work the other way,
 * because the thirty-odd members no test can supply would mean the injection
 * point could only ever take the real thing — which is the opposite of why it
 * exists.
 */
export interface MicrophoneSender {
  replaceTrack(next: MediaStreamTrack | null): Promise<void>;
}

/** The open capture device a press is being read from, as the capture needs it. */
export interface PressCaptureDevice {
  stream: MediaStream;
  track: MediaStreamTrack;
  /** The sender the track rides once the captured turn is over; absent before the handshake. */
  sender: MicrophoneSender | undefined;
}

export interface PressTurnCaptureOptions {
  send(events: readonly WireRecord[]): void;
  /**
   * The local PCM capture a press runs while its call is still connecting.
   * Injectable on the browser pieces' own terms: the cold-press seam is a
   * state machine worth testing without a real audio graph.
   */
  createSource?: PressCaptureFactory;
  /** The device the press opened, read afresh at each step. */
  device(): PressCaptureDevice | undefined;
  connected(): boolean;
}

/**
 * The words a press speaks before its call can carry them: a local PCM
 * capture off the press's own device, buffered until the data channel opens.
 *
 * The seam between the captured words and the live WebRTC track is decided
 * deliberately: the whole of the turn the press opened travels as appends, and
 * the track joins the sender only when that turn is over. Appends ride the
 * ordered data channel while the track rides RTP, and the server writes one
 * input buffer in arrival order — so any turn that mixed the two would have an
 * unorderable seam where a late append lands after the first live frames and
 * words swap, double, or drop. On one channel every chunk lands exactly once,
 * in capture order, with the commit behind the last of them. Handing over
 * between turns is safe because every turn opens by clearing the buffer: there
 * is nothing across that seam to double.
 *
 * One capture belongs to exactly one connect attempt: the call discards it on
 * every path that ends the attempt, so no press can leave audio behind for a
 * later connection.
 */
export class PressTurnCapture {
  readonly #options: PressTurnCaptureOptions;
  /**
   * The capture reading the device — absent once the press was released — and
   * the buffer holding what it has heard until the channel can carry it.
   */
  #state: { source: PressCaptureSource | undefined; buffer: PressAudioBuffer } | undefined;
  /**
   * A press released while the call was still connecting, with words already
   * captured. The turn it held is over — the capture stops reading and the
   * device closes at the release — but what it heard is owed a delivery.
   */
  #commitPending = false;
  /** Whether the turn now under way travels as appends rather than the track. */
  #onAppends = false;

  constructor(options: PressTurnCaptureOptions) {
    this.#options = options;
  }

  /** Whether a press's words are being held for a turn. */
  get active(): boolean {
    return this.#state !== undefined;
  }

  get onAppends(): boolean {
    return this.#onAppends;
  }

  /** Whether a released press left sealed words owed a delivery. */
  get commitPending(): boolean {
    return this.#commitPending;
  }

  /** Whether nothing has been heard toward this press. */
  get empty(): boolean {
    return this.#state?.buffer.isEmpty ?? true;
  }

  /**
   * Starts capturing the press's words. Harmless to ask again: with something
   * already reading the device it does nothing, and with no device open there
   * is nothing to read.
   *
   * A press landing again over words a release already sealed re-opens the
   * same turn: the delivery the release was owed is superseded — this press's
   * own release decides afresh — and capture resumes into the same buffer, so
   * neither press's words are lost.
   */
  begin(): void {
    if (this.#state?.source) return;
    const device = this.#options.device();
    if (!device) return;
    this.#commitPending = false;
    const state = this.#state ?? { source: undefined, buffer: new PressAudioBuffer() };
    const buffer = state.buffer;
    this.#state = state;
    state.source = (this.#options.createSource ?? createPressCaptureSource)(
      device.stream,
      (chunk) => {
        // A chunk from a capture this object has already let go of belongs to
        // no turn and goes nowhere.
        if (this.#state !== state) return;
        if (this.#onAppends) {
          this.#options.send(inputAudioAppendEvents(chunk));
          return;
        }
        buffer.push(chunk);
      },
    );
    // The capture reads the track, and a disabled track reads as silence to
    // every consumer — so the track is open exactly while the capture is. The
    // sender carries no track yet, so nothing reaches the network.
    device.track.enabled = true;
  }

  /**
   * The press was released mid-handshake: stop reading the device, keep what
   * was heard. The words wait in memory, not on an open microphone — the track
   * closes with the source that was reading it, so the invariant every path
   * out of here keeps is that the track is open exactly while a source reads
   * it. Without it a sealed capture would hand the sender a live microphone
   * when it retired.
   */
  seal(): void {
    const state = this.#state;
    if (!state) return;
    state.source?.stop();
    state.source = undefined;
    this.#commitPending = true;
    const device = this.#options.device();
    if (device) device.track.enabled = false;
  }

  /**
   * Opens the turn a still-held press has been capturing: the words captured
   * so far flush behind a clean buffer, and the capture keeps appending live
   * from here — the track stays off the sender, because the whole of this turn
   * travels on the one ordered channel.
   */
  openTurn(): void {
    const state = this.#state;
    if (!state) return;
    this.#flush(state.buffer);
    this.#onAppends = true;
  }

  /**
   * Delivers the turn a press held and released while the call was still
   * connecting: the captured words flush as appends and the capture retires,
   * leaving the caller to commit the turn the release already closed. Reports
   * whether there was anything to deliver.
   */
  deliverSealed(): boolean {
    const state = this.#state;
    if (!state || !this.#commitPending) return false;
    this.#commitPending = false;
    this.#flush(state.buffer);
    this.reset();
    return true;
  }

  /**
   * Ends the capture, discarding whatever it still holds, and hands the
   * device's track to the sender so the turns after the seam ride WebRTC as
   * every turn did before it. Every path out of the captured-turn machinery
   * ends here — the seam settling, a discarded press, a failed attempt — so
   * none of them can leave the capture reading the device.
   */
  reset(): void {
    const state = this.#state;
    this.#state = undefined;
    this.#onAppends = false;
    this.#commitPending = false;
    state?.source?.stop();
    const device = this.#options.device();
    // The track was open for the capture to read; nothing reads it now, so it
    // closes until a turn opens it.
    if (state?.source && device) device.track.enabled = false;
    if (state && this.#options.connected() && device?.sender) {
      void device.sender.replaceTrack(device.track).catch(() => undefined);
    }
  }

  /**
   * Sends one captured turn's opening, in the one order the service accepts
   * it: the format the appends are to be read as, then a clear, then the held
   * audio. Appends ahead of either are read against whatever the last turn
   * left behind.
   */
  #flush(buffer: PressAudioBuffer): void {
    this.#options.send(inputAudioFormatUpdateEvents());
    this.#options.send(clearInputAudioEvents());
    for (const chunk of buffer.drain()) {
      this.#options.send(inputAudioAppendEvents(chunk));
    }
  }
}
