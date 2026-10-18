import { LIVE_SESSION_PHASE, type VoiceLiveSessionChanged } from "@luke/gateway";
import {
  LIVE_STATUS,
  type LiveStatus,
  liveExchangeActive,
  TRANSCRIPT_SPEAKER,
  type TranscriptSpeaker,
} from "@luke/live";
import { CONVERSATION_ENTRY_KIND, type ConversationEntryKind } from "@luke/wire/conversation";
import { type Context, Deferred, Duration, Effect, Exit, Fiber, Option, type Scope } from "effect";
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

/** One line said on the standing call, as its captions group it: the row it grows on, who said it, the words so far, and its span in milliseconds into the call, which is what a turn that took it as its ask names it by. */
interface LiveCallLine {
  readonly rowId: string;
  readonly speaker: TranscriptSpeaker;
  readonly words: string;
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Everything said on the standing call so far, settled or not and whatever
 * the captions preference says: the store's id for the call's session, where
 * an account holds it, and its lines in the order they opened. It is what the
 * Tasks tab's transcript draws until the call ends and the record is read.
 */
export interface LiveCallTranscript {
  readonly voiceSessionId: string | undefined;
  readonly lines: readonly LiveCallLine[];
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
  /** The task the standing call is about; none while no call stands. */
  callTaskId: string | undefined;
  /** What was said on the standing call so far; none while no call stands or before its first line. */
  callTranscript: LiveCallTranscript | undefined;
  /** The store's id for the session of the last call Luke ended himself, so the transcript can say so; none before he has. */
  lukeEndedCall: string | undefined;
  /** Whether Luke's voice is silenced on this device for the standing call; never while none stands. */
  speakerMuted: boolean;
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

const SPEAKER_OF_KIND = {
  [CONVERSATION_ENTRY_KIND.ASK]: TRANSCRIPT_SPEAKER.USER,
  [CONVERSATION_ENTRY_KIND.REPLY]: TRANSCRIPT_SPEAKER.ASSISTANT,
} as const satisfies Record<ConversationEntryKind, TranscriptSpeaker>;

/** Nobody heard on either side, which is what a call that is gone carries. */
const SILENT: LiveVoiceSpeakers = { listening: false, lukeSpeaking: false };

/**
 * How long Luke's goodbye is waited on once the host says he is ending the
 * call. The word can land before the goodbye's audio does, since the voice
 * delegates as it starts speaking, so a Luke still quiet is given
 * `START_MS` to begin before his goodbye is taken as already over. A goodbye
 * is one short line; Luke still talking `PLAYBACK_MS` after the word is Luke
 * carrying on, so the call stays up rather than cutting him off.
 */
const LUKE_ENDING_BOUNDS = {
  START_MS: 1_500,
  PLAYBACK_MS: 15_000,
} as const;

/**
 * Luke ending the standing call, from the host's word until his goodbye has
 * played: the call it is about, the developer's words as they stood when the
 * word came, whether Luke has been heard since, and whether the goodbye
 * played out (true) or the developer spoke over it (false).
 */
interface LukeEnding {
  readonly call: LiveVoiceCall;
  readonly developerWords: string;
  spoke: boolean;
  readonly played: Deferred.Deferred<boolean>;
}

/**
 * Everything the developer has said on the call so far, as words alone,
 * which grows the moment they speak again. Note that a delta of spacing
 * alone moves nothing, because the transcript's last fragments of the
 * goodbye itself may still be landing.
 */
function developerWordsOf(rows: readonly LiveCaptionRow[]): string {
  return rows
    .filter((row) => row.entry.kind === CONVERSATION_ENTRY_KIND.ASK)
    .map((row) => row.entry.words)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

const MICROPHONE_REFUSED_NOTE =
  "The talk key needs the microphone. Allow it in System Settings › Privacy & Security › Microphone.";

function sameView(left: LiveVoiceView, right: LiveVoiceView): boolean {
  return (
    left.voiceStatus === right.voiceStatus &&
    left.voiceError === right.voiceError &&
    left.voiceNotice === right.voiceNotice &&
    left.talkOpening === right.talkOpening &&
    left.lukeCaptions === right.lukeCaptions &&
    left.developerCaptions === right.developerCaptions &&
    left.callTaskId === right.callTaskId &&
    left.callTranscript === right.callTranscript &&
    left.lukeEndedCall === right.lukeEndedCall &&
    left.speakerMuted === right.speakerMuted &&
    left.listening === right.listening &&
    left.lukeSpeaking === right.lukeSpeaking
  );
}

/**
 * The one voice session as the desktop drives it, following the live guide's
 * one-owner rule: the renderer owns the microphone switch and the hang-up,
 * the host owns every append and the close decision. Every session is a
 * task call about one task. The talk key is held to talk: its press
 * opens the call about the task the window has open if none stands, speaks
 * into the standing call whatever task is open if one does, and unmutes it;
 * its release mutes, and the microphone is open exactly between
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
  #callTranscript: LiveCallTranscript | undefined;
  #talkOpening = false;
  /** Whether the developer silenced Luke's voice on this device for the call standing, which its end lets go of. */
  #speakerMuted = false;
  /** The task the call standing or opening is about. */
  #callTask: string | undefined;
  /** The open still negotiating: a second ask reads its answer rather than building a second call. */
  #opening: Deferred.Deferred<LiveVoiceCall | undefined> | undefined;
  /** The standing call's whole life, in the scope it was acquired into; interrupting this is what `stop` releases it with. */
  #lifecycle: Fiber.Fiber<void> | undefined;
  /** Completed once the standing call should end, which is what lets its lifecycle fiber close the scope and release it. */
  #ending: Deferred.Deferred<void> | undefined;
  /** Luke ending the standing call, from the host's word until his goodbye has played or the developer spoke over it. */
  #lukeEnding: LukeEnding | undefined;
  #lukeEndedCall: string | undefined;
  /**
   * Completed once a call told to end while still held is let go of. A
   * closing call hears nothing more, so a press landing during its close
   * waits on this and is heard on the next call instead.
   */
  #closing: Deferred.Deferred<void> | undefined;
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
   * session was opening, unmutes nothing. A press speaks into the call
   * standing or opening, whatever task the window has open, because the call
   * outlives the task on screen and a hold must not hang it up: moving the
   * call to another task is that task's own button. With no call, a press
   * made while the window has a task open opens the call about that task,
   * and a press naming no task does nothing: there is no call about no task.
   */
  beginTalk(taskId?: string): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (taskId === undefined && this.#call === undefined) return;
      if (this.#surroundings.voiceAvailable === false) {
        const unavailable = yield* this.#bridge.hostedUnavailableNote();
        if (unavailable) this.#strip.showNotice(unavailable);
        return;
      }
      this.#keyDown = true;
      // A press over a call the host is closing waits it out. A key let go of
      // meanwhile opens nothing, and nor does a press naming no task, which
      // spoke into the call that has now gone.
      if ((yield* this.#outlastClosing()) && (!this.#keyDown || taskId === undefined)) return;
      const task = this.#call === undefined ? taskId : this.#callTask;
      if (task === undefined) return;
      yield* this.#talk(task);
    });
  }

  /**
   * The Tasks tab's microphone button, about the task the panel has
   * open. It toggles rather than holds, because a task conversation runs
   * for minutes: against the call about that task, a press while the
   * developer is heard mutes, and a press while muted unmutes. Against no
   * call it opens one about the task and unmutes it; against a call about
   * another task, that call is hung up first,
   * since only one task is ever the spoken conversation and no other call
   * may carry the task's words or hear its answers.
   */
  talkAboutTask(taskId: string): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (this.#surroundings.voiceAvailable === false) {
        const unavailable = yield* this.#bridge.hostedUnavailableNote();
        if (unavailable) this.#strip.showNotice(unavailable);
        return;
      }
      const call = this.#call;
      if (call !== undefined && this.#callTask === taskId && this.#pressHeld) {
        // A press while the call is still opening leaves it to open muted.
        this.#pressHeld = false;
        if (!this.#opening && call.standing) yield* call.mute();
        this.#touch();
        return;
      }
      if (call !== undefined && this.#callTask !== taskId) yield* this.#hangUp();
      yield* this.#outlastClosing();
      yield* this.#talk(taskId);
    });
  }

