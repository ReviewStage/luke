import {
  type AppGuideSnapshot,
  type AttentionSpeech,
  appGuideContextEvents,
  appGuideContextText,
  appToolAction,
  type CarriedAppAction,
  type CarriedIssueAction,
  type CarriedSessionAction,
  CONTEXT_ITEM_KIND,
  type ContextItemKind,
  cancelResponseEvents,
  clearInputAudioEvents,
  contextItemId,
  contextSupersedeEventId,
  contextSupersedeEvents,
  EMPTY_APP_GUIDE,
  functionCallFollowUpEvents,
  functionCallOutputEvents,
  ISSUE_TRACKER_DISCONNECTED_TEXT,
  issueContextEvents,
  issueContextText,
  issueToolAction,
  issueTrackerDisconnectedEvents,
  lastAnnouncementContextEvents,
  lastAnnouncementContextText,
  type NormalizedSession,
  type ObservedWorkspaceProject,
  outputSpeedUpdateEvents,
  parseRealtimeServerEvent,
  positiveInteger,
  proactiveSpeechEvents,
  pushToTalkCommitEvents,
  REALTIME_DATA_CHANNEL,
  REALTIME_SERVER_EVENT,
  REALTIME_STATUS,
  REALTIME_TOOL_FAMILY,
  type RealtimeConnection,
  type RealtimeFunctionCall,
  type RealtimeStatus,
  type RealtimeToolFamily,
  realtimeToolFamily,
  SESSION_REFERENCE_WITHDRAWN_TEXT,
  type SessionIdentity,
  type SessionNoticeAsk,
  sessionContextEvents,
  sessionContextText,
  sessionReferenceContextEvents,
  sessionReferenceContextText,
  sessionReferenceWithdrawnEvents,
  sessionToolAction,
  type TrackedIssue,
  truncateResponseEvents,
  typedAskEvents,
  workspaceProjectContextEvents,
  workspaceProjectContextText,
} from "@sidecar/core";
import { workspaceAgentModels } from "../shared/workspace-agents";
import { MICROPHONE_PROCESSING } from "./microphone-choice";

const SDP_CONTENT_TYPE = "application/sdp";

/** Bounds the SDP exchange and the data channel opening, together. */
const CONNECT_TIMEOUT_MS = 15_000;

/**
 * How long a finished generation may go on playing before the turn is ended
 * anyway. It is a backstop for a reply that produced no audio at all — or one
 * whose audio drained while its `response.done` never arrived — not the
 * normal path: a spoken reply ends when it goes quiet.
 */
export const REALTIME_SETTLE_TIMEOUT_MS = 20_000;

/**
 * How long the developer's call stays open with nothing being said on it.
 *
 * The capture device never rides this clock — it opens with a press and
 * closes with the turn — so what ten minutes buys is the conversation itself:
 * the thread Luke would otherwise lose. The service ends the session at an
 * hour regardless, so the choice was never between keeping this conversation
 * and losing it — only between letting go of it deliberately and being cut
 * off mid-sentence.
 *
 * Ten minutes is longer than any pause inside a conversation and shorter than
 * the walk to get a coffee. Coming back costs one handshake.
 */
export const VOICE_IDLE_TIMEOUT_MS = 10 * 60_000;

/**
 * The order context is flushed in, so a turn's items land the same way every
 * time: what Luke can see, then which session is under discussion, then what
 * he last announced, then where he can create, then what he knows about
 * himself, then what the tracker lists.
 */
const CONTEXT_FLUSH_ORDER: readonly ContextItemKind[] = [
  CONTEXT_ITEM_KIND.SESSIONS,
  CONTEXT_ITEM_KIND.SESSION_REFERENCE,
  CONTEXT_ITEM_KIND.LAST_ANNOUNCEMENT,
  CONTEXT_ITEM_KIND.WORKSPACE_PROJECTS,
  CONTEXT_ITEM_KIND.APP_GUIDE,
  CONTEXT_ITEM_KIND.ISSUES,
];

/**
 * How many unanswered deletes are worth remembering. One flush issues at most
 * one per kind, and each is answered within the round trip, so this is already
 * two turns' worth of room for something that ordinarily clears immediately.
 */
const MAXIMUM_PENDING_SUPERSEDES = CONTEXT_FLUSH_ORDER.length * 2;

/**
 * One kind of context as it is waiting to be said: the words, for telling an
 * unchanged answer from a fresh one, and how to build the item once it has a
 * name to occupy.
 */
interface PendingContext {
  text: string;
  build: (itemId: string) => readonly Record<string, unknown>[];
}

/** A context item this call put in the conversation, and what it says. */
interface LiveContext {
  itemId: string;
  text: string;
}

/**
 * The backstop for a reply whose ending never arrives.
 *
 * `output_audio_buffer.stopped` is what actually ends a reply now, so this only
 * has to catch a call where that never came. It is long because the thing it
 * must not mistake for an ending is a pause between two sentences: at 700ms it
 * did exactly that, taking the meter and the face down while Luke talked on
 * into the second one. The meter itself calls quiet after a fifth of a second,
 * which is shorter still, so a turn that ended on the meter's edge would do
 * the same.
 */
export const REMOTE_QUIET_MS = 2_500;

/**
 * Carries one validated action to the process that can perform it, answering
 * with what became of it. The renderer validates a tool call against the
 * observed roster before this is called, and the main process validates it
 * again against its registry — the carrier is a courier, not a gate.
 */
export type SessionActionCarrier = (
  action: CarriedSessionAction,
) => Promise<Record<string, unknown>>;

/**
 * Carries one validated app-level act — a settings change, the panel being
 * shown, or the feedback composer brought up — to the renderer that can
 * perform it. The same posture as the session carrier: validation happened
 * against the guide before this is called, and the carrier only performs and
 * reports. Nothing here sends a note: the feedback act opens the composer,
 * and what it holds leaves only by its own Send button.
 */
export type AppActionCarrier = (action: CarriedAppAction) => Promise<Record<string, unknown>>;

/** The issue half of the same courier: validated here, validated again in main. */
export type IssueActionCarrier = (action: CarriedIssueAction) => Promise<Record<string, unknown>>;

export interface RealtimeVoiceSessionCallbacks {
  onStatus(status: RealtimeStatus): void;
  onLocalStream(stream: MediaStream | undefined): void;
  onRemoteStream(stream: MediaStream | undefined): void;
  onError(message: string | undefined): void;
  /**
   * The text of the reply Luke is currently speaking, growing as it is
   * generated, or undefined once there is nothing being spoken. The session
   * owns the whole lifecycle — the caption clears when the reply ends, is cut
   * off, or the call closes — so the caller only ever draws what it is handed.
   * `about` is the session a proactive announcement names, carried from the
   * roster-validated update `speak()` was handed and living exactly as long as
   * that reply; a conversation reply carries none.
   */
  onCaption(text: string | undefined, about: SessionIdentity | undefined): void;
}

