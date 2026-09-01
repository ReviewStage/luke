import type { ScheduledTimer } from "@sidecar/realtime";
import {
  decodeDialogueAudio,
  dialogueCloseFrame,
  dialogueInputFrame,
  dialogueKeepAliveFrame,
  dialogueVoicesFrame,
  ELEVENLABS_KEEP_ALIVE_MS,
  ELEVENLABS_SAMPLE_RATE,
  elevenlabsDialogueUrl,
  MAXIMUM_DIALOGUE_ERROR_LENGTH,
  parseDialogueFrame,
  TOKEN_MINT_OUTCOME,
} from "@sidecar/speech";
import type { WireRecord } from "@sidecar/wire";
import type { SpeechTokenAnswer } from "#shared/contracts";

/**
 * Saying Luke's words through a service that is not the one writing them.
 *
 * One socket per reply, opened on the reply's first words and closed when the
 * writing service stops generating. The credential it carries is minted for
 * that one socket and spent by it, so nothing here is worth keeping between
 * replies — a tool-only reply, which has no words at all, opens no socket and
 * mints nothing.
 *
 * The session drives this and reads the two things it reports back: that
 * something is audible again, and that everything sent has now been heard.
 * Those are the same two edges the Realtime call reports for its own audio,
 * which is what lets one settle machinery end a reply either way.
 */

export interface SpeechListener {
  /** Audio is playing again, after silence or from the reply's first word. */
  onAudible(): void;
  /** Everything sent has been heard: the service said its last word and playback ran out. */
  onDrained(): void;
  /**
   * The reply cannot be spoken. The words are already drawn — the caption runs
   * from the same deltas — so this reports the failure and the reply settles;
   * it never moves Luke back to the other provider behind the developer's back.
   */
  onError(message: string): void;
}

export interface SpeechSynthesizer {
  /** A fresh reply is beginning; nothing owed to the last one may be heard under it. */
  start(): void;
  /** One delta of the reply now under way, in the order it was generated. */
  append(delta: string): void;
  /**
   * The writing service has finished this reply. Reports whether anything is
   * still owed to be heard, so a reply that never had words to say — a
   * tool-only turn, or one whose socket already failed — ends at once rather
   * than waiting out a drain that will never come.
   */
  finish(): boolean;
  /** Barge-in, Escape, stop, or the call closing: drop everything at once. */
  cancel(): void;
  /** What the panel listens to, the meter reads, and the media duck follows. */
  readonly stream: MediaStream;
  /** The call is over; release the audio graph. */
  close(): void;
}

/**
 * Where decoded samples go. Named as an interface because the socket driver is
 * the part worth testing and Web Audio is the part that cannot be: a fake sink
 * exercises the ordering, the drain, and the interruption without a device.
 */
export interface SpeechAudioSink {
  readonly stream: MediaStream;
  /** Queues one frame at the end of what is already scheduled. */
  play(samples: Float32Array): void;
  /** Milliseconds of audio scheduled but not yet heard. */
  pendingMs(): number;
  /** Drops everything queued, immediately. */
  stop(): void;
  close(): void;
}

/**
 * How far ahead of the clock the first frame of a reply is scheduled. Web
 * Audio drops anything scheduled in the past, and the frames arrive on a
 * network's clock rather than a steady one, so the first buys the ones behind
 * it a little room. Short enough not to be heard as a delay.
 */
const SCHEDULING_LEAD_MS = 80;

/** The Web Audio graph, kept at the rate the frames arrive in so nothing resamples. */
export class WebAudioSpeechSink implements SpeechAudioSink {
  readonly #context: AudioContext;
  readonly #destination: MediaStreamAudioDestinationNode;
  #sources: AudioBufferSourceNode[] = [];
  /** Context time the last scheduled frame ends at; behind the clock while nothing is queued. */
  #playheadAt = 0;

  constructor() {
    this.#context = new AudioContext({ sampleRate: ELEVENLABS_SAMPLE_RATE });
    this.#destination = this.#context.createMediaStreamDestination();
  }

  get stream(): MediaStream {
    return this.#destination.stream;
  }

  play(samples: Float32Array): void {
    if (samples.length === 0) return;
    // A context that has never been resumed schedules nothing; the press that
    // opened the turn is the gesture this rides on.
    void this.#context.resume().catch(() => undefined);
    const buffer = this.#context.createBuffer(1, samples.length, ELEVENLABS_SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const source = this.#context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.#destination);
    const startAt = Math.max(
      this.#playheadAt,
      this.#context.currentTime + SCHEDULING_LEAD_MS / 1000,
    );
    source.start(startAt);
    this.#playheadAt = startAt + buffer.duration;
    this.#sources.push(source);
    source.onended = () => {
      this.#sources = this.#sources.filter((candidate) => candidate !== source);
    };
  }

