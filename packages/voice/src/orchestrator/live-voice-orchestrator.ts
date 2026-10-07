import { LIVE_SESSION_PHASE, type VoiceLiveSessionChanged } from "@sidecar/gateway";
import { LIVE_STATUS, type LiveStatus, liveExchangeActive } from "@sidecar/live";
import { CONVERSATION_ENTRY_KIND } from "@sidecar/session";
import { type Context, Deferred, Effect, Exit, Fiber, type Scope } from "effect";
import type {
  LiveCaptionRow,
  LiveVoiceCall,
  LiveVoiceCallEvents,
  LiveVoiceSpeakers,
} from "./live-voice-call.js";
import { NoticeStrip } from "./notice-strip.js";

/**
 * What the orchestrator reads rather than owns: whether a voice stands at
 * all, whether the captions are wanted, whether the output is silent, and
 * whether the microphone is granted. Amended whole from the document each
 * time it moves.
 */
export interface LiveVoiceSurroundings {
  voiceAvailable: boolean | undefined;
  captionsEnabled: boolean;
  outputSilent: boolean;
  microphoneGranted: boolean;
}

/**
 * What a panel needs to draw the live conversation, reported whole on every
 * edge. Both speakers are carried beside the status, which names one of them
 * at a time: the status is what the media duck and the exchange count read,
 * and the two flags are what a full-duplex panel draws.
 */
export interface LiveVoiceView extends LiveVoiceSpeakers {
  voiceStatus: LiveStatus;
  voiceError: string | undefined;
  voiceNotice: string | undefined;
  /** Whether a press is still waiting on the session it opened. */
  talkOpening: boolean;
  /** Luke's rows while he speaks, when the captions preference or a silent output asks for them. */
  lukeCaptions: readonly string[] | undefined;
  /** The developer's own rows while they are still being said, under the captions preference alone. */
  developerCaptions: readonly string[] | undefined;
  /** The plan the standing call is about; none while no call stands. */
  callPlanId: string | undefined;
}

/** Everything the policy asks of the process that hosts it. */
export interface LiveVoiceBridge {
  /** The view as it moved, and whether this report is the one an exchange opened on, which is what is counted. */
  reportView(view: LiveVoiceView, exchangeOpened: boolean): void;
  /** Asks the system for the microphone, answering whether it is granted. */
  requestMicrophone(): Effect.Effect<boolean>;
  /** The neutral note said when the hosted service's ceiling refuses a session. */
  hostedUnavailableNote(): Effect.Effect<string | undefined>;
  /** Tells the host to stop Luke speaking, answering whether a session stood to tell; the stop key's ask alone, and only while he speaks. */
  stopSpeaking(): Effect.Effect<boolean>;
}

interface LiveVoiceOrchestratorOptions {
  bridge: LiveVoiceBridge;
  createCall: (events: LiveVoiceCallEvents) => LiveVoiceCall;
  /** The services the notice strip's clocks are run under, since the strip is armed from synchronous callbacks that belong to no fiber. */
  services: Context.Context<never>;
}

/** Nobody heard on either side, which is what a call that is gone carries. */
const SILENT: LiveVoiceSpeakers = { listening: false, lukeSpeaking: false };

const MICROPHONE_REFUSED_NOTE =
  "The talk key needs the microphone. Allow it in System Settings, " +
  "under Privacy & Security, Microphone — or type to Luke instead.";

function sameView(left: LiveVoiceView, right: LiveVoiceView): boolean {
  return (
    left.voiceStatus === right.voiceStatus &&
    left.voiceError === right.voiceError &&
    left.voiceNotice === right.voiceNotice &&
    left.talkOpening === right.talkOpening &&
    left.lukeCaptions === right.lukeCaptions &&
    left.developerCaptions === right.developerCaptions &&
    left.callPlanId === right.callPlanId &&
    left.listening === right.listening &&
    left.lukeSpeaking === right.lukeSpeaking
  );
}