export interface RealtimeVoiceSessionOptions extends RealtimeVoiceSessionCallbacks {
  requestConnection(): Promise<RealtimeConnection | undefined>;
  /** Absent means Luke can only speak: every tool call is refused with a reason. */
  carryAction?: SessionActionCarrier;
  /** Absent means spoken asks about Luke himself are refused with a reason. */
  carryAppAction?: AppActionCarrier;
  /** Absent means issues can only be recited: every issue call is refused. */
  carryIssueAction?: IssueActionCarrier;
  /**
   * The browser pieces, injectable so the microphone state machine can be
   * exercised without a real device or peer connection. Push-to-talk decides
   * when a microphone is live, which is worth testing directly.
   */
  createPeerConnection?: () => RTCPeerConnection;
  requestMicrophoneStream?: () => Promise<MediaStream>;
  exchangeDescription?: (url: string, init: RequestInit) => Promise<Response>;
  connectTimeoutMs?: number;
  /**
   * How long a call may sit idle before it is put away. Injectable so the
   * retirement can be exercised without waiting ten real minutes.
   */
  idleTimeoutMs?: number;
  /** The timer the idle retirement runs on, injectable for the same reason. */
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (timer: unknown) => void;
  /** Injectable so a test can hold the clock a truncate measures against. */
  now?: () => number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a quiet stretch is Luke's to answer for.
 *
 * One meter draws both halves of the conversation, so it goes quiet twice for
 * reasons that have nothing to do with Luke: while it lets go of the
 * microphone as a turn is committed, and again in the gap before the first
 * word comes back. Ending a reply on either takes his waveform down seconds
 * after it appeared, while he is still speaking.
 *
 * So silence only counts once the reply is his and something has been heard of
 * it. Nothing here decides when a reply is over — that is the generation being
 * finished as well — only whose silence is being read.
 */
export function quietIsLukesOwn(input: { status: RealtimeStatus; heardLuke: boolean }): boolean {
  return input.status === REALTIME_STATUS.RESPONDING && input.heardLuke;
}

/**
 * Drives one Realtime conversation over WebRTC.
 *
 * The capture device is the developer's, not the call's: it opens when a
 * press takes a turn and closes when the exchange that press started settles,
 * and nothing else — not connecting, not typing, not an announcement — ever
 * touches it. The call negotiates its sending half up front as a bare
 * transceiver, so each turn's fresh track rides the same sender without
 * renegotiating. The press is held as a pending intention while the device
 * opens, exactly as a press that beats the call's handshake is. The close
 * waits for the settle rather than the key coming up because closing a
 * capture device is itself audible on shared hardware — a Bluetooth headset
 * renegotiates its codec — and the key comes up exactly as Luke starts to
 * answer; the track is disabled at that moment, and the device follows in
 * the quiet after the reply. What this buys is that the microphone and its
 * indicator are user-driven — one exchange, opened by one press — and that
 * other audio is never degraded by a device held while nobody is talking.
 */
export class RealtimeVoiceSession {
  readonly #options: RealtimeVoiceSessionOptions;
  #peer: RTCPeerConnection | undefined;
  #channel: RTCDataChannel | undefined;
  #microphone: MediaStreamTrack | undefined;
  #stream: MediaStream | undefined;
  /**
   * The sender the microphone track rides. It outlives the track on purpose:
   * a released device leaves the sender on the call, silent, which is what
   * lets the next press attach a fresh track without renegotiating.
   */
  #microphoneSender: RTCRtpSender | undefined;
  /** The device being reopened, held so two presses cannot open it twice. */
  #acquiring: Promise<void> | undefined;
  /**
   * Whether the current connect attempt — and the call it opens — includes the
   * microphone. A developer's call does; one Luke opens for himself, to read a
   * notice out, must not: no capture device is held, no permission is asked,
   * and the macOS microphone indicator stays honest by never lighting for a
   * call nobody spoke into.
   */
  #withMicrophone = true;
  #status: RealtimeStatus = REALTIME_STATUS.IDLE;
  #connecting: Promise<boolean> | undefined;
  #closed = false;
  /**
   * The roster as last reported, kept whole rather than as its rendered text:
   * it is what a tool call is validated against, and a call may only name a
   * session Luke was actually shown.
   */
  #sessions: readonly NormalizedSession[] = [];
  /**
   * The session under discussion, as the caller last reported it: the one Luke
   * most recently announced or was asked to act on. Only an identity — the
   * words a turn reads are rendered from the roster at flush time, so a
   * renamed session is described as it is now. The caller keeps its own copy
   * and re-reports it after a reconnect, because an announcement is often made
   * on Luke's own speak-only call and the ask that points back at it arrives
   * on the developer's call that replaces it.
   */
  #sessionReference: SessionIdentity | undefined;
  /**
   * The app guide as last provided, kept whole for the same reason the roster
   * is: it is what a spoken ask about Luke himself is validated against, and a
   * call may only name a setting Luke was actually described as having.
   */
  #guide: AppGuideSnapshot = EMPTY_APP_GUIDE;
  /**
   * The projects a workspace can be created in, as last reported — kept whole
   * for the same reason the roster is: a spoken creation ask may only name a
   * project Luke was actually shown.
   */
  #workspaceProjects: readonly ObservedWorkspaceProject[] = [];
  /**
   * The issue roster, held to the same rule — and `undefined` while no
   * tracker is connected, so an issue call then has nothing to be validated
   * against and is refused as such.
   */
  #issues: readonly TrackedIssue[] | undefined;
  /**
   * The context each kind would send if a turn opened now, and the item each
   * kind actually occupies in the conversation.
   *
   * Nothing is sent when it changes. A roster that churns every five seconds
   * while the developer says nothing would otherwise write a fresh copy of
   * itself into the conversation every five seconds, and the model's window is
   * evicted oldest-first — so the developer's own earlier turns are what a pile
   * of superseded rosters costs. Instead the newest answer waits here and goes
   * in at the moment a turn opens, which is both the only moment it is read and
   * the moment it is most nearly true.
   *
   * Teardown clears both, so the next call starts current rather than believing
   * the last call already told it.
   */
  #contextPending = new Map<ContextItemKind, PendingContext>();
  #contextLive = new Map<ContextItemKind, LiveContext>();
  /**
   * Rises for every context item named, so a replacement never claims the name
   * of something a failed delete left behind.
   */
  #contextSequence = 0;
  /**
   * The deletes issued and not yet answered, by the name stamped on each. A
   * delete is answered with an error when the item is already gone — evicted at
   * the window's edge, most likely — and that error is this call's own business
   * rather than a fault to report to the developer.
   */
  #pendingSupersedes = new Map<string, string>();
  /**
   * Luke's own audio track. Cancelling stops the model producing more, but what
   * it already produced is on its way down the connection and keeps playing —
   * so cutting him off means silencing this end too, which is the only half of
   * it entirely under our control.
   */
  #remoteTrack: MediaStreamTrack | undefined;
  /**
   * Whether the model has finished producing the reply. It is not the same as
   * the reply being over: `response.done` says generation is complete, and the
   * audio it produced is still on its way out. A turn that ended here would
   * take the meter and the face down while Luke was still audible, and would
   * let the next press start a turn over the top of him.
   */
  #generationDone = false;
  /**
   * Whether Luke has been quiet since he was last heard. Generation finishing
   * and playback finishing are two events with no fixed order, and only one of
   * them arrives twice: the meter reports an edge, so a quiet that lands before
   * `response.done` is the only quiet there will be. Remembering it is what
   * lets the second of the two end the turn, whichever one that turns out to
   * be.
   */
  #remoteQuiet = false;
  /**
   * Whether the server still owes this turn a `response.done`: raised when a
   * reply is asked for, lowered when the server concludes it — its own
   * `done`, the error that refused it outright, or the cancel an interrupt
   * sends ahead of anything newer. The client's side of the turn can settle
   * first — the audio drains before the `done` arrives — and in that window
   * the conversation still holds an active response: a `response.create`
   * sent into it is refused as a conversation already in progress, with the
   * refusal read out to the developer as a voice error and the reply it was
   * meant to open lost. Nothing may end the turn while this stands.
   */
  #responseOutstanding = false;
  /**
   * Whether the reply's audio ran out while the server still owed its
   * `done`. The ending the drain would have made is remembered here and
   * lands when the `done` arrives, so the turn still closes on the second of
   * the two events whichever order they come in.
   */
  #audioDrained = false;
  /**
   * Whether an armed reply's calls are being answered and the follow-up
   * voicing their outcomes is still owed. The turn holds through the writes
   * — a READY offered mid-write is the edge the announcer rides, and a reply
   * taken there bumps the epoch and abandons the follow-up — so the audio
   * draining then is remembered rather than an ending. Lowered by whatever
   * reply comes next, the finish that ends the hold, or the interrupt of a
   * developer moving on.
   */
  #followUpPending = false;
  /**
   * Whether Luke has actually been heard during this reply. Committing a turn
   * swaps the meter from the microphone to Luke, and the meter reports quiet as
   * it lets go of the old stream — a silence that belongs to the developer, not
   * to Luke, and one that would otherwise end his turn before he had said
   * anything.
   */
  #heardLuke = false;
  /**
   * The pause between two sentences is longer than the meter's idea of quiet.
   * This holds that pause until it has lasted longer than speech leaves behind.
   */
  #quietTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * A press of the talk key that arrived before there was a call to press
   * against. The microphone opens only once the call is up, so such a press is
   * an intention rather than a turn.
   */
  #pendingTurn = false;
  /**
   * The message Luke's current reply is being spoken into, and the moment it
   * first became audible. Together they are what a truncate needs: which
   * message to cut, and how much of it reached the room.
   */
  #responseItemId: string | undefined;
  /**
   * The response now under way, as the server named it when it confirmed the
   * reply had started — or nothing between asking for a reply and that
   * confirmation. It is what tells the current reply's `response.done` from a
   * cancelled one's: the server had finished composing the old reply before
   * the cancel landed, so its `done` still arrives, and it can carry tool
   * calls. Matching the id is what keeps those calls from being answered with
   * the new turn's arming — the turn that superseded them, not the one that
   * asked.
   */
  #activeResponseId: string | undefined;
  #audibleSince: number | undefined;
  /**
   * The words of the reply being spoken, as far as they have arrived. Kept
   * here rather than in the caller so every path that ends a reply — finishing,
   * being talked over, the call dropping — clears the words with it, and a
   * caption can never outlive the speech it captions.
   */
  #caption: string | undefined;
  /**
   * The session the reply under way is announcing, or nothing for a
   * conversation reply. Set only by `speak()` from the identity the attention
   * layer validated, and cleared wherever the caption is — so the pressable
   * face the surface draws for it can never outlive the announcement, and
   * nothing a model said can choose what it points at.
   */
  #captionAbout: SessionIdentity | undefined;
  /**
   * Whether this call has ever reported a reply's audio running out. Once it
   * has, silence stops being evidence of anything: the server says when Luke is
   * finished, and a stretch of quiet is just as likely to be the gap between
   * two sentences. Calls that never report one keep the old guess, because a
   * turn that never ends is worse than one that ends early.
   */
  #audioEndingsReported = false;
  #settleTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Whether the turn now under way is one the developer opened themselves — by
   * speaking, or by typing an ask — and so the one and only kind of turn a tool
   * call may run in. It is set true when a push-to-talk commit or a typed ask
   * opens a response and false for every turn Luke opens himself — a proactive
   * readout, the reply that voices a tool's outcome — so a session summary or a
   * tool output that reads like an instruction can never make Luke act. Nothing
   * that decides on the developer's behalf reaches a write path; this is the
   * runtime half of that, beside the standing instructions and the
   * `tool_choice` withheld on every turn Luke opens himself.
   */
  #toolTurnArmed = false;
  /**
   * A monotonic id for the turn now under way, bumped at every boundary a
   * turn crosses — a new one beginning, or the old one declared over. A tool
   * follow-up captures it before awaiting the write and refuses to open if it
   * has changed — the developer has taken the turn, started another, or the
   * turn ended without it, the settle backstop giving up on a hung write —
   * so Luke never speaks the outcome over a live microphone, over a reply the
   * developer is already hearing, or out of a silence already declared.
   */
  #turnEpoch = 0;
  /**
   * A pace change that arrived mid-reply, waiting for the reply to end. The
   * API applies a speed only between model turns, so one landing while Luke is
   * speaking is held here and sent ahead of whatever the call does next.
   */
  #pendingSpeed: number | undefined;
  /**
   * The timer that puts an idle call away, armed whenever the call settles and
   * cancelled the moment anything is being said on it.
   */
  #idleTimer: unknown;
  /**
   * Whether the developer has taken a turn on this call. It is what makes a
   * dropped connection worth mentioning: a call that carried a conversation
   * takes the conversation with it, and Luke would otherwise answer the next
   * question having quietly forgotten the last one.
   */
  #conversationBegan = false;

  constructor(options: RealtimeVoiceSessionOptions) {
    this.#options = options;
  }

  get status(): RealtimeStatus {
    return this.#status;
  }

  get isConnected(): boolean {
    return this.#channel?.readyState === "open";
  }