  pendingMs(): number {
    return Math.max(0, (this.#playheadAt - this.#context.currentTime) * 1000);
  }

  stop(): void {
    for (const source of this.#sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // A source that never started, or has already ended, refuses the stop;
        // either way there is nothing left of it to hear.
      }
      source.disconnect();
    }
    this.#sources = [];
    this.#playheadAt = 0;
  }

  close(): void {
    this.stop();
    void this.#context.close().catch(() => undefined);
  }
}

/** The socket members this file touches, so a test can answer for the network. */
export interface SpeechSocket {
  readyState: number;
  send(payload: string): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
}

export interface ElevenLabsSpeechOptions {
  voiceId: string;
  listener: SpeechListener;
  sink: SpeechAudioSink;
  /** Mints the one credential the next socket carries; never cached between replies. */
  mintToken: () => Promise<SpeechTokenAnswer>;
  createSocket?: (url: string) => SpeechSocket;
  /** The timers the keepalive and the drain run on, injectable for the same reason. */
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancelScheduled?: (timer: ScheduledTimer) => void;
}

const SOCKET_OPEN = 1;

const SOCKET_FAILURE_MESSAGE = "The speech connection closed before Luke finished speaking";

/**
 * What a close says about itself. ElevenLabs refuses a model, a voice, or a
 * credential by closing the socket rather than by an error frame, and the code
 * and reason it closes with are the only account of why — a sentence that
 * withholds them names a failure nobody can act on. A handshake refused before
 * the socket ever opened closes abnormally with no reason at all, so the code
 * stands in for one.
 */
function socketFailureMessage(event: CloseEvent): string {
  const reason = event.reason?.trim().slice(0, MAXIMUM_DIALOGUE_ERROR_LENGTH);
  if (reason) return `${SOCKET_FAILURE_MESSAGE}: ${reason}`;
  return `${SOCKET_FAILURE_MESSAGE} (code ${event.code}).`;
}

export class ElevenLabsSpeech implements SpeechSynthesizer {
  readonly #options: ElevenLabsSpeechOptions;
  #socket: SpeechSocket | undefined;
  /**
   * Which reply the socket and its callbacks belong to. Every start and every
   * cancel bumps it, so an open, a frame, or a mint answering after the reply
   * it was for has gone lands on a stale generation and is dropped rather than
   * spoken over the reply that replaced it.
   */
  #generation = 0;
  /** Deltas generated before the socket opened, sent in order the moment it does. */
  #queued: string[] = [];
  #opening = false;
  /** The reply's words are all sent; the socket has been asked to close. */
  #finished = false;
  /** The service said its last word; what is left is what is still playing. */
  #ended = false;
  /** Anything was ever sent for this reply, which is what makes a drain owed at all. */
  #spoke = false;
  /** The socket failed, so nothing more will be heard of this reply. */
  #failed = false;
  #drained = false;
  #audible = false;
  #keepAliveTimer: ScheduledTimer | undefined;
  #drainTimer: ScheduledTimer | undefined;

  constructor(options: ElevenLabsSpeechOptions) {
    this.#options = options;
  }

  get stream(): MediaStream {
    return this.#options.sink.stream;
  }

  start(): void {
    this.#reset();
  }

  append(delta: string): void {
    if (delta === "") return;
    this.#spoke = true;
    const socket = this.#socket;
    if (socket && socket.readyState === SOCKET_OPEN) {
      this.#send(dialogueInputFrame(this.#options.voiceId, delta));
      return;
    }
    this.#queued.push(delta);
    if (!this.#opening && !this.#failed) void this.#open();
  }

  finish(): boolean {
    this.#finished = true;
    if (!this.#spoke || this.#failed) return false;
    const socket = this.#socket;
    if (socket && socket.readyState === SOCKET_OPEN) this.#send(dialogueCloseFrame());
    this.#clearKeepAlive();
    return true;
  }

  cancel(): void {
    this.#reset();
  }

  close(): void {
    this.#reset();
    this.#options.sink.close();
  }

  #reset(): void {
    this.#generation += 1;
    this.#queued = [];
    this.#opening = false;
    this.#finished = false;
    this.#ended = false;
    this.#spoke = false;
    this.#failed = false;
    this.#drained = false;
    this.#audible = false;
    this.#clearKeepAlive();
    this.#clearDrainTimer();
    const socket = this.#socket;
    this.#socket = undefined;
    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.close();
    }
    this.#options.sink.stop();
  }