/**
 * The one voice session as the desktop drives it, following the live guide's
 * one-owner rule: the renderer owns the microphone switch and the hang-up,
 * the host owns every append and the close decision. Every session is a
 * planning call about one plan. The talk key is held to talk: its press
 * opens the call about the plan the window has open if none stands and
 * unmutes it, its release mutes, and the microphone is open exactly between
 * the two; the stop key mutes the same way and silences Luke where he is
 * speaking. The host's `voiceLiveSession.changed` is obeyed rather than
 * reasoned about: closing hangs up. No turn is committed, no reply is
 * claimed, and no words are
 * written here: both speakers' lines are the host's, from the transcript its
 * sideband receives.
 *
 * Every verb is an Effect of the caller's own fiber, and the standing call's
 * whole life is one daemon fiber forked from it: it acquires the call by
 * opening it, waits to be told the call should end, and releases it by
 * closing it, so a call is closed exactly once whichever way its life ends —
 * on its own status, on the host's word, or on `stop`'s interruption. What
 * stays a plain method is what decides nothing asynchronously: `surround`
 * amends the surroundings, and the call's own callbacks report a status or a
 * caption row.
 */
export class LiveVoiceOrchestrator {
  readonly #bridge: LiveVoiceBridge;
  readonly #createCall: (events: LiveVoiceCallEvents) => LiveVoiceCall;
  readonly #services: Context.Context<never>;
  readonly #strip = new NoticeStrip({
    onChanged: () => this.#touch(),
    fork: (effect) => Effect.runForkWith(this.#services)(effect),
  });
  #call: LiveVoiceCall | undefined;
  #surroundings: LiveVoiceSurroundings = {
    voiceAvailable: undefined,
    captionsEnabled: false,
    outputSilent: false,
    microphoneGranted: false,
  };
  #status: LiveStatus = LIVE_STATUS.IDLE;
  #speakers: LiveVoiceSpeakers = SILENT;
  #rows: readonly LiveCaptionRow[] = [];
  #lukeCaptions: readonly string[] | undefined;
  #developerCaptions: readonly string[] | undefined;
  #talkOpening = false;
  /** The plan the call standing or opening is about. */
  #callPlan: string | undefined;
  /** The open still negotiating: a second ask reads its answer rather than building a second call. */
  #opening: Deferred.Deferred<LiveVoiceCall | undefined> | undefined;
  /** The standing call's whole life, in the scope it was acquired into; interrupting this is what `stop` releases it with. */
  #lifecycle: Fiber.Fiber<void> | undefined;
  /** Completed once the standing call should end, which is what lets its lifecycle fiber close the scope and release it. */
  #ending: Deferred.Deferred<void> | undefined;
  /**
   * Whether the talk key is down. A press's unmute follows the session it
   * opened only while this still stands, so a key let go of, or a stop
   * pressed, during the opening leaves the session muted rather than
   * unmuting one nobody wants heard.
   */
  #pressHeld = false;
  /**
   * Whether the talk key itself is down, apart from any press. It is what a
   * press that first has to hang another call up reads once that call is
   * gone, since the key may have come up during the wait, before the press
   * had marked itself held.
   */
  #keyDown = false;
  #reported: LiveVoiceView | undefined;
  /** The call whose exchange has been counted, so a session pausing between Luke's sentences is not a second exchange. */
  #countedCall: LiveVoiceCall | undefined;
  #counted = false;
  #queued = false;
  #stopped = false;

  constructor(options: LiveVoiceOrchestratorOptions) {
    this.#bridge = options.bridge;
    this.#createCall = options.createCall;
    this.#services = options.services;
  }

  surround(surroundings: LiveVoiceSurroundings): void {
    const stoodAvailable = this.#surroundings.voiceAvailable;
    this.#surroundings = surroundings;
    if (surroundings.voiceAvailable === false && stoodAvailable !== false && this.#call) {
      this.#endCall();
    }
    this.#recomposeCaptions();
    this.#touch();
  }

  /**
   * The talk key going down. Against no session it opens one and unmutes it;
   * against a standing session it unmutes. It never mutes: the key coming up
   * does that, so a hold is heard for exactly as long as it lasts, and a
   * hold that ended while the system's microphone dialog stood, or while the
   * session was opening, unmutes nothing. A press made while the window has
   * a plan open names that plan: it speaks into the call about that plan,
   * opening one if none stands and hanging up a call about any other plan
   * first, as the window's own button does. A press naming no plan speaks
   * into whatever call stands, and with none standing does nothing: there is
   * no call about no plan.
   */
  beginTalk(planId?: string): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const plan = planId ?? (this.#call === undefined ? undefined : this.#callPlan);
      if (plan === undefined) return;
      if (this.#surroundings.voiceAvailable === false) {
        const unavailable = yield* this.#bridge.hostedUnavailableNote();
        if (unavailable) this.#strip.showNotice(unavailable);
        return;
      }
      this.#keyDown = true;
      if (this.#call !== undefined && this.#callPlan !== plan) {
        yield* this.#hangUp();
        // Note that a key let go of while the old call closed opens nothing.
        if (!this.#keyDown) return;
      }
      yield* this.#talk(plan);
    });
  }

  /**
   * The Plans tab's microphone button, about the plan the panel has
   * open. It toggles rather than holds, because a planning conversation runs
   * for minutes: against the call about that plan, a press while the
   * developer is heard mutes, and a press while muted unmutes. Against no
   * call it opens one about the plan and unmutes it; against a call about
   * another plan, that call is hung up first,
   * since only one plan is ever the spoken conversation and no other call
   * may carry the plan's words or hear its answers.
   */
  talkAboutPlan(planId: string): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (this.#surroundings.voiceAvailable === false) {
        const unavailable = yield* this.#bridge.hostedUnavailableNote();
        if (unavailable) this.#strip.showNotice(unavailable);
        return;
      }
      const call = this.#call;
      if (call !== undefined && this.#callPlan === planId && this.#pressHeld) {
        // A press while the call is still opening leaves it to open muted.
        this.#pressHeld = false;
        if (!this.#opening && call.standing) yield* call.mute();
        this.#touch();
        return;
      }
      if (call !== undefined && this.#callPlan !== planId) yield* this.#hangUp();
      yield* this.#talk(planId);
    });
  }

  /**
   * The press's own work, for the talk key and the planning button alike:
   * the microphone asked for where it is not granted, the session opened if
   * none stands, and the developer heard for as long as the press stands.
   */
  #talk(planId: string): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      this.#pressHeld = true;
      if (!this.#surroundings.microphoneGranted) {
        const granted = yield* this.#bridge.requestMicrophone();
        if (!granted) {
          this.#strip.showError(MICROPHONE_REFUSED_NOTE);
          return;
        }
        if (!this.#pressHeld) return;
      }
      const call = yield* this.#ensureSession(planId);
      // A key let go of during the opening leaves the session muted, and the
      // mute is still sent: the press's device rode the offer, and only the
      // release takes it back.
      if (call) yield* this.#pressHeld ? call.unmute() : call.mute();
      // The press is answered once the session hears the developer; between the
      // offer and the unmute the session passes through muted, which is not the
      // exchange ending.
      this.#talkOpening = false;
      this.#touch();
    });
  }

  /**
   * The talk key coming up: the microphone closes. A release while the
   * press's session is still opening leaves it to open muted, and one with
   * no press behind it does nothing.
   */
  endTalk(): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.#keyDown = false;
      if (!this.#pressHeld) return Effect.void;
      this.#pressHeld = false;
      if (this.#opening) return Effect.void;
      const call = this.#call;
      return call?.standing ? Effect.asVoid(call.mute()) : Effect.void;
    });
  }

  /**
   * The stop key, and the panel's Escape: the microphone closes, and where
   * Luke is actually speaking his voice is silenced on this device at once
   * and the host tells the model to stop. The silence goes first because the
   * model obeys only when it next can, and the guide leaves blocking its
   * audio to the client; the call brings playback back once the silenced
   * utterance has ended. The stop goes before the mute so a press
   * mid-sentence reaches the model as soon as it can, and the mute lands
   * even where the host could not be reached. A press
   * against a call that is merely listening sends none: the instruction is
   * standing text in the session, so telling a silent model to stop steers
   * the answer it has not given yet. The talk key's release is `endTalk` and
   * never carries the stop or the silence either: under hold-to-talk it
   * mutes while Luke is routinely still answering. Pressed while a press's session is still
   * opening, it cancels that press's unmute, so the session opens muted.
   */
  stopSpeaking(): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      this.#pressHeld = false;
      // A session still being opened has no peer to mute yet; the press
      // remembers the key is no longer held and leaves the session muted.
      if (this.#opening) return true;
      const call = this.#call;
      if (!call?.standing) return false;
      if (call.status === LIVE_STATUS.SPEAKING) {
        call.silenceOutput();
        yield* this.#bridge.stopSpeaking();
      }
      yield* call.mute();
      return true;
    });
  }

  /**
   * The panel's stop: the standing call ends now, whatever it is about. Where
   * Luke is speaking he is silenced on this device and the host tells the
   * model to stop first, so his voice does not run on through the graceful
   * close; then the microphone closes
   * and the call is let go of at once, so the view reads no call before the
   * close has finished behind it. Unlike the stop key, nothing stands after
   * it: the next press opens a new call. A press over no call does nothing.
   */
  stopCall(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      this.#pressHeld = false;
      const call = this.#call;
      if (call?.standing && !this.#opening) {
        if (call.status === LIVE_STATUS.SPEAKING) {
          call.silenceOutput();
          yield* this.#bridge.stopSpeaking();
        }
        yield* call.mute();
      }
      yield* this.#hangUp();
    });
  }

  /** The panel asking for the microphone from its own row. */
  requestMicrophoneAccess(): Effect.Effect<void> {
    return Effect.asVoid(this.#bridge.requestMicrophone());
  }

  /**
   * The host's word on the one session: closing is the host's decision to
   * end it, so the peer hangs up, and closed lets the call go whatever the
   * peer still shows.
   */
  obeySessionChange(change: VoiceLiveSessionChanged): Effect.Effect<void> {
    return Effect.sync(() => {
      switch (change.phase) {
        case LIVE_SESSION_PHASE.CLOSING:
          if (this.#aboutThisCall(change)) this.#endCall();
          return;
        case LIVE_SESSION_PHASE.CLOSED: {
          // A call still standing that the word is not about is left alone.
          if (this.#call && !this.#aboutThisCall(change)) return;
          // The host's word ends the session whatever the peer still shows: the
          // call is let go of here so the next press opens a new one, and it
          // finishes its own hang-up behind.
          this.#releasePress();
          if (this.#call) {
            this.#call = undefined;
            this.#status = LIVE_STATUS.IDLE;
            this.#speakers = SILENT;
            this.#rows = [];
            this.#endCall();
            this.#recomposeCaptions();
            this.#touch();
          }
          return;
        }
        default:
          return;
      }
    });
  }

  /**
   * Whether the host's word names the session this call holds. The host
   * closes a session it still held before creating the next, and that close
   * names the old session: a call still waiting for its offer to be answered
   * holds no session yet, and one answered holds another, so neither is the
   * one the host means.
   */
  #aboutThisCall(change: VoiceLiveSessionChanged): boolean {
    const held = this.#call?.sessionId;
    return held !== undefined && (change.sessionId === undefined || change.sessionId === held);
  }

  /**
   * Interrupts the standing call's lifecycle fiber, which is what releases
   * it: `Effect.acquireRelease`'s own guarantee closes it exactly once,
   * whether the interruption lands mid-open or mid-standing.
   */
  stop(): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.#stopped = true;
      const fiber = this.#lifecycle;
      this.#lifecycle = undefined;
      this.#call = undefined;
      return fiber ? Effect.asVoid(Fiber.interrupt(fiber)) : Effect.void;
    });
  }

  /**
   * Hangs the standing call up and waits for it to be closed, whether it
   * stands or is still opening, and lets go of it at once, so the call
   * opened next is a new one and the old one's reports are no longer heard.
   */
  #hangUp(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const fiber = this.#lifecycle;
      this.#lifecycle = undefined;
      this.#call = undefined;
      this.#opening = undefined;
      this.#ending = undefined;
      this.#status = LIVE_STATUS.IDLE;
      this.#speakers = SILENT;
      this.#rows = [];
      this.#talkOpening = false;
      this.#recomposeCaptions();
      this.#touch();
      return fiber ? Effect.asVoid(Fiber.interrupt(fiber)) : Effect.void;
    });
  }

  /**
   * A planning call's press is a toggle that stands for minutes, so it ends
   * with the call: nothing after it (the talk key's release) reads it as the
   * developer still wanting to be heard.
   */
  #releasePress(): void {
    this.#pressHeld = false;
  }

  /** Signals the standing call's lifecycle fiber to end, which releases it by closing it exactly once. */
  #endCall(): void {
    const ending = this.#ending;
    this.#ending = undefined;
    if (ending) Deferred.doneUnsafe(ending, Exit.void);
  }

  /**
   * The session standing or coming up, or a new one opened now. One opening
   * at a time: a second ask while the first is still negotiating waits for
   * it rather than offering the host a second peer.
   */
  #ensureSession(planId: string): Effect.Effect<LiveVoiceCall | undefined> {
    return Effect.gen({ self: this }, function* () {
      if (this.#call?.standing) return this.#call;
      const negotiating = this.#opening;
      if (negotiating) return yield* Deferred.await(negotiating);
      const opened = Deferred.makeUnsafe<LiveVoiceCall | undefined>();
      this.#opening = opened;
      this.#callPlan = planId;
      this.#strip.clear();
      const call = this.#createCall({
        onStatus: (status, speakers) => this.#onStatus(call, status, speakers),
        onCaptions: (rows) => this.#onCaptions(call, rows),
        onError: (message) => this.#strip.showError(message),
      });
      this.#call = call;
      this.#talkOpening = true;
      this.#touch();
      // Detached from the asking fiber rather than a child of it, because the
      // call outlives the press that asked for it, and started on this stack
      // rather than deferred, because a fiber that begins on the next
      // scheduler task would leave the press's own open — and the connecting
      // status it reports — a task behind the view this verb has already
      // touched.
      this.#lifecycle = yield* Effect.forkDetach(
        Effect.scoped(this.#lifecycleEffect(call, planId, opened)),
        { startImmediately: true },
      );
      return yield* Deferred.await(opened);
    });
  }

  /**
   * The call's whole life, in the scope it was acquired into: opening it is
   * the acquire, closing it the release, so a call that fails to open, ends
   * on its own, is told to end, or has this fiber interrupted is closed
   * exactly once either way. `opened` is settled on every exit, including an
   * interruption that lands before the open itself decided anything, so a
   * concurrent ask waiting on it is never left hanging on a call `stop`
   * dropped before it stood.
   */
  #lifecycleEffect(
    call: LiveVoiceCall,
    planId: string,
    opened: Deferred.Deferred<LiveVoiceCall | undefined>,
  ): Effect.Effect<void, never, Scope.Scope> {
    return Effect.gen({ self: this }, function* () {
      const standing = yield* Effect.acquireRelease(call.open({ planId }), () => call.close());
      if (this.#opening === opened) this.#opening = undefined;
      if (!standing) {
        this.#talkOpening = false;
        if (this.#call === call) this.#call = undefined;
        const unavailable = yield* this.#bridge.hostedUnavailableNote();
        if (unavailable) this.#strip.showNotice(unavailable);
        this.#touch();
        yield* Deferred.succeed(opened, undefined);
        return;
      }
      this.#touch();
      yield* Deferred.succeed(opened, call);
      const ending = Deferred.makeUnsafe<void>();
      this.#ending = ending;
      yield* Deferred.await(ending);
    }).pipe(Effect.onExit(() => Effect.asVoid(Deferred.succeed(opened, undefined))));
  }

  #onStatus(call: LiveVoiceCall, status: LiveStatus, speakers: LiveVoiceSpeakers): void {
    if (this.#call !== call) return;
    this.#status = status;
    this.#speakers = speakers;
    if (status === LIVE_STATUS.IDLE || status === LIVE_STATUS.FAILED) {
      this.#call = undefined;
      this.#rows = [];
      this.#releasePress();
      this.#endCall();
    }
    this.#recomposeCaptions();
    this.#touch();
  }

  #onCaptions(call: LiveVoiceCall, rows: readonly LiveCaptionRow[]): void {
    if (this.#call !== call) return;
    this.#rows = rows;
    this.#recomposeCaptions();
    this.#touch();
  }

  /**
   * The captions as the panel draws them: Luke's words under the housing
   * while he speaks and there is a reason to read them, the developer's own
   * words while they are still being said and the captions preference asks
   * for them. A silent output is a reason to
   * read Luke, who could not otherwise be heard, and no reason to read the
   * developer, who said the words themselves; so their captions follow the
   * preference alone. A developer row is unsettled for the ledger's gap after
   * its last fragment, which is what keeps a finished sentence on screen a
   * moment after the transcript catches up with it.
   */
  #recomposeCaptions(): void {
    const unsettled = this.#rows.filter((row) => !row.settled);
    const lukeRows = unsettled
      .filter((row) => row.entry.kind === CONVERSATION_ENTRY_KIND.REPLY)
      .map((row) => row.entry.words);
    const wanted =
      (this.#surroundings.captionsEnabled || this.#surroundings.outputSilent) &&
      this.#status === LIVE_STATUS.SPEAKING;
    const nextCaptions = wanted && lukeRows.length > 0 ? lukeRows : undefined;
    if (!sameWords(this.#lukeCaptions, nextCaptions)) this.#lukeCaptions = nextCaptions;
    const developerRows = unsettled
      .filter((row) => row.entry.kind === CONVERSATION_ENTRY_KIND.ASK)
      .map((row) => row.entry.words);
    const nextDeveloperCaptions =
      this.#surroundings.captionsEnabled && developerRows.length > 0 ? developerRows : undefined;
    if (!sameWords(this.#developerCaptions, nextDeveloperCaptions)) {
      this.#developerCaptions = nextDeveloperCaptions;
    }
  }

  #compose(): LiveVoiceView {
    return {
      voiceStatus: this.#status,
      listening: this.#speakers.listening,
      lukeSpeaking: this.#speakers.lukeSpeaking,
      voiceError: this.#strip.error,
      voiceNotice: this.#strip.notice,
      talkOpening: this.#talkOpening,
      lukeCaptions: this.#lukeCaptions,
      developerCaptions: this.#developerCaptions,
      callPlanId: this.#call === undefined ? undefined : this.#callPlan,
    };
  }

  /**
   * Two facts moving together are one report, folded until the microtask
   * drains; a view that did not move is not reported at all, since the report
   * becomes a version of the document this same window reads. The count of
   * exchanges rides the report on the opening edge alone.
   */
  #touch(): void {
    if (this.#stopped || this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      if (this.#stopped) return;
      const view = this.#compose();
      if (this.#reported !== undefined && sameView(this.#reported, view)) return;
      this.#reported = view;
      const active = liveExchangeActive(view);
      const rising = active && !this.#counted && this.#call !== this.#countedCall;
      this.#counted = active;
      if (rising) this.#countedCall = this.#call;
      this.#bridge.reportView(view, rising);
    });
  }
}

function sameWords(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((word, index) => word === right[index]);
}