  /**
   * Whether the call that is up — or coming up — is one the developer can take
   * a turn on. A call Luke opened to read a notice out has no microphone and
   * answers false, which is how a talk-key press knows it still has a call of
   * its own to open. The developer's call whose device is resting between
   * turns still answers true: the call can take the turn, and the device
   * rejoins it on the press rather than a fresh call replacing it.
   */
  get microphoneCall(): boolean {
    if (this.isConnected) return this.#withMicrophone;
    if (this.isConnecting) return this.#withMicrophone;
    return false;
  }

  /**
   * Opens the call, reusing an in-flight attempt rather than racing a second
   * one. Without the microphone it is a call Luke opens for himself — audio
   * out only, nothing captured, nothing to consent to — and it always stands
   * down for the developer's own: asking for a microphone call while a
   * speak-only one is up replaces it rather than sharing it.
   */
  async connect(options?: { microphone?: boolean }): Promise<boolean> {
    const withMicrophone = options?.microphone !== false;
    // Wait out whatever attempt is already in flight rather than racing it.
    // A loop, because another caller can start a new attempt in the gap.
    while (this.#connecting) await this.#connecting;
    if (this.isConnected) {
      if (!withMicrophone || this.#microphone) return true;
      // The developer's call replaces Luke's own — but the press that asked
      // for it must survive the teardown, or the turn it opens would be lost.
      const pendingTurn = this.#pendingTurn;
      this.#teardown();
      this.#pendingTurn = pendingTurn;
    }
    this.#withMicrophone = withMicrophone;
    this.#connecting = this.#connect()
      .then((opened) => {
        // A press does not outlive the attempt it started. Every way a connect
        // ends without a call passes through here — no credential, a refused
        // call, a timeout — so none of them can leave an intention behind for
        // some later connection to open a turn nobody asked for.
        if (!opened) this.#pendingTurn = false;
        return opened;
      })
      .finally(() => {
        this.#connecting = undefined;
      });
    return this.#connecting;
  }

  async #connect(): Promise<boolean> {
    this.#closed = false;
    this.#setStatus(REALTIME_STATUS.CONNECTING);
    this.#options.onError(undefined);

    // Connecting opens no capture device: the microphone is the developer's,
    // not the call's, and it opens only when a press takes a turn. All the
    // wait before the handshake is the credential being minted.
    let connection: RealtimeConnection | undefined;
    try {
      connection = await this.#options.requestConnection();
    } catch (error) {
      // A stop that lands while the credential is being minted is not a fault
      // to report. Every exit from here has to ask, not just the ones after
      // the handshake starts.
      if (this.#closed) return this.#abandonConnect();
      return this.#fail(`Could not reach the main process: ${errorMessage(error)}`);
    }
    if (this.#closed) return this.#abandonConnect();
    if (!connection) {
      this.#teardown();
      this.#setStatus(REALTIME_STATUS.UNAVAILABLE);
      return false;
    }

    try {
      const peer = this.#options.createPeerConnection?.() ?? new RTCPeerConnection();
      this.#peer = peer;
      if (this.#withMicrophone) {
        // The developer's call declares its sending half as a bare
        // transceiver: the line is negotiated now, and each turn's track
        // joins the kept sender later without renegotiating. No track, no
        // device, no consent asked — until a press asks for a turn.
        const transceiver = peer.addTransceiver("audio", { direction: "sendrecv" });
        this.#microphoneSender = transceiver.sender;
      } else {
        // Luke's own call receives audio and offers none: the transceiver says
        // so up front, so the connection is speak-only by shape rather than by
        // a track that merely happens to be missing.
        peer.addTransceiver("audio", { direction: "recvonly" });
      }
      peer.ontrack = (event) => {
        this.#remoteTrack = event.track;
        this.#options.onRemoteStream(event.streams[0]);
      };
      peer.onconnectionstatechange = () => {
        if (this.#closed) return;
        // `disconnected` is recoverable in WebRTC — ICE routinely passes through
        // it on a brief network blip — so only a terminal state ends the call.
        if (peer.connectionState === "failed" || peer.connectionState === "closed") {
          this.#fail("The voice connection dropped.");
        }
      };

      const channel = peer.createDataChannel(REALTIME_DATA_CHANNEL);
      this.#channel = channel;
      channel.onmessage = (event) => this.#handleServerEvent(event.data);
      channel.onclose = () => {
        if (this.#closed) return;
        // What the call was holding has to be read before the teardown empties
        // it. A call that carried a conversation takes the conversation with
        // it, and the service ends every session at an hour whether or not
        // anyone is finished talking — so this is the ordinary end of a long
        // one, not an exotic failure.
        const lost = this.#conversationBegan;
        // A channel that closes on its own still leaves the capture running,
        // so this has to release the device as thoroughly as an explicit stop.
        this.#teardown();
        this.#setStatus(REALTIME_STATUS.IDLE);
        // Silence here is what made Luke seem to have forgotten on purpose:
        // the next question was answered by someone who had never heard the
        // last one, and nothing said so.
        if (lost) {
          this.#options.onError(
            "The voice call ended, so Luke has lost the thread of this conversation. Press the talk key to start a new one.",
          );
        }
      };

      // One deadline covers the SDP exchange and the channel opening together.
      // Without it a stalled endpoint leaves the panel on "Connecting…" forever,
      // with the only control that could recover it disabled.
      const timeoutMs = positiveInteger(this.#options.connectTimeoutMs, CONNECT_TIMEOUT_MS);
      const deadline = AbortSignal.timeout(timeoutMs);

      await peer.setLocalDescription(await peer.createOffer());
      const answer = await this.#exchangeDescription(
        connection,
        peer.localDescription?.sdp ?? "",
        deadline,
      );
      if (answer === undefined) return false;
      await peer.setRemoteDescription({ type: "answer", sdp: answer });

      await this.#waitForChannel(channel, deadline);
      if (this.#closed) return this.#abandonConnect();
      this.#setStatus(REALTIME_STATUS.READY);
      // A pace changed during the handshake could not be sent then, and the
      // credential this call answered may have been minted before the change.
      this.#flushPendingSpeed();
      // Whoever pressed the talk key to get here has been waiting through the
      // handshake for their turn to open, and the device opens now, for that
      // press. A speak-only call leaves the press pending instead — it has no
      // sending half to open a turn with, and the developer's own call is
      // already replacing it.
      if (this.#pendingTurn && this.#withMicrophone) this.#acquireMicrophone();
      return true;
    } catch (error) {
      if (this.#closed) return this.#abandonConnect();
      return this.#fail(errorMessage(error));
    }
  }

  /**
   * Releases everything a cancelled connect had already acquired, leaving the
   * session idle as the caller that stopped it intended.
   */
  #abandonConnect(): boolean {
    this.#teardown();
    this.#setStatus(REALTIME_STATUS.IDLE);
    return false;
  }

  /**
   * How the device is asked for — only ever on behalf of a press. The caller
   * usually injects the route-aware opener; the fallback opens the browser's
   * default with the same processing (`MICROPHONE_PROCESSING` says why echo
   * cancellation is off), so a bare session still captures correctly.
   */
  #requestStream(): Promise<MediaStream> {
    return (
      this.#options.requestMicrophoneStream?.() ??
      navigator.mediaDevices.getUserMedia({ audio: { ...MICROPHONE_PROCESSING }, video: false })
    );
  }

  async #exchangeDescription(
    connection: RealtimeConnection,
    offer: string,
    deadline: AbortSignal,
  ): Promise<string | undefined> {
    const init: RequestInit = {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.value}`,
        "content-type": SDP_CONTENT_TYPE,
      },
      body: offer,
      signal: deadline,
    };
    // The kind of call and nothing else: the ephemeral secret and the SDP
    // stay out of the log.
    console.log(
      `AI call: opening realtime voice call (${this.#withMicrophone ? "conversation" : "speak-only"})`,
    );
    const response = await (this.#options.exchangeDescription?.(connection.callsUrl, init) ??
      fetch(connection.callsUrl, init));
    if (!response.ok) {
      // The status is the diagnosable part; the ephemeral secret never is.
      this.#fail(`The voice service refused the call (status ${response.status}).`);
      return undefined;
    }
    return response.text();
  }

  #waitForChannel(channel: RTCDataChannel, deadline: AbortSignal): Promise<void> {
    if (channel.readyState === "open") return Promise.resolve();
    // The deadline is shared with the SDP exchange and can already have fired
    // by the time this waiter is armed, in which case no future `abort` event
    // is coming and listening alone would wait forever.
    if (deadline.aborted) {
      return Promise.reject(new Error("The voice connection timed out while opening."));
    }
    return new Promise((resolve, reject) => {
      const settle = (outcome: () => void) => {
        deadline.removeEventListener("abort", onDeadline);
        outcome();
      };
      const onDeadline = () =>
        settle(() => reject(new Error("The voice connection timed out while opening.")));
      deadline.addEventListener("abort", onDeadline, { once: true });
      channel.onopen = () => settle(resolve);
      channel.onerror = () =>
        settle(() => reject(new Error("The voice data channel failed to open")));
    });
  }

  /**
   * The talk key going down. Opening a turn and ending one are separate here
   * rather than one toggle, because a key that reports being let go of can say
   * which of the two it meant — and a turn that lasts exactly as long as the
   * key is held cannot be left open by forgetting to press again.
   */
  beginTurn(): void {
    // Every press opens the device: it lives exactly as long as the turn it
    // was pressed for. Until the device is live — and, on a first press, the
    // call it rides — the press waits as an intention and the turn opens the
    // moment both exist.
    if (!this.isConnected || !this.#microphone) {
      // The developer's turn wins at the press, not at the device: a reply
      // under way is cut off now, exactly as the stop key cuts one, and the
      // turn itself opens when the device arrives.
      this.stopSpeaking();
      this.#pendingTurn = true;
      this.#acquireMicrophone();
      return;
    }
    this.startListening();
  }

  /**
   * The talk key coming up on a held turn, or a second press ending a latched
   * one. A turn that never opened is dropped rather than committed: the
   * microphone opens with the press, and one that was let go of before the
   * device arrived captured nothing to send.
   */
  endTurn(commit: boolean): void {
    if (!this.isConnected) {
      this.#pendingTurn = false;
      return;
    }
    // A press let go of while its device was still opening held nothing to
    // send: the turn it was owed is dropped rather than opened under a key
    // that is already up. A press against Luke's speak-only call is a
    // different wait — for the developer's call — and keeps its meaning.
    if (!this.#microphone && this.#withMicrophone) {
      this.#pendingTurn = false;
      return;
    }
    this.stopListening(commit);
  }

  toggleTurn(): void {
    // Until the device this press opens is live — and, before the call is up,
    // the call too — there is no turn to take yet: the press is remembered
    // and applied the moment there is. A second press cancels the first
    // rather than queueing another, because two presses have always meant a
    // turn opened and closed, and one that held nothing is one with nothing
    // to send. A connected speak-only call is the waiting case too: Luke's
    // own call cannot take a turn, so the press waits for the one that can.
    if (!this.isConnected || !this.#microphone) {
      this.#pendingTurn = !this.#pendingTurn;
      if (this.#pendingTurn) {
        // The same early cut a held press makes: the reply stops at the
        // press, and the turn opens when the device arrives.
        this.stopSpeaking();
        this.#acquireMicrophone();
      }
      return;
    }
    if (this.#status === REALTIME_STATUS.LISTENING) {
      this.stopListening(true);
      return;
    }
    this.startListening();
  }

  /** Whether a call is being opened, so a press has something to wait for. */
  get isConnecting(): boolean {
    return this.#connecting !== undefined;
  }

  /**
   * Whether a press is still waiting for a call that can take its turn. The
   * opening meter reads this: a takeover — the developer's call replacing
   * Luke's own — passes through a settled status on the way, and the meter
   * must not come down while the press that started it is still owed a turn.
   */
  get turnPending(): boolean {
    return this.#pendingTurn;
  }

  /**
   * Forgets a press that was waiting for a call that is not coming — a refused
   * microphone, say. Without this the intention would outlive the attempt and
   * open a turn out of the next connection, which nobody asked for.
   */
  dropPendingTurn(): void {
    this.#pendingTurn = false;
    // A device already opened for that press has no turn left to serve, and
    // nobody is talking into it: it closes now, not on any clock.
    if (this.#status !== REALTIME_STATUS.LISTENING) this.#releaseMicrophone();
  }

  /**
   * Opens the capture device for the press waiting on it. One request at a
   * time: a second press mid-open joins the first rather than racing it.
   */
  #acquireMicrophone(): void {
    if (!this.isConnected || !this.#withMicrophone || this.#microphone) return;
    if (this.#acquiring) return;
    this.#acquiring = this.#openMicrophone().finally(() => {
      this.#acquiring = undefined;
      // A press that arrived while a stale open was still in flight was told
      // to wait by the guard above; with the flight over, it is served now.
      if (this.#pendingTurn && !this.#microphone) this.#acquireMicrophone();
    });
  }

  async #openMicrophone(): Promise<void> {
    // The sender names the call this open belongs to, captured before the
    // wait: a call closed and replaced while the device was opening keeps its
    // own fresh sender, which is how this open knows it has gone stale.
    const sender = this.#microphoneSender;
    let stream: MediaStream;
    try {
      stream = await this.#requestStream();
    } catch (error) {
      // A refusal belongs to the call whose press asked for the device. If
      // that call is gone — closed, or replaced mid-open — the refusal died
      // with it, and the call now up must not be torn down for it. For the
      // call still standing, it is failed rather than left looking able to
      // listen, and `FAILED` offers "Start voice" again.
      if (!this.#closed && this.isConnected && sender === this.#microphoneSender) {
        this.#fail(errorMessage(error));
      }
      return;
    }
    // The call may have gone away — or been replaced, bringing a fresh
    // sender — while this one was opening. A device nobody adopts is
    // released here, or it would hold the indicator lit with nothing left to
    // close it.
    if (
      this.#closed ||
      !this.isConnected ||
      !sender ||
      sender !== this.#microphoneSender ||
      this.#microphone
    ) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const [microphone] = stream.getAudioTracks();
    if (!microphone) {
      for (const track of stream.getTracks()) track.stop();
      this.#fail("No microphone track was available");
      return;
    }
    // Closed until the turn opens it, so nothing is sent before the state
    // machine says the turn is on.
    microphone.enabled = false;
    this.#stream = stream;
    this.#microphone = microphone;
    this.#options.onLocalStream(stream);
    try {
      // Onto the sender the call has kept since its handshake: no
      // renegotiation, the same line, the same call.
      await sender.replaceTrack(microphone);
    } catch (error) {
      // Guarded like the open's own refusal: a sender that rejected because
      // its call was torn down mid-replace is not the live call's fault.
      if (!this.#closed && this.isConnected && sender === this.#microphoneSender) {
        this.#fail(errorMessage(error));
      }
      return;
    }
    if (this.#closed || !this.isConnected) return;
    if (this.#pendingTurn) {
      this.#pendingTurn = false;
      this.startListening();
      return;
    }
    // Opened for a press that has since been let go: nobody is talking, so
    // the device closes as fast as it arrived.
    this.#releaseMicrophone();
  }

  /**
   * Puts the capture device away without touching the call: the tracks stop,
   * the sender stays to take the next track, and the meter lets go of a
   * stream that no longer exists. From here the microphone indicator is dark
   * and Bluetooth audio is back on its music codec.
   */
  #releaseMicrophone(): void {
    if (!this.#stream && !this.#microphone) return;
    const stream = this.#stream;
    this.#stream = undefined;
    this.#microphone = undefined;
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    void this.#microphoneSender?.replaceTrack(null);
    this.#options.onLocalStream(undefined);
  }

  /**
   * Whether a turn is already under way in either direction.
   *
   * The Realtime API answers one turn at a time, so this is the whole of the
   * arbitration: while a turn is open, nothing else starts one. Callers are
   * told they were refused and decide what to show instead.
   */
  get #turnBusy(): boolean {
    return (
      this.#status === REALTIME_STATUS.LISTENING || this.#status === REALTIME_STATUS.RESPONDING
    );
  }

  /**
   * Opens the microphone for as long as push-to-talk is held, reporting
   * whether it actually did. The caller uses that to decide whether to claim
   * the key it was pressed with — Space still scrolls the panel when there is
   * no turn to open.
   */
  startListening(): boolean {
    if (!this.#microphone || !this.isConnected) return false;
    if (this.#status === REALTIME_STATUS.LISTENING) return false;
    // Talking over Luke stops it. The developer's turn always wins, which is
    // the whole point of a key that means "it is my turn now".
    if (this.#status === REALTIME_STATUS.RESPONDING) this.#interruptReply();
    // Start from an empty buffer: a muted track still transmits, and with turn
    // detection off the server keeps everything since the last commit.
    this.#send(clearInputAudioEvents());
    this.#microphone.enabled = true;
    // The developer taking the turn is a new turn, whatever a tool follow-up
    // still in flight from the last one thinks: it will find this epoch and
    // stand down rather than talk over the microphone now opening.
    this.#turnEpoch += 1;
    this.#setStatus(REALTIME_STATUS.LISTENING);
    return true;
  }

  /**
   * Closes the microphone and either asks for a reply or discards the turn.
   * Discarding matters: a press the developer changes their mind about must not
   * leave buffered audio behind for the next turn to inherit.
   */
  stopListening(commit: boolean): void {
    if (!this.#microphone || this.#status !== REALTIME_STATUS.LISTENING) return;
    this.#microphone.enabled = false;
    if (!commit) {
      this.#send(clearInputAudioEvents());
      // Settling to READY is what releases the device: nothing is coming
      // that its closing could talk over.
      this.#setStatus(REALTIME_STATUS.READY);
      return;
    }
    // A turn a tool may run in: the developer opened it and spoke into it, so
    // a tool call it emits is the developer's own ask. The device is NOT
    // released here, deliberately: closing a capture device is itself audible
    // on shared hardware — a Bluetooth headset renegotiates its codec and
    // playback drops out for a beat — and this is the very moment Luke starts
    // to answer. The track is disabled, so nothing is sent; the device itself
    // is let go when the exchange settles, in the quiet after the reply.
    this.#startResponse(pushToTalkCommitEvents(), true);
  }

  /**
   * Sends a typed ask and requests the reply to it, reporting whether it
   * could. Typing is the developer opening a turn, exactly as holding the talk
   * key is, so the turn is armed for tools on the same terms as a push-to-talk
   * commit: a write out of it is the developer's own request, made in their
   * own words.
   *
   * An ask arriving over a reply interrupts it — the developer's turn always
   * wins, however it is taken. The one thing it will not interrupt is the
   * developer's own open microphone: half a spoken question is still theirs,
   * and a keystroke is no reason to discard it.
   */
  sendText(text: string): boolean {
    // A typed ask runs only on the developer's own call. Luke's speak-only
    // call has been sent no roster, no guide, and no issues, so a turn armed
    // for tools has nothing real to validate against there — the caller
    // stands that call down and opens the full one before asking. A typed ask
    // needs no capture device, so one this call put away stays put away.
    if (!this.isConnected || !this.#withMicrophone) return false;
    if (this.#status === REALTIME_STATUS.LISTENING) return false;
    const events = typedAskEvents(text);
    if (events.length === 0) return false;
    if (this.#status === REALTIME_STATUS.RESPONDING) this.#interruptReply();
    this.#startResponse(events, true);
    return true;
  }

  /**
   * Cuts off the reply under way so the developer's new turn does not land on
   * top of it.
   */
  #interruptReply(): void {
    // Stop the words that are already on their way, then stop more being
    // made. A disabled track drops what is buffered rather than playing it
    // out, so the cut-off is immediate rather than eventual.
    this.#silenceLuke();
    // The caption is cut with the audio. It already held words the room
    // never heard — the text runs ahead of the speech — and leaving them up
    // would show Luke finishing a sentence he was just stopped from saying.
    this.#setCaption(undefined);
    this.#send(cancelResponseEvents());
    // Then correct what Luke believes he said, or the next answer is free to
    // refer back to a sentence that never reached the room.
    this.#send(this.#truncateEvents());
    // The trim was this reply's last word: forgetting its item here is what
    // stops the transcript still trailing in — the server had produced it
    // before the cancel landed — from ever matching the caption again.
    this.#responseItemId = undefined;
    // And forgetting its response is what stops its finished form — cancelled
    // or not, the server may already have completed it — from being read as
    // the current turn's: a `response.done` that matches nothing can neither
    // act with the new turn's arming nor end the new turn early.
    this.#activeResponseId = undefined;
    // The turn the arming belonged to is over with the reply. Every caller
    // that opens a new developer turn arms it afresh in #startResponse; left
    // true here, the cancelled reply's late calls would find it still standing.
    this.#toolTurnArmed = false;
    // The cancel concludes the reply at the server before anything sent after
    // it is read — the channel is ordered — so nothing is outstanding from
    // here, and whatever `done` the cancelled reply still sends matches no
    // active response above.
    this.#responseOutstanding = false;
    this.#audioDrained = false;
    this.#followUpPending = false;
    this.#generationDone = false;
    this.#remoteQuiet = false;
    this.#heardLuke = false;
    this.#clearQuietTimer();
    this.#clearSettleTimer();
  }

  /**
   * Cuts off the reply under way without opening anything in its place — the
   * developer asking for quiet rather than for a turn. The cut is the same
   * one talking or typing over Luke makes: silenced at once, cancelled, and
   * trimmed to what was actually heard, so the next answer cannot refer back
   * to words that never reached the room. Reports whether there was a reply
   * to stop, so the key that asked keeps its other meanings when there was
   * not.
   */
  stopSpeaking(): boolean {
    if (this.#status !== REALTIME_STATUS.RESPONDING) return false;
    this.#interruptReply();
    // A stop opens no reply of its own, so the turn moves on here: a tool
    // follow-up still awaiting its write finds an epoch that is no longer its
    // own and stands down, rather than speaking over the quiet just asked for.
    this.#turnEpoch += 1;
    this.#setStatus(REALTIME_STATUS.READY);
    return true;
  }

  /**
   * Voices a proactive update that the attention layer already approved,
   * reporting whether it could. A refusal is not a loss: the caller shows the
   * sentence instead, which is the same thing it does when voice is off. That
   * is better than holding it — the attention layer supersedes its own
   * decisions, so a sentence saved for later is a sentence likely to be stale.
   */
  speak(speech: AttentionSpeech): boolean {
    const events = proactiveSpeechEvents(speech);
    if (events.length === 0 || !this.isConnected || this.#turnBusy) return false;
    this.#startResponse(events);
    // After the start, which clears the last reply's caption and subject: the
    // announcement's reply is the one now under way, and everything it
    // captions is about this session until the reply ends.
    this.#captionAbout = {
      providerId: speech.providerId,
      providerSessionId: speech.providerSessionId,
    };
    this.#options.onCaption(this.#caption, this.#captionAbout);
    return true;
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#teardown();
    this.#setStatus(REALTIME_STATUS.IDLE);
  }

  /**
   * Releases the microphone and the peer connection without deciding what the
   * session's status becomes. Every path that stops the call goes through here,
   * so a failure can never leave the macOS microphone indicator lit with no way
   * to turn it off.
   */
  #teardown(): void {
    const channel = this.#channel;
    if (channel) {
      // Detach before closing. `close()` fires `onclose` asynchronously, and
      // letting that handler run would tear down a second time and force the
      // status to idle — overwriting the `failed` the caller is about to set,
      // so a refused call would surface as "Voice off".
      channel.onclose = null;
      channel.onmessage = null;
      channel.close();
    }
    this.#channel = undefined;
    const peer = this.#peer;
    if (peer) {
      // Detach for the same reason the channel does. `close()` drives the
      // connection to `closed`, and this handler treats that as fatal.
      peer.onconnectionstatechange = null;
      peer.ontrack = null;
      peer.close();
    }
    this.#peer = undefined;
    this.#remoteTrack = undefined;
    this.#microphone = undefined;
    this.#microphoneSender = undefined;
    this.#stream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.#stream = undefined;
    this.#sessions = [];
    this.#sessionReference = undefined;
    this.#guide = EMPTY_APP_GUIDE;
    this.#workspaceProjects = [];
    this.#issues = undefined;
    // What was said on the call goes with the call. The pending answers go too:
    // they were built from stores this teardown is emptying, and the next call
    // is filled from the app afresh before it takes a turn.
    this.#contextPending.clear();
    this.#contextLive.clear();
    this.#pendingSupersedes.clear();
    this.#conversationBegan = false;
    this.#clearIdleTimer();
    this.#responseOutstanding = false;
    this.#audioDrained = false;
    this.#followUpPending = false;
    this.#generationDone = false;
    this.#remoteQuiet = false;
    this.#heardLuke = false;
    this.#clearQuietTimer();
    this.#pendingTurn = false;
    // The next call is minted at the stored pace, so nothing is owed to it.
    this.#pendingSpeed = undefined;
    this.#responseItemId = undefined;
    this.#activeResponseId = undefined;
    this.#audibleSince = undefined;
    this.#setCaption(undefined);
    // Learned about this call, so it does not outlive it.
    this.#audioEndingsReported = false;
    this.#clearSettleTimer();
    this.#options.onLocalStream(undefined);
    this.#options.onRemoteStream(undefined);
  }

  #startResponse(events: readonly Record<string, unknown>[], toolsArmed = false): void {
    // A pace still waiting from the last reply lands here, ahead of the
    // request: the channel is ordered and no response is in progress — a
    // cancel for the reply being talked over was sent before this — so the
    // reply about to be asked for is already spoken at the new pace.
    this.#flushPendingSpeed();
    // The turn the developer just opened is the one that reads the context, so
    // it is the moment the context goes in — ahead of the events asking for the
    // reply, on a channel that keeps them in that order. The turns Luke opens
    // himself get none: a readout has a sentence to say and nothing to look up,
    // and a tool follow-up is answering from what this same flush already sent.
    if (toolsArmed) {
      this.#conversationBegan = true;
      this.#flushContext();
    }
    // The track is deliberately left as it is. A reply that was cut off left it
    // disabled, and re-opening it here would let the tail of that reply — still
    // arriving, because the server sent it before it was told to stop — be
    // heard as the answer to what was just said. It is opened again when the
    // server confirms the new reply has started, by which point the old one is
    // certainly over: the data channel is ordered, so the clear that ended it
    // was handled before the request for this one.
    this.#generationDone = false;
    this.#remoteQuiet = false;
    this.#heardLuke = false;
    // The reply now being asked for is the server's until it concludes it:
    // nothing else may ask for one over it — and whatever follow-up was being
    // waited on, this is the reply that answers or supersedes the wait.
    this.#responseOutstanding = true;
    this.#audioDrained = false;
    this.#followUpPending = false;
    this.#clearQuietTimer();
    this.#responseItemId = undefined;
    // Nothing has been confirmed for this turn yet: whatever `response.done`
    // arrives before the server confirms this reply belongs to a superseded
    // one, and must find no active response to match.
    this.#activeResponseId = undefined;
    this.#audibleSince = undefined;
    // A new turn: only a developer-opened one may run a tool, and any tool
    // follow-up still awaiting from the last turn will see this and stand down.
    this.#toolTurnArmed = toolsArmed;
    this.#turnEpoch += 1;
    this.#setCaption(undefined);
    this.#clearSettleTimer();
    // Every reply request passes through here, so this one line logs each
    // voice-model turn. The turn's kind and nothing else: what was said stays
    // out of the log.
    console.log(
      `AI call: realtime voice reply requested (${toolsArmed ? "developer turn" : "Luke's own turn"})`,
    );
    this.#send(events);
    this.#setStatus(REALTIME_STATUS.RESPONDING);
  }

  /**
   * The meter's report of whether Luke is audible. The meter calls quiet after
   * a fifth of a second, which is shorter than the pause between two sentences,
   * so a turn that ended on that edge would take the meter down mid-reply. The
   * session waits for a silence longer than speech leaves behind, and ignores
   * quiet that is not Luke's to answer for.
   */
  reportRemoteAudioLevel(active: boolean): void {
    this.#clearQuietTimer();
    if (this.#status !== REALTIME_STATUS.RESPONDING) return;
    if (active) {
      this.#heardLuke = true;
      this.reportRemoteAudioActive();
      return;
    }
    this.#quietTimer = setTimeout(() => {
      this.#quietTimer = undefined;
      // Only Luke's own silence ends Luke's turn.
      if (!quietIsLukesOwn({ status: this.#status, heardLuke: this.#heardLuke })) return;
      this.reportRemoteAudioIdle();
    }, REMOTE_QUIET_MS);
  }

  /**
   * Reports that Luke's audio has gone quiet, after the caller has already
   * decided the silence is his and has lasted long enough to be an ending.
   */
  reportRemoteAudioIdle(): void {
    // Remembered rather than acted on and forgotten: if generation has not
    // finished yet, this is still the only quiet edge the meter will report,
    // and `response.done` is what will read it.
    this.#remoteQuiet = true;
    // Nothing to infer on a call that reports its own endings. Inferring here
    // is what ended a reply in the pause between its two sentences.
    if (this.#audioEndingsReported) return;
    if (!this.#generationDone) return;
    this.#finishResponse();
  }

  /**
   * Reports that Luke is audible again. A pause between two sentences is longer
   * than the meter's idea of quiet, so without this a reply that pauses and
   * resumes would end on the pause the moment generation finished — with Luke
   * still speaking.
   */
  reportRemoteAudioActive(): void {
    this.#remoteQuiet = false;
    // The first time this reply is heard is the clock a truncate measures
    // against. Later edges are pauses within it, not new beginnings.
    this.#audibleSince ??= this.#now();
  }

  /**
   * What to trim the cut-off reply to, if there is anything to trim. Nothing
   * heard means nothing to correct — a reply interrupted in the gap before its
   * first word left no impression to undo.
   */
  #truncateEvents(): readonly Record<string, unknown>[] {
    const itemId = this.#responseItemId;
    const audibleSince = this.#audibleSince;
    if (!itemId || audibleSince === undefined) return [];
    return truncateResponseEvents({ itemId, audioEndMs: this.#now() - audibleSince });
  }

  #now(): number {
    return this.#options.now?.() ?? performance.now();
  }

  #silenceLuke(): void {
    if (this.#remoteTrack) this.#remoteTrack.enabled = false;
  }

  #unsilenceLuke(): void {
    if (this.#remoteTrack) this.#remoteTrack.enabled = true;
  }

  /** Starts the backstop for a reply whose proper ending never arrives. */
  #armSettleTimer(): void {
    this.#settleTimer ??= setTimeout(() => {
      this.#settleTimer = undefined;
      this.#finishResponse();
    }, REALTIME_SETTLE_TIMEOUT_MS);
  }

  #clearSettleTimer(): void {
    if (this.#settleTimer === undefined) return;
    clearTimeout(this.#settleTimer);
    this.#settleTimer = undefined;
  }

  #clearQuietTimer(): void {
    if (this.#quietTimer === undefined) return;
    clearTimeout(this.#quietTimer);
    this.#quietTimer = undefined;
  }

  #setCaption(text: string | undefined): void {
    // The subject is of the reply, so the reply ending takes it too: every
    // path that ends one clears the caption through here.
    const about = text === undefined ? undefined : this.#captionAbout;
    if (this.#caption === text && this.#captionAbout === about) return;
    this.#caption = text;
    this.#captionAbout = about;
    this.#options.onCaption(text, about);
  }

  /** Ends the turn once the reply is done, so the next one can start. */
  #finishResponse(): void {
    this.#generationDone = false;
    // However the turn ended — the settle backstop included — whatever the
    // server still owed it is treated as concluded, so a `done` that never
    // comes cannot leave every later reply refused against it.
    this.#responseOutstanding = false;
    this.#audioDrained = false;
    this.#followUpPending = false;
    // The turn is over, and everything of it is spent — a write still in
    // flight from it finds this boundary and stands down, rather than opening
    // its follow-up out of a silence already declared.
    this.#turnEpoch += 1;
    // No reply is current once the turn is over, and the arming went with the
    // turn: a `done` that outlives the settle backstop reads as a stranger's,
    // its calls answered refused rather than run as writes out of a turn the
    // developer was already told had ended.
    this.#activeResponseId = undefined;
    this.#toolTurnArmed = false;
    // The caption is of speech, and the speech is over. Whatever ended the
    // reply — the audio draining, an error, the settle timer — the words leave
    // with the meter and the face rather than lingering under a quiet capsule.
    this.#setCaption(undefined);
    // Whatever ended the reply — an error, the settle timer, Luke simply
    // stopping — the next one has to be audible. Without this a reply that
    // failed before it started would leave Luke silenced with nothing to
    // un-silence him.
    this.#unsilenceLuke();
    this.#clearQuietTimer();
    this.#clearSettleTimer();
    this.#heardLuke = false;
    // The reply is over, so the API is between turns — the one moment it
    // accepts a pace change that arrived while Luke was speaking.
    this.#flushPendingSpeed();
    if (this.#status === REALTIME_STATUS.RESPONDING) this.#setStatus(REALTIME_STATUS.READY);
  }

  /**
   * Changes how fast Luke speaks on the call now open, from his next reply on.
   * A call minted at one pace stays a live session, so the change travels as a
   * session update rather than waiting for the next conversation. The API
   * applies a pace only between model turns: a change landing mid-reply is
   * held and sent when the reply ends. With no call open there is nothing to
   * update — the next one is minted at the stored pace already.
   */
  applySpeed(speed: number): void {
    if (!this.isConnected) {
      // A call being opened was minted at whatever pace stood when its
      // credential was asked for, which this change may already have
      // overtaken: hold it and send it once the channel opens. Sent to a
      // call that was minted at the new pace after all, it is a no-op.
      if (this.isConnecting) this.#pendingSpeed = speed;
      return;
    }
    if (this.#status === REALTIME_STATUS.RESPONDING) {
      this.#pendingSpeed = speed;
      return;
    }
    this.#pendingSpeed = undefined;
    this.#send(outputSpeedUpdateEvents(speed));
  }

  /** Sends the pace change that waited out a reply, once nothing is speaking. */
  #flushPendingSpeed(): void {
    const speed = this.#pendingSpeed;
    if (speed === undefined) return;
    this.#pendingSpeed = undefined;
    this.#send(outputSpeedUpdateEvents(speed));
  }

  /**
   * Tells the conversation what Luke can currently see.
   *
   * The standing instructions describe session state as something Luke knows,
   * so without this the prompt would assert a capability the connection never
   * provides and a question about live work could not be answered from real
   * data. Identical rosters are not resent.
   */
  updateSessions(
    sessions: readonly NormalizedSession[],
    noticeAsks: readonly SessionNoticeAsk[] = [],
  ): void {
    this.#sessions = sessions;
    this.#rememberContext(
      CONTEXT_ITEM_KIND.SESSIONS,
      sessionContextText(sessions, noticeAsks),
      (itemId) => sessionContextEvents(sessions, itemId, noticeAsks),
    );
    // The reference is rendered from the roster, so a fresh roster re-renders
    // it: a renamed session keeps its line true, and one that left the roster
    // withdraws it.
    this.#rememberSessionReference();
  }

  /**
   * Tells the conversation which session is under discussion — the one Luke
   * most recently announced to the developer or acted on at their ask. It is
   * what lets a bare "that chat" resolve to an identity a tool call can name:
   * the mention it points back at carried only a title, and may have been
   * spoken on Luke's own call, which the developer's own replaced. Context on
   * the roster's own terms, flushed with it at the turn that reads it.
   */
  updateSessionReference(reference: SessionIdentity | undefined): void {
    this.#sessionReference = reference;
    this.#rememberSessionReference();
  }

  /**
   * Renders the reference against the roster as both now stand. A reference
   * whose session is not observed points at nothing a call could name: a
   * conversation never told of one is told nothing, and one holding a line is
   * told the line no longer stands — the issues roster's own withdrawal rule.
   */
  #rememberSessionReference(): void {
    const reference = this.#sessionReference;
    const session = reference
      ? this.#sessions.find(
          (candidate) =>
            candidate.providerId === reference.providerId &&
            candidate.providerSessionId === reference.providerSessionId,
        )
      : undefined;
    if (session) {
      this.#rememberContext(
        CONTEXT_ITEM_KIND.SESSION_REFERENCE,
        sessionReferenceContextText(session),
        (itemId) => sessionReferenceContextEvents(session, itemId),
      );
      return;
    }
    if (!this.#contextPending.has(CONTEXT_ITEM_KIND.SESSION_REFERENCE)) return;
    if (!this.#contextLive.has(CONTEXT_ITEM_KIND.SESSION_REFERENCE)) {
      this.#contextPending.delete(CONTEXT_ITEM_KIND.SESSION_REFERENCE);
      return;
    }
    this.#rememberContext(
      CONTEXT_ITEM_KIND.SESSION_REFERENCE,
      SESSION_REFERENCE_WITHDRAWN_TEXT,
      (itemId) => sessionReferenceWithdrawnEvents(itemId),
    );
  }

  /**
   * Tells the conversation what the most recent announcement said. The words
   * were often said on Luke's own speak-only call — the very call the
   * talk-key press tears down on its way here — so without this the
   * developer's call is asked "what did you just say?" by someone it never
   * said anything to. Context on the roster's own
   * terms: remembered here, flushed only at a developer-opened turn, and
   * carrying the same bounded payload the announcement already traveled as —
   * the words alone, never an identity, which [session under discussion]
   * carries beside it.
   */
  updateLastAnnouncement(speech: AttentionSpeech): void {
    const text = lastAnnouncementContextText(speech);
    if (text === undefined) return;
    this.#rememberContext(CONTEXT_ITEM_KIND.LAST_ANNOUNCEMENT, text, (itemId) =>
      lastAnnouncementContextEvents(speech, itemId),
    );
  }

  /**
   * Tells the conversation where a workspace can be created, the same way the
   * roster travels: context that must never open Luke's mouth, kept whole
   * because it is what a spoken creation ask is validated against. The default
   * provider and the per-provider default projects ride along because they
   * are part of the same answer — where a nameless ask goes — and a changed
   * default is news the way a changed list is. Identical lists under
   * identical defaults are not resent.
   */
  updateWorkspaceProjects(
    projects: readonly ObservedWorkspaceProject[],
    defaultProviderId?: string,
    defaultProjectIds?: Readonly<Partial<Record<string, string>>>,
  ): void {
    this.#workspaceProjects = projects;
    this.#rememberContext(
      CONTEXT_ITEM_KIND.WORKSPACE_PROJECTS,
      workspaceProjectContextText(projects, defaultProviderId, defaultProjectIds),
      (itemId) =>
        workspaceProjectContextEvents(projects, itemId, defaultProviderId, defaultProjectIds),
    );
  }

  /**
   * Tells the conversation what Luke currently knows about himself, the same
   * way the roster does: the standing instructions promise an app guide, so
   * one has to arrive before a question about Luke can be answered from real
   * state. Identical guides are not resent, and the snapshot is kept whole for
   * validating the spoken asks it advertises.
   */
  updateGuide(guide: AppGuideSnapshot): void {
    this.#guide = guide;
    this.#rememberContext(CONTEXT_ITEM_KIND.APP_GUIDE, appGuideContextText(guide), (itemId) =>
      appGuideContextEvents(guide, itemId),
    );
  }

  /**
   * Tells the conversation what the issue tracker lists, under the same rule
   * the session roster follows: identical rosters are not resent, and no
   * tracker connected means no roster at all — the absence is itself what
   * lets Luke say a tracker is not connected rather than inventing a board.
   */
  updateIssues(issues: readonly TrackedIssue[] | undefined): void {
    this.#issues = issues;
    if (issues) {
      this.#rememberContext(CONTEXT_ITEM_KIND.ISSUES, issueContextText(issues), (itemId) =>
        issueContextEvents(issues, itemId),
      );
      return;
    }
    // A conversation that was never going to be told about a board has nothing
    // to withdraw, and saying a tracker is "no longer" connected when none ever
    // was is a different and wrong sentence. One that had a board — or was
    // about to be given one — is told the board is gone, or Luke keeps
    // answering from a tracker nobody is observing.
    if (!this.#contextPending.has(CONTEXT_ITEM_KIND.ISSUES)) return;
    if (!this.#contextLive.has(CONTEXT_ITEM_KIND.ISSUES)) {
      this.#contextPending.delete(CONTEXT_ITEM_KIND.ISSUES);
      return;
    }
    this.#rememberContext(CONTEXT_ITEM_KIND.ISSUES, ISSUE_TRACKER_DISCONNECTED_TEXT, (itemId) =>
      issueTrackerDisconnectedEvents(itemId),
    );
  }

  /**
   * Holds one kind of context until a turn asks for it. Nothing is sent here:
   * what a turn needs is the newest answer, not every answer on the way to it.
   */
  #rememberContext(
    kind: ContextItemKind,
    text: string,
    build: (itemId: string) => readonly Record<string, unknown>[],
  ): void {
    this.#contextPending.set(kind, { text, build });
  }

  /**
   * Puts the context a turn is about to be answered from into the conversation,
   * each kind replacing whatever it said before.
   *
   * Two things happen per changed kind, in this order: the item holding the old
   * answer is deleted, and the new one is created under a fresh name. Ordered
   * that way because the channel is ordered — the conversation is never briefly
   * holding two rosters, and never briefly holding none.
   *
   * An answer that has not changed since it was last said is left alone
   * entirely, which is what keeps a quiet stretch of the conversation cached.
   */
  #flushContext(): void {
    if (!this.#carriesContext()) return;
    for (const kind of CONTEXT_FLUSH_ORDER) {
      const pending = this.#contextPending.get(kind);
      if (!pending) continue;
      const live = this.#contextLive.get(kind);
      if (live?.text === pending.text) continue;
      this.#contextSequence += 1;
      const itemId = contextItemId(kind, this.#contextSequence);
      if (live) this.#supersede(live.itemId);
      this.#send(pending.build(itemId));
      this.#contextLive.set(kind, { itemId, text: pending.text });
    }
  }

  /** Removes the item a fresher answer is replacing, and remembers asking. */
  #supersede(itemId: string): void {
    const eventId = contextSupersedeEventId(this.#contextSequence);
    // A delete is answered within the round trip or not at all, so anything
    // still waiting after this many is an answer that was never coming — and a
    // record kept for the length of a call is one that grows for the length of
    // a call. The oldest goes; insertion order is what makes it the oldest.
    while (this.#pendingSupersedes.size >= MAXIMUM_PENDING_SUPERSEDES) {
      const [oldest] = this.#pendingSupersedes.keys();
      if (oldest === undefined) break;
      this.#pendingSupersedes.delete(oldest);
    }
    this.#pendingSupersedes.set(eventId, itemId);
    this.#send(contextSupersedeEvents({ itemId, eventId }));
  }

  /** Forgets a delete that has been answered, however it was answered. */
  #settleSupersede(itemId: string): void {
    for (const [eventId, pending] of this.#pendingSupersedes) {
      if (pending === itemId) this.#pendingSupersedes.delete(eventId);
    }
  }

  /**
   * Whether an error is one of this call's own deletes coming back refused.
   *
   * The event is named when it is sent, so the answer naming it back is the
   * reliable half of this. The item id is checked too because the field
   * carrying the name back is not one the API reference states plainly, and a
   * silent mismatch here would put an error on screen for something the
   * developer neither did nor can do anything about.
   */
  #supersedeError(event: { message: string; eventId?: string }): boolean {
    if (this.#pendingSupersedes.size === 0) return false;
    if (event.eventId !== undefined && this.#pendingSupersedes.has(event.eventId)) {
      this.#pendingSupersedes.delete(event.eventId);
      return true;
    }
    for (const [eventId, itemId] of this.#pendingSupersedes) {
      if (event.message.includes(itemId)) {
        this.#pendingSupersedes.delete(eventId);
        return true;
      }
    }
    return false;
  }

  /**
   * The context items this call currently holds, by kind — what the
   * conversation would be answered from if a turn opened now. Exposed for the
   * tests that hold this class to its one-item-per-kind promise.
   */
  get liveContextItemIds(): ReadonlyMap<ContextItemKind, string> {
    return new Map([...this.#contextLive].map(([kind, live]) => [kind, live.itemId] as const));
  }

  /**
   * Whether this call is one the rosters and the guide travel on. Only the
   * developer's own call is: one Luke opened for himself exists to read a
   * sentence out, so it is sent that sentence and nothing else — the narrowest
   * thing that can leave the machine in a conversation nobody opened by hand.
   * The stores above still update either way, so the developer's next call
   * starts current.
   */
  #carriesContext(): boolean {
    return this.isConnected && this.#microphone !== undefined;
  }

  #handleServerEvent(data: unknown): void {
    const event = parseRealtimeServerEvent(data);
    if (!event) return;

    switch (event.type) {
      case REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED:
        if (event.itemId) this.#responseItemId = event.itemId;
        return;
      case REALTIME_SERVER_EVENT.RESPONSE_CREATED:
        // Only a reply the session is still waiting on may be adopted. A
        // confirmation arriving after the developer stopped or took the turn is
        // the cancelled reply's own, landing late — the stop raced the server's
        // confirmation — and adopting it would re-open the track over the quiet
        // just asked for, and let its finished form read as the current reply's.
        if (this.#status !== REALTIME_STATUS.RESPONDING) return;
        // The reply being asked for is under way, so anything arriving from here
        // belongs to it rather than to the one it replaced. Its name is what a
        // `response.done` must present to be read as this reply's: the channel
        // is ordered, so a cancelled reply's `done` lands before this
        // confirmation and finds nothing to match.
        if (event.responseId) this.#activeResponseId = event.responseId;
        this.#unsilenceLuke();
        return;
      case REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA:
        // Only the reply being spoken may write the caption. A cancelled reply's
        // transcript keeps arriving after the interrupt that cleared it — the
        // server had already produced it — and without this check a late piece
        // would draw the words Luke was just stopped from saying, or splice them
        // onto the next reply's.
        if (event.itemId === this.#responseItemId && event.delta) {
          this.#setCaption((this.#caption ?? "") + event.delta);
        }
        return;
      case REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE:
        // The server's own rendering of the whole reply, which the deltas only
        // approximate: a delta lost to the channel would otherwise leave a hole
        // in the sentence for as long as it stayed up. Held to the same item as
        // the deltas, because the cancelled reply's `done` is the likeliest
        // straggler of all.
        if (event.itemId === this.#responseItemId && event.transcript) {
          this.#setCaption(event.transcript);
        }
        return;
      case REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED:
        this.#audioEndingsReported = true;
        // The audio can run out while the server still owes the reply its
        // `done` — generation finishing and playback finishing have no fixed
        // order — and until that `done` the conversation holds an active
        // response. A turn ended here would offer READY to a caller with a
        // reply to ask for — the announcer reading out a notice that queued
        // behind this reply is the one that takes it — and the create it
        // sends would be refused as a conversation already in progress, the
        // refusal read out as a voice error and the notice lost. So the
        // drain is remembered and the `done` ends the turn, with the settle
        // backstop for a `done` that never comes.
        // An armed reply whose `done` has landed but whose follow-up is still
        // owed holds the same way, in the mirror order: the write is under
        // way, the READY an ending would offer is the same edge, and the
        // `done` already gave the hold a clock of its own.
        if (this.#responseOutstanding || this.#followUpPending) {
          this.#audioDrained = true;
          this.#armSettleTimer();
          return;
        }
        // The reply is over because the server says the audio ran out, not
        // because this end guessed from a stretch of quiet. A pause between two
        // sentences is quiet too, and guessing ended the turn in the middle of
        // one — the meter and the face went with it while Luke talked on.
        this.#finishResponse();
        return;
      case REALTIME_SERVER_EVENT.RESPONSE_DONE: {
        // Whether this is the reply now under way, or the finished form of one
        // the developer already talked or typed over. The server had completed
        // the old reply before the cancel landed — it generates ahead of the
        // room — so its `done` still arrives, after the interrupt has already
        // opened a new turn. Nothing of it may act with that turn's arming or
        // end that turn early: its calls are answered refused so the model is
        // not left waiting, and everything else about it is ignored.
        const fresh = event.responseId === this.#activeResponseId;
        // Whatever this reply turns out to be below, the server has concluded
        // it: from here the conversation can take a new `response.create`.
        if (fresh) this.#responseOutstanding = false;
        // A reply that asked for tools has not finished talking: the calls are
        // answered and the reply resumes over their outcomes, so the turn stays
        // open rather than ending on a reply that was only half made.
        if (event.calls.length > 0) {
          void this.#answerToolCalls(event.calls, fresh && this.#toolTurnArmed);
          if (fresh && this.#toolTurnArmed) {
            this.#followUpPending = true;
            // The turn now holds for the follow-up, because the READY an
            // ending here would offer while the writes run is the edge the
            // announcer rides — a reply taken there bumps the epoch, and the
            // follow-up voicing the outcome stands down against it, the
            // developer's answer abandoned for a notice. The hold is the
            // write's, so it gets a clock of its own: whatever backstop the
            // drain or an aside armed was watching for this `done` and may
            // have seconds left on it, while a write that hangs past a whole
            // window still meets a backstop — a turn that never ends is
            // worse than one that ends early.
            this.#clearSettleTimer();
            this.#armSettleTimer();
            return;
          }
          // The spoken half's audio already drained — its ending deferred to
          // this `done`, and a reply owing no follow-up ends here, exactly
          // as the drain would have ended it.
          if (fresh && this.#audioDrained) this.#finishResponse();
          return;
        }
        if (!fresh) return;
        // A reply the server says made no sound has nothing to play out — a
        // success is said with silence, so the follow-up after a tool call is
        // often exactly this. The meter will never hear him and never call
        // him quiet, and waiting out the settle backstop would hold the meter
        // and the face on a reply that was over the moment it was finished.
        // Only a response that reported its output may end here: an unknown
        // is not a silence, and keeps the ordinary endings below.
        if (event.hasAudio === false) {
          this.#finishResponse();
          return;
        }
        // Generation is done; the reply is not. The turn ends when Luke stops
        // being audible, which the caller reports from the audio itself rather
        // than from an event — the one that would say so is undocumented.
        this.#generationDone = true;
        // The server said the audio ran out before it said the reply was
        // over. That ending waited for this `done` — the conversation held
        // an active response until it — and lands now.
        if (this.#audioDrained) {
          this.#finishResponse();
          return;
        }
        // The audio can run out before the event that says generation is over.
        // The meter has already reported its quiet and will not report it twice,
        // so waiting for another would hold the turn open until the settle
        // timeout — seconds of a meter and a face saying Luke is still talking.
        if (this.#remoteQuiet && !this.#audioEndingsReported) {
          this.#finishResponse();
          return;
        }
        this.#armSettleTimer();
        return;
      }
      case REALTIME_SERVER_EVENT.CONVERSATION_ITEM_DELETED:
        if (event.itemId) this.#settleSupersede(event.itemId);
        return;
      case REALTIME_SERVER_EVENT.ERROR:
        // A delete this call issued can be answered with an error rather than a
        // deletion, because the item was already gone — evicted at the window's
        // edge is the way that happens. It is nothing the developer did and
        // nothing they can act on, and reporting it would both put a fault on
        // screen and, below, end a reply that is still being spoken.
        if (this.#supersedeError(event)) return;
        this.#options.onError(event.message);
        // An error can arrive *instead of* `response.done` — an empty push-to-talk
        // commit is the common case — which would otherwise leave the session
        // stuck in `responding` and unable to take another turn. But only a
        // reply the server never confirmed ends this way: behind a confirmed
        // one an error is an aside — the reply is still the server's, its own
        // `done` still ends the turn, and ending it here would offer READY
        // while the conversation still holds an active response. The settle
        // backstop covers a `done` that never comes.
        if (this.#activeResponseId !== undefined) {
          this.#armSettleTimer();
          return;
        }
        this.#finishResponse();
    }
  }

  /**
   * Answers the tool calls one reply made, then asks for the reply that voices
   * their outcomes. Every call is validated against the roster Luke was shown
   * before anything is carried, every outcome — including each refusal — is
   * answered so the model never waits on a call that will not return, and the
   * carrier's own failure is an outcome rather than an exception: the developer
   * asked for something, and what became of it has to be said.
   */
  async #answerToolCalls(calls: readonly RealtimeFunctionCall[], armed: boolean): Promise<void> {
    // `armed` is the hard gate, decided by the caller from two facts together:
    // a write runs only in a turn the developer opened — by speaking, or by
    // typing — and only out of the reply that turn actually asked for, never
    // the finished form of one the developer already interrupted. A call
    // failing either test is refused whatever it names, so a session summary
    // or a tool output that reads like an instruction can never make Luke act.
    // The turn's tools are also withheld at the API on every turn Luke opens
    // himself, so this is belt to that suspenders rather than the only thing
    // holding.
    // The turn these calls belong to. If it is no longer the current turn by
    // the time the writes finish, the developer has moved on and the outcome
    // must not be spoken over whatever they are now saying or hearing.
    const epoch = this.#turnEpoch;

    for (const call of calls) {
      const output = await this.#toolCallOutput(call, armed);
      this.#send(functionCallOutputEvents(call.callId, output));
    }

    // An unarmed turn — a proactive readout, a follow-up — carries no outcome
    // to voice: every call on it was refused, and opening a reply here would be
    // a turn that was meant to stay silent talking on without its instructions.
    // The calls are still answered above, so the model is not left waiting.
    if (!armed) return;
    // A follow-up now would talk over a live microphone or a newer reply: the
    // developer took the turn, started another, or the call is gone. The
    // outcomes were still delivered as items, so the next turn has them.
    if (!this.isConnected || this.#turnEpoch !== epoch) return;
    this.#startResponse(functionCallFollowUpEvents());
  }

  async #toolCallOutput(
    call: RealtimeFunctionCall,
    armed: boolean,
  ): Promise<Record<string, unknown>> {
    if (!armed) {
      return {
        status: "refused",
        reason: "Only a request you make yourself can act on a session or an issue.",
      };
    }
    const family = realtimeToolFamily(call.name);
    if (family === undefined) {
      return { status: "refused", reason: "No such tool exists." };
    }
    const outputForFamily = {
      [REALTIME_TOOL_FAMILY.APP]: () => this.#appToolCallOutput(call),
      [REALTIME_TOOL_FAMILY.ISSUE]: () => this.#issueToolCallOutput(call),
      [REALTIME_TOOL_FAMILY.SESSION]: () => this.#sessionToolCallOutput(call),
    } as const satisfies Record<RealtimeToolFamily, () => Promise<Record<string, unknown>>>;
    return outputForFamily[family]();
  }

  async #appToolCallOutput(call: RealtimeFunctionCall): Promise<Record<string, unknown>> {
    // An ask about Luke himself is validated against the guide the app
    // actually provided, then carried by the renderer the same way a session
    // act is: perform, and answer with what became of it.
    const appAction = appToolAction(call, this.#guide, this.#sessions);
    if (appAction.kind === "refused") return { status: "refused", reason: appAction.reason };
    if (!this.#options.carryAppAction) {
      return { status: "refused", reason: "Acting on Luke's own settings is not available." };
    }
    try {
      return await this.#options.carryAppAction(appAction);
    } catch (error) {
      return {
        status: "refused",
        reason: error instanceof Error ? error.message : "The change could not be made.",
      };
    }
  }

  async #sessionToolCallOutput(call: RealtimeFunctionCall): Promise<Record<string, unknown>> {
    // The build's own model tables ride into validation, so a creation ask
    // that names a model is held to the same set the settings rows offer.
    const action = sessionToolAction(
      call,
      this.#sessions,
      this.#workspaceProjects,
      workspaceAgentModels,
    );
    if (action.kind === "refused") return { status: "refused", reason: action.reason };
    if (!this.#options.carryAction) {
      return { status: "refused", reason: "Acting on sessions is not available." };
    }
    try {
      return await this.#options.carryAction(action);
    } catch (error) {
      return {
        status: "refused",
        reason: error instanceof Error ? error.message : "The action could not be carried out.",
      };
    }
  }

  async #issueToolCallOutput(call: RealtimeFunctionCall): Promise<Record<string, unknown>> {
    // No roster was ever sent, so there is nothing a call could have named.
    if (!this.#issues) {
      return { status: "refused", reason: "No issue tracker is connected." };
    }
    const action = issueToolAction(call, this.#issues);
    if (action.kind === "refused") return { status: "refused", reason: action.reason };
    if (!this.#options.carryIssueAction) {
      return { status: "refused", reason: "Acting on issues is not available." };
    }
    try {
      return await this.#options.carryIssueAction(action);
    } catch (error) {
      return {
        status: "refused",
        reason: error instanceof Error ? error.message : "The action could not be carried out.",
      };
    }
  }

  #send(events: readonly Record<string, unknown>[]): void {
    const channel = this.#channel;
    if (channel?.readyState !== "open") return;
    for (const event of events) channel.send(JSON.stringify(event));
  }

  #fail(message: string): boolean {
    // Release the device before reporting. `FAILED` offers "Start voice" again,
    // and retrying must not stack a second call on top of a live microphone.
    this.#teardown();
    this.#options.onError(message);
    this.#setStatus(REALTIME_STATUS.FAILED);
    return false;
  }

  #setStatus(status: RealtimeStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#restIdleTimer(status);
    // The exchange settling is what closes the device the press opened — not
    // the commit itself, because closing a capture device is audible on
    // shared hardware (a Bluetooth headset renegotiates its codec), and at
    // the commit Luke is just starting to answer. Here the reply is over and
    // the blip lands in the quiet. A press already waiting keeps the device:
    // its turn is about to reuse it.
    if (status === REALTIME_STATUS.READY && !this.#pendingTurn) this.#releaseMicrophone();
    this.#options.onStatus(status);
  }

  /**
   * Starts the clock on an idle call, or stops it because the call is in use.
   *
   * Only the developer's own call is retired this way. The call Luke opens to
   * read a notice out already puts itself away once the queue is quiet, and it
   * holds no conversation worth a clock of its own.
   *
   * A settled call restarts the clock however it settled, so a notice read out
   * counts as the call being used. It reached the developer, and a call that
   * just spoke to someone is not one nobody is having.
   */
  #restIdleTimer(status: RealtimeStatus): void {
    this.#clearIdleTimer();
    if (status !== REALTIME_STATUS.READY || !this.#withMicrophone) return;
    const timeoutMs = positiveInteger(this.#options.idleTimeoutMs, VOICE_IDLE_TIMEOUT_MS);
    this.#idleTimer = (this.#options.schedule ?? setTimeout)(() => {
      this.#idleTimer = undefined;
      // Re-checked at the moment of closing, because ten minutes is long: a
      // turn may have opened, or the call may already be gone.
      if (this.#status !== REALTIME_STATUS.READY || !this.#withMicrophone) return;
      void this.close();
    }, timeoutMs);
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer === undefined) return;
    (this.#options.cancel ?? clearTimeout)(this.#idleTimer as Parameters<typeof clearTimeout>[0]);
    this.#idleTimer = undefined;
  }
}