  async #open(): Promise<void> {
    this.#opening = true;
    const generation = this.#generation;
    // Minted for this socket alone, at the moment the socket is wanted: a
    // token held from the last reply would be one already spent.
    const answer = await this.#options.mintToken().catch(() => undefined);
    if (generation !== this.#generation) return;
    if (!answer || answer.outcome !== TOKEN_MINT_OUTCOME.OK || !answer.token) {
      this.#fail(answer?.explanation ?? "Luke could not reach the speech service.");
      return;
    }
    const socket = (this.#options.createSocket ?? defaultSocket)(
      elevenlabsDialogueUrl(answer.token),
    );
    this.#socket = socket;
    socket.onopen = () => {
      if (generation !== this.#generation) return;
      this.#send(dialogueVoicesFrame(this.#options.voiceId));
      const queued = this.#queued;
      this.#queued = [];
      for (const delta of queued) this.#send(dialogueInputFrame(this.#options.voiceId, delta));
      // The reply finished generating while the socket was still opening, so
      // the flush above was the whole of it and the turn closes behind it.
      if (this.#finished) this.#send(dialogueCloseFrame());
    };
    socket.onmessage = (event) => {
      if (generation !== this.#generation) return;
      this.#readFrame(event.data);
    };
    socket.onerror = () => {
      // Every socket error is followed by a close, and the close is the one
      // that knows why. Reporting here would win the race and say less.
    };
    socket.onclose = (event) => {
      if (generation !== this.#generation) return;
      // A close after the service's last word is the ordinary ending, and the
      // drain already armed decides when the reply is over. A close before it
      // is the reply lost, and the turn must still settle.
      if (this.#ended) return;
      this.#fail(socketFailureMessage(event));
    };
  }

  #readFrame(payload: string): void {
    const frame = parseDialogueFrame(payload);
    if (!frame) return;
    if (frame.error) {
      this.#fail(frame.error);
      return;
    }
    if (frame.audio) {
      const samples = decodeDialogueAudio(frame.audio);
      if (samples.length > 0) {
        this.#options.sink.play(samples);
        if (!this.#audible) {
          this.#audible = true;
          this.#options.listener.onAudible();
        }
      }
    }
    if (frame.final || frame.finalForTurn) {
      this.#ended = true;
      this.#armDrain();
    }
  }

  /**
   * Reports the reply drained once what is scheduled has been heard. Re-armed
   * rather than fixed at the moment the service stopped talking: a frame can
   * arrive alongside the one that ends the turn, and a drain measured before
   * it would cut the last words off the end.
   */
  #armDrain(): void {
    this.#clearDrainTimer();
    if (this.#drained) return;
    const pendingMs = this.#options.sink.pendingMs();
    if (pendingMs <= 0) {
      this.#drained = true;
      this.#options.listener.onDrained();
      return;
    }
    this.#drainTimer = (this.#options.schedule ?? setTimeout)(() => {
      this.#drainTimer = undefined;
      this.#armDrain();
    }, pendingMs);
  }

  /**
   * The reply cannot be finished. The words already drawn stay drawn, the
   * failure is said once, and the turn is released — a reply held open on a
   * socket that will never speak again is worse than one that ends early.
   */
  #fail(message: string): void {
    if (this.#failed) return;
    this.#failed = true;
    this.#clearKeepAlive();
    this.#clearDrainTimer();
    this.#options.listener.onError(message);
    if (!this.#drained) {
      this.#drained = true;
      this.#options.listener.onDrained();
    }
  }

  #send(frame: WireRecord): void {
    const socket = this.#socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) return;
    socket.send(JSON.stringify(frame));
    this.#armKeepAlive();
  }

  /**
   * Keeps the socket open across a gap between two deltas. The service closes
   * one idle for twenty seconds, and the gap being covered is the model still
   * thinking — a socket closed under one loses the reply rather than delaying
   * it. Nothing is pinged once the turn has been closed.
   */
  #armKeepAlive(): void {
    this.#clearKeepAlive();
    if (this.#finished) return;
    const generation = this.#generation;
    this.#keepAliveTimer = (this.#options.schedule ?? setTimeout)(() => {
      this.#keepAliveTimer = undefined;
      if (generation !== this.#generation || this.#finished) return;
      this.#send(dialogueKeepAliveFrame());
    }, ELEVENLABS_KEEP_ALIVE_MS);
  }

  #clearKeepAlive(): void {
    if (this.#keepAliveTimer === undefined) return;
    // SAFETY: Without an injected scheduler the handle came from setTimeout itself.
    (this.#options.cancelScheduled ?? clearTimeout)(this.#keepAliveTimer as number);
    this.#keepAliveTimer = undefined;
  }

  #clearDrainTimer(): void {
    if (this.#drainTimer === undefined) return;
    // SAFETY: Without an injected scheduler the handle came from setTimeout itself.
    (this.#options.cancelScheduled ?? clearTimeout)(this.#drainTimer as number);
    this.#drainTimer = undefined;
  }
}

function defaultSocket(url: string): SpeechSocket {
  return new WebSocket(url);
}