  /**
   * The microphone's mute chord, pressed wherever the panel stands: the call
   * standing is toggled as its task's own button toggles it, whatever task
   * is open, since the call outlives the task on screen. A press over no call,
   * or over one the host is closing, opens nothing.
   */
  toggleMicrophone(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const task =
        this.#call === undefined || this.#closing !== undefined ? undefined : this.#callTask;
      return task === undefined ? Effect.void : this.talkAboutTask(task);
    });
  }

  /**
   * The press's own work, for the talk key and the Tasks tab's button alike:
   * the microphone asked for where it is not granted, the session opened if
   * none stands, and the developer heard for as long as the press stands.
   */
  #talk(taskId: string): Effect.Effect<void> {
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
      const call = yield* this.#ensureSession(taskId);
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
   * The panel's hang-up: the standing call ends now, whatever it is about.
   * Where Luke is speaking he is silenced on this device, so his voice does
   * not run on through the graceful close; then the microphone closes and
   * the call is let go of at once, so the view reads no call before the
   * close has finished behind it. Note that the host is never told to stop,
   * unlike under the stop key, because its stop cancels the work Luke has
   * under way, and hanging up ends the voice alone: Luke goes on working and
   * a call back finds him there. A press over no call does nothing.
   */
  stopCall(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      this.#pressHeld = false;
      const call = this.#call;
      if (call?.standing && !this.#opening) {
        if (call.status === LIVE_STATUS.SPEAKING) call.silenceOutput();
        yield* call.mute();
      }
      yield* this.#hangUp();
    });
  }

  /**
   * The panel's speaker toggle: Luke's voice silenced on this device, or
   * heard again, for the call standing. It is playback alone, so the session
   * is told nothing and Luke goes on speaking: his words caption whatever
   * the captions preference, as over a silent output, and still transcribe,
   * and his speaking status, read off his track rather than off
   * what plays, still says when he is done. The call's end lets it go, so
   * the next call is heard; a press over no call does nothing.
   */
  muteSpeaker(muted: boolean): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.#call === undefined) return;
      this.#speakerMuted = muted;
      this.#recomposeCaptions();
      this.#touch();
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
    if (change.phase === LIVE_SESSION_PHASE.ENDING) return this.#lukeEnds(change);
    return Effect.sync(() => {
      switch (change.phase) {
        case LIVE_SESSION_PHASE.CLOSING:
          if (!this.#aboutThisCall(change)) return;
          // A press that stood for this call ends with it, so the next press opens a new one.
          this.#releasePress();
          this.#endCall();
          return;
        case LIVE_SESSION_PHASE.CLOSED: {
          // A call still standing that the word is not about is left alone.
          if (this.#call && !this.#aboutThisCall(change)) return;
          // The host's word ends the session whatever the peer still shows: the
          // call is let go of here so the next press opens a new one, and it
          // finishes its own hang-up behind.
          this.#releasePress();
          if (this.#call) {
            this.#status = LIVE_STATUS.IDLE;
            this.#speakers = SILENT;
            this.#rows = [];
            this.#endCall();
            this.#letGo();
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
   * The host's word that Luke is ending the call: once his goodbye has
   * played, the call is hung up exactly as the panel's stop hangs it up, so
   * the close, the record, and the view are the developer's own stop, and
   * the strip says Luke ended it. A Luke still quiet when the word comes is
   * given `LUKE_ENDING_BOUNDS.START_MS` to begin, and a goodbye that does not
   * begin by then was over before the word. The developer speaking before it is over wins, and so
   * does Luke still talking past `LUKE_ENDING_BOUNDS`: either leaves the call
   * up. A second word while one is waiting adds nothing. The wait is a fiber
   * of its own, detached from the subscription that told it, on that
   * fiber's clock.
   */
  #lukeEnds(change: VoiceLiveSessionChanged): Effect.Effect<void> {
    return Effect.suspend(() => {
      const call = this.#call;
      if (call === undefined || !this.#aboutThisCall(change) || this.#lukeEnding !== undefined) {
        return Effect.void;
      }
      const ending: LukeEnding = {
        call,
        developerWords: developerWordsOf(this.#rows),
        spoke: this.#status === LIVE_STATUS.SPEAKING,
        played: Deferred.makeUnsafe<boolean>(),
      };
      this.#lukeEnding = ending;
      return Effect.asVoid(
        Effect.forkDetach(this.#hangUpAfterGoodbye(ending), { startImmediately: true }),
      );
    });
  }

  #hangUpAfterGoodbye(ending: LukeEnding): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (!ending.spoke) {
        yield* Effect.sleep(Duration.millis(LUKE_ENDING_BOUNDS.START_MS));
        if (!ending.spoke) Deferred.doneUnsafe(ending.played, Exit.succeed(true));
      }
      const played = yield* Effect.timeoutOption(
        Deferred.await(ending.played),
        Duration.millis(LUKE_ENDING_BOUNDS.PLAYBACK_MS),
      );
      if (this.#lukeEnding !== ending) return;
      this.#lukeEnding = undefined;
      if (Option.isNone(played) || !played.value || this.#call !== ending.call) return;
      // Set before the stop, which lets the call go at once and reports the view with it.
      this.#lukeEndedCall = this.#callTranscript?.voiceSessionId;
      yield* this.stopCall();
    });
  }

  /** What Luke's ending hears of the call it is about: his goodbye over, or the developer speaking over it. */
  #heardDuringEnding(call: LiveVoiceCall): void {
    const ending = this.#lukeEnding;
    if (ending === undefined || ending.call !== call) return;
    if (developerWordsOf(this.#rows) !== ending.developerWords) {
      Deferred.doneUnsafe(ending.played, Exit.succeed(false));
    } else if (this.#status === LIVE_STATUS.SPEAKING) {
      ending.spoke = true;
    } else if (ending.spoke) {
      Deferred.doneUnsafe(ending.played, Exit.succeed(true));
    }
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
      this.#letGo();
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
      this.#opening = undefined;
      this.#ending = undefined;
      this.#status = LIVE_STATUS.IDLE;
      this.#speakers = SILENT;
      this.#rows = [];
      this.#talkOpening = false;
      this.#letGo();
      this.#recomposeCaptions();
      this.#touch();
      return fiber ? Effect.asVoid(Fiber.interrupt(fiber)) : Effect.void;
    });
  }

  /**
   * A task call's press is a toggle that stands for minutes, so it ends
   * with the call: nothing after it (the talk key's release) reads it as the
   * developer still wanting to be heard.
   */
  #releasePress(): void {
    this.#pressHeld = false;
  }

  /**
   * Signals the standing call's lifecycle fiber to end, which releases it by
   * closing it exactly once. A call still held through its close is marked
   * closing, so a press meanwhile waits for it to be let go of.
   */
  #endCall(): void {
    const ending = this.#ending;
    this.#ending = undefined;
    if (!ending) return;
    if (this.#call !== undefined) this.#closing ??= Deferred.makeUnsafe<void>();
    Deferred.doneUnsafe(ending, Exit.void);
  }

  /**
   * Waits out a call the host is closing, answering whether there was one.
   * A press waits here, before it marks itself held, because the closing
   * call's end releases whatever press stood when it went.
   */
  #outlastClosing(): Effect.Effect<boolean> {
    return Effect.suspend(() => {
      const closing = this.#closing;
      return closing ? Effect.as(Deferred.await(closing), true) : Effect.succeed(false);
    });
  }

  /**
   * Lets go of the held call, so the next press opens a new one, and frees a
   * press waiting on its close. Note that the freed press resumes on this
   * very stack, so a caller lets go last, once its own state is settled.
   */
  #letGo(): void {
    this.#call = undefined;
    this.#lukeEnding = undefined;
    this.#speakerMuted = false;
    const closing = this.#closing;
    this.#closing = undefined;
    if (closing) Deferred.doneUnsafe(closing, Exit.void);
  }

  /**
   * The session standing or coming up, or a new one opened now. One opening
   * at a time: a second ask while the first is still negotiating waits for
   * it rather than offering the host a second peer. A call the host is
   * closing is no session to speak into: the ask waits until it is let go
   * of, then opens the next.
   */
  #ensureSession(taskId: string): Effect.Effect<LiveVoiceCall | undefined> {
    return Effect.gen({ self: this }, function* () {
      yield* this.#outlastClosing();
      // A stop frees a press waiting on a closing call, and a stopped orchestrator opens nothing.
      if (this.#stopped) return undefined;
      if (this.#call?.standing) return this.#call;
      const negotiating = this.#opening;
      if (negotiating) return yield* Deferred.await(negotiating);
      const opened = Deferred.makeUnsafe<LiveVoiceCall | undefined>();
      this.#opening = opened;
      this.#callTask = taskId;
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
        Effect.scoped(this.#lifecycleEffect(call, taskId, opened)),
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
    taskId: string,
    opened: Deferred.Deferred<LiveVoiceCall | undefined>,
  ): Effect.Effect<void, never, Scope.Scope> {
    return Effect.gen({ self: this }, function* () {
      const standing = yield* Effect.acquireRelease(call.open({ taskId }), () => call.close());
      if (this.#opening === opened) this.#opening = undefined;
      if (!standing) {
        this.#talkOpening = false;
        if (this.#call === call) this.#letGo();
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
    this.#heardDuringEnding(call);
    if (status === LIVE_STATUS.IDLE || status === LIVE_STATUS.FAILED) {
      this.#rows = [];
      this.#releasePress();
      this.#endCall();
      this.#letGo();
    }
    this.#recomposeCaptions();
    this.#touch();
  }

  #onCaptions(call: LiveVoiceCall, rows: readonly LiveCaptionRow[]): void {
    if (this.#call !== call) return;
    this.#rows = rows;
    this.#heardDuringEnding(call);
    this.#recomposeCaptions();
    this.#touch();
  }

  /**
   * The captions as the panel draws them: Luke's words under the housing
   * while he speaks and there is a reason to read them, the developer's own
   * words while they are still being said and the captions preference asks
   * for them. A silent output, or a speaker muted, is a reason to
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
      (this.#surroundings.captionsEnabled ||
        this.#surroundings.outputSilent ||
        this.#speakerMuted) &&
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
    const nextTranscript = callTranscriptOf(this.#rows);
    if (!sameTranscript(this.#callTranscript, nextTranscript)) {
      this.#callTranscript = nextTranscript;
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
      callTaskId: this.#call === undefined ? undefined : this.#callTask,
      callTranscript: this.#call === undefined ? undefined : this.#callTranscript,
      lukeEndedCall: this.#lukeEndedCall,
      speakerMuted: this.#speakerMuted,
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

/** The call's rows as its transcript so far; none before its first row. */
function callTranscriptOf(rows: readonly LiveCaptionRow[]): LiveCallTranscript | undefined {
  const [first] = rows;
  if (first === undefined) return undefined;
  return {
    voiceSessionId: first.voiceSessionId,
    lines: rows.map((row) => ({
      rowId: row.rowId,
      speaker: SPEAKER_OF_KIND[row.entry.kind],
      words: row.entry.words,
      startMs: row.startMs,
      endMs: row.endMs,
    })),
  };
}

/** Note that a row settling moves no line, so it is not reported as a change. */
function sameTranscript(
  left: LiveCallTranscript | undefined,
  right: LiveCallTranscript | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.voiceSessionId !== right.voiceSessionId) return false;
  if (left.lines.length !== right.lines.length) return false;
  return left.lines.every((line, index) => {
    const other = right.lines[index];
    return (
      other !== undefined &&
      line.rowId === other.rowId &&
      line.speaker === other.speaker &&
      line.words === other.words &&
      line.startMs === other.startMs &&
      line.endMs === other.endMs
    );
  });
}
