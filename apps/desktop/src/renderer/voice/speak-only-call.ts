import {
  ARRIVAL_SPEECH_KIND,
  arrivalSpeechEvents,
  briefingSpeechEvents,
  CALENDAR_ONBOARDING_SPEECH_KIND,
  calendarOnboardingSpeechEvents,
  type IntroductionLine,
  introductionSpeechEvents,
  outputSpeedUpdateEvents,
  type ParsedRealtimeServerEvent,
  type ProactiveSpeechTurn,
  REALTIME_SERVER_EVENT,
  REALTIME_STATUS,
  type RealtimeStatus,
  realtimeSessionConfig,
} from "@sidecar/realtime";
import { ACT_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { voiceExchangeActive } from "#shared/messages/voice-view";
import type { BuiltRealtimeSessionConfig, SdkToolCallDetails } from "./agents-realtime-transport";
import { CaptionStrip, REPLY_KIND, type ReplyKind } from "./captions";
import { type InterruptedSpan, Interruption } from "./interruption";
import { RealtimeCall, type RealtimeCallOptions, type TeardownStep } from "./realtime-call";

/**
 * How long a finished generation may go on playing before the turn is ended
 * anyway. It is a backstop for a reply that produced no audio at all — or one
 * whose audio drained while its `response.done` never arrived — not the
 * normal path: a spoken reply ends when it goes quiet.
 */
export const REALTIME_SETTLE_TIMEOUT_MS = 20_000;

/**
 * How long a turn that asked the brain may wait for the answer and the reply
 * voicing it. A brain turn reads transcripts and may act before it answers,
 * so the ordinary settle backstop is far too short for it; the main process's
 * own wait answers a turn the brain has not finished with "still working",
 * and this is the backstop under that.
 */
export const BRAIN_ASK_SETTLE_TIMEOUT_MS = 60_000;

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
 * What a call Luke opens for himself declares at the API. The empty tool list
 * and the choice that can pick nothing from it are the whole of `CLAUDE.md`'s
 * "carries no tools": the announcer is handed this type, and there is no
 * other document a {@link SpeakOnlyCall} can be configured with.
 */
export const SPEAK_ONLY_SESSION_CONFIG = {
  tools: [],
  tool_choice: "none",
} as const satisfies Pick<BuiltRealtimeSessionConfig, "tools" | "tool_choice">;

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

/** One finished reply as the server rendered it, calls and all. */
export type ResponseDoneEvent = Extract<
  ParsedRealtimeServerEvent,
  { type: typeof REALTIME_SERVER_EVENT.RESPONSE_DONE }
>;

export interface SpeakOnlyCallOptions extends RealtimeCallOptions {
  /** The voice and the pace the call is configured at, read at each handshake. */
  voice?: () => { voice?: string; speed?: number };
  /**
   * The words Luke is currently speaking, growing as they are generated, or
   * undefined once there is nothing being spoken. Each entry is one response's
   * words: a turn that speaks twice — a sentence before a tool call and the
   * outcome after it, or a reply the model split into two messages — hands
   * over both, oldest first, so the surface can stack them apart instead of
   * running two sentences together. The call owns the whole lifecycle —
   * the captions clear when the reply ends, is cut off, or the call closes —
   * so the caller only ever draws what it is handed. `kind` says whether the
   * words are a briefing or a reply to the brain's answer, living exactly as
   * long as that reply; a reply the brain was not asked for carries none.
   */
  onCaption(texts: readonly string[] | undefined, kind: ReplyKind | undefined): void;
  /**
   * The words a reply leaves behind at the moment it ends — finished, talked
   * over, or the call closing under it, whichever came. `kind` says whether
   * the words were a briefing or a reply, so History records each as itself.
   * The words were already spoken toward the room (the caption runs a little
   * ahead of the audio, so a cut reply hands over slightly more than was
   * heard); the caller records them so the thread survives the call. A reply
   * voicing a brain run's end names that run: its words already stand in the
   * thread, written by the main process from the record, and the caller
   * records nothing for it. Each reply carries its own, so two overlapping —
   * one cut off by the next — can never trade attributions.
   */
  onReplyEnded?(texts: readonly string[], kind: ReplyKind | undefined, runId?: string): void;
  /**
   * A reply concluding, words or none. `onReplyEnded` hands over only words
   * that exist, so a reply the server failed or answered without a transcript
   * ends without it — and a caller sequencing on endings alone (the
   * introduction's scripted beats) would wait forever on one. This fires once
   * per concluded reply, from the same funnel every ending passes, the settle
   * backstop included.
   */
  onReplySettled?(): void;
}

/**
 * A call with no capture device and no tools: it says one turn and reports
 * what became of it.
 *
 * This is the call Luke opens for himself to read a notice out. The guarantee
 * `CLAUDE.md` states for a briefing — no microphone track, no tools — is this
 * type rather than a flag on a wider one: there is no field here to hold a
 * device, no member that could open one, and the session document is the
 * ordinary one overlaid with {@link SPEAK_ONLY_SESSION_CONFIG}, so nothing
 * said, heard, or read out on such a call can become an act.
 *
 * Everything about turn-taking that needs no microphone lives here too:
 * starting a reply, ending it, cutting it off, the caption it draws, and the
 * pace it is spoken at.
 */
export class SpeakOnlyCall<
  Options extends SpeakOnlyCallOptions = SpeakOnlyCallOptions,
> extends RealtimeCall<Options> {
  get microphoneCall(): boolean {
    return false;
  }
  /** Cutting a reply off, and the refusals that answer the cut. */
  #interruption = new Interruption({
    send: (events) => this.send(events),
    onError: (message) => this.options.onError(message),
  });
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
   * The reply whose audio ran out while the server still owed the turn its
   * `done`, or false while audio is still owed. The ending the drain would
   * have made is remembered here and lands when the `done` arrives, so the
   * turn still closes on the second of the two events whichever order they
   * come in. The drain keeps the name of the response the server said
   * drained, because it can be an old reply's arriving late — a tool turn's
   * spoken half empties after its follow-up was already asked for — and a
   * stale drain read as the current reply's would end the follow-up under
   * Luke's own voice, or skip the trim a stop mid-follow-up still owes the
   * record.
   */
  #audioDrained: { responseId: string | undefined } | false = false;
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
  /** The words of the reply under way, and whose they are. */
  #captions = new CaptionStrip({
    onCaption: (texts, kind) => this.options.onCaption(texts, kind),
    onReplyEnded: (texts, kind, runId) => this.options.onReplyEnded?.(texts, kind, runId),
  });
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
   * The ordinary session document with the speak-only overlay last, so the
   * voice and the pace still answer to the developer's settings while the
   * tools cannot be put back by anything a caller supplies.
   */
  protected sessionConfig(model: string): BuiltRealtimeSessionConfig {
    return {
      ...realtimeSessionConfig({ model, ...this.options.voice?.() }),
      ...SPEAK_ONLY_SESSION_CONFIG,
    };
  }

  /** A speak-only call declared no tools, so any call reaching here is malformed. */
  protected executeTool(
    _name: string,
    _details: SdkToolCallDetails | undefined,
  ): Promise<WireRecord> {
    return Promise.resolve({
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "This call carries no tools.",
    });
  }

  /**
   * Voices one turn the main process decided — a briefing the brain handed
   * the voice, or a scripted onboarding beat — reporting whether it could. A
   * refusal is not a loss: the queue keeps the turn and tries again on its
   * own clock, and a briefing that waits too long ages out rather than being
   * read out as though it just happened.
   */
  speak(speech: ProactiveSpeechTurn): boolean {
    const arrival = speech.kind === ARRIVAL_SPEECH_KIND;
    const onboarding = speech.kind === CALENDAR_ONBOARDING_SPEECH_KIND;
    const events = arrival
      ? arrivalSpeechEvents(speech)
      : onboarding
        ? calendarOnboardingSpeechEvents()
        : briefingSpeechEvents(speech);
    if (events.length === 0 || !this.isConnected || voiceExchangeActive(this.status)) return false;
    this.startResponse(events);
    // Only a briefing's words are the brain's, and the kind is set after the
    // start, which clears the last reply's: the briefing's reply is the one
    // under way until it ends. An onboarding beat takes no kind and no
    // caption subject — it speaks about no observed session, so no notice may
    // stand under the housing claiming it does.
    if (!arrival && !onboarding) this.setCaptionKind(REPLY_KIND.BRIEFING);
    return true;
  }

  /**
   * Voices one scripted beat of the introduction, reporting whether it could.
   * The beat's direction is fixed by the build and its data already bounded;
   * the turn opens with `tool_choice: "none"` on a session that declared no
   * tools, so nothing about it can arm an act. No caption subject is set —
   * the introduction speaks about no observed session.
   */
  speakIntroduction(line: IntroductionLine): boolean {
    const events = introductionSpeechEvents(line);
    if (events.length === 0 || !this.isConnected || voiceExchangeActive(this.status)) return false;
    this.startResponse(events);
    return true;
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
    if (this.status !== REALTIME_STATUS.RESPONDING) return false;
    this.interruptReply();
    // A stop opens no reply of its own, so the turn moves on here: a tool
    // follow-up still awaiting its write finds an epoch that is no longer its
    // own and stands down, rather than speaking over the quiet just asked for.
    this.#turnEpoch += 1;
    this.setStatus(REALTIME_STATUS.READY);
    return true;
  }

  /**
   * The meter's report of whether Luke is audible. The meter calls quiet after
   * a fifth of a second, which is shorter than the pause between two sentences,
   * so a turn that ended on that edge would take the meter down mid-reply. The
   * call waits for a silence longer than speech leaves behind, and ignores
   * quiet that is not Luke's to answer for.
   */
  reportRemoteAudioLevel(active: boolean): void {
    this.#clearQuietTimer();
    if (this.status !== REALTIME_STATUS.RESPONDING) return;
    if (active) {
      this.#heardLuke = true;
      this.reportRemoteAudioActive();
      return;
    }
    this.#quietTimer = setTimeout(() => {
      this.#quietTimer = undefined;
      // Only Luke's own silence ends Luke's turn.
      if (!quietIsLukesOwn({ status: this.status, heardLuke: this.#heardLuke })) return;
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
    this.#audibleSince ??= this.now();
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
    if (this.status === REALTIME_STATUS.RESPONDING) {
      this.#pendingSpeed = speed;
      return;
    }
    this.#pendingSpeed = undefined;
    this.send(outputSpeedUpdateEvents(speed));
  }

  protected override onChannelOpen(): void {
    // A pace changed during the handshake could not be sent then, and the
    // credential this call answered may have been minted before the change.
    this.#flushPendingSpeed();
  }

  protected override onCallLost(): void {
    if (this.#captions.kinded) this.#captions.discard();
  }

  protected override onTeardown(step: TeardownStep): void {
    // The reply's last words are handed over before the stores empty: the
    // handover's write-back re-enters this call, and landing it here means
    // the roster it renders against still stands — and everything it wrote is
    // cleared with the rest below, so a retired call keeps nothing pending.
    step(() => this.#captions.end());
    // What was said on the call goes with the call. The pending answers go too:
    // they were built from stores this teardown is emptying, and the next call
    // is filled from the app afresh before it takes a turn.
    this.#interruption.reset();
    this.#responseOutstanding = false;
    this.#audioDrained = false;
    this.onTurnBoundary();
    this.#generationDone = false;
    this.#remoteQuiet = false;
    this.#heardLuke = false;
    this.#clearQuietTimer();
    // The next call is minted at the stored pace, so nothing is owed to it.
    this.#pendingSpeed = undefined;
    this.#responseItemId = undefined;
    this.#activeResponseId = undefined;
    this.#audibleSince = undefined;
    // Learned about this call, so it does not outlive it.
    this.#audioEndingsReported = false;
    this.clearSettleTimer();
  }

  protected handleEvent(event: ParsedRealtimeServerEvent): void {
    switch (event.type) {
      case REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED:
        if (event.itemId) this.#responseItemId = event.itemId;
        return;
      case REALTIME_SERVER_EVENT.RESPONSE_CREATED:
        // Only a reply the call is still waiting on may be adopted. A
        // confirmation arriving after the developer stopped or took the turn is
        // the cancelled reply's own, landing late — the stop raced the server's
        // confirmation — and adopting it would re-open the track over the quiet
        // just asked for, and let its finished form read as the current reply's.
        if (this.status !== REALTIME_STATUS.RESPONDING) return;
        // The reply being asked for is under way, so anything arriving from here
        // belongs to it rather than to the one it replaced. Its name is what a
        // `response.done` must present to be read as this reply's: the channel
        // is ordered, so a cancelled reply's `done` lands before this
        // confirmation and finds nothing to match.
        if (event.responseId) {
          this.#activeResponseId = event.responseId;
          this.onResponseCreated(event.responseId);
        }
        this.unsilenceLuke();
        return;
      case REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA:
        // Only the reply being spoken may write the caption. A cancelled reply's
        // transcript keeps arriving after the interrupt that cleared it — the
        // server had already produced it — and without this check a late piece
        // would draw the words Luke was just stopped from saying, or splice them
        // onto the next reply's.
        if (event.itemId === this.#responseItemId && event.delta) {
          this.#captions.append(event.itemId, event.delta);
        }
        return;
      case REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE:
        // The server's own rendering of the whole item, which the deltas only
        // approximate: a delta lost to the channel would otherwise leave a hole
        // in the sentence for as long as it stayed up. It lands on the segment
        // the item's deltas built — even one the turn has already moved past —
        // and a cancelled reply's `done`, the likeliest straggler of all, finds
        // its segments cleared and writes nothing.
        if (event.transcript) {
          this.#captions.settle(event.itemId, event.transcript);
        }
        return;
      case REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STARTED:
        // Audio flowing again says the drain the turn remembered was the
        // pause between two things the reply had to say, not its ending.
        // Left standing, the stale drain lets the `done` end the turn under
        // the second half — the face and the duck released while Luke is
        // still speaking. Only a resume that is attributably the current
        // reply's own — or unnamed, the same reading the drain gets — may
        // un-remember it. The backstop a drain armed is restarted rather
        // than kept or cleared: kept, its clock ran from the pause and cuts
        // a resumed half that outlives it; cleared, a `done` that never
        // comes would hold the turn open with nothing left to end it.
        if (event.responseId !== undefined && event.responseId !== this.#activeResponseId) {
          return;
        }
        this.#audioDrained = false;
        if (this.#settleTimer !== undefined) {
          this.clearSettleTimer();
          this.armSettleTimer();
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
        if (this.#responseOutstanding || this.turnHolds) {
          this.#audioDrained = { responseId: event.responseId };
          this.armSettleTimer();
          return;
        }
        // The reply is over because the server says the audio ran out, not
        // because this end guessed from a stretch of quiet. A pause between two
        // sentences is quiet too, and guessing ended the turn in the middle of
        // one — the meter and the face went with it while Luke talked on.
        this.#finishResponse();
        return;
      case REALTIME_SERVER_EVENT.RESPONSE_DONE:
        this.#responseDone(event);
        return;
      case REALTIME_SERVER_EVENT.ERROR:
        // Only Luke's own trim can draw a past-the-end refusal, the service
        // clamps and truncates anyway, and it names no event this could match
        // it by — `error.event_id` is null on the wire. Recognized by its
        // sentence and never shown.
        if (Interruption.pastAudioEnd(event.message)) return;
        if (this.#interruption.error(event)) return;
        this.options.onError(event.message);
        // An error can arrive *instead of* `response.done` — an empty push-to-talk
        // commit is the common case — which would otherwise leave the call
        // stuck in `responding` and unable to take another turn. But only a
        // reply the server never confirmed ends this way: behind a confirmed
        // one an error is an aside — the reply is still the server's, its own
        // `done` still ends the turn, and ending it here would offer READY
        // while the conversation still holds an active response. The settle
        // backstop covers a `done` that never comes.
        if (this.#activeResponseId !== undefined) {
          this.armSettleTimer();
          return;
        }
        this.#finishResponse();
    }
  }

  #responseDone(event: ResponseDoneEvent): void {
    // Whether this is the reply now under way, or the finished form of one
    // the developer already talked or typed over. The server had completed
    // the old reply before the cancel landed — it generates ahead of the
    // room — so its `done` still arrives, after the interrupt has already
    // opened a new turn. Nothing of it may reach the brain as that turn's
    // ask or end that turn early: its calls are answered refused so the
    // model is not left waiting, and everything else about it is ignored.
    const fresh = event.responseId === this.#activeResponseId;
    // Whatever this reply turns out to be below, the server has concluded
    // it: from here the conversation can take a new `response.create`.
    if (fresh) this.#responseOutstanding = false;
    // A reply that asked for tool calls has not finished talking: a call that
    // can answer them says so, and the turn stays open for the reply to
    // resume over their outcomes rather than ending on one only half made.
    // This call declared no tools, so such a reply reads as any other.
    if (event.calls.length > 0) {
      if (this.replyResumes(event, fresh)) return;
      // The spoken half's audio already drained — its ending deferred to
      // this `done`, and a reply owing no follow-up ends here, exactly
      // as the drain would have ended it.
      if (fresh && this.#currentReplyDrained()) this.#finishResponse();
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
    if (this.#currentReplyDrained()) {
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
    this.armSettleTimer();
  }

  /** The reply the server just confirmed, for a call that answers tools on it. */
  protected onResponseCreated(_responseId: string): void {}

  /**
   * Whether the reply whose generation just finished has more to say — so the
   * turn holds rather than ending here. Nothing a speak-only call is sent can
   * resume: its replies end where their generation does.
   */
  protected replyResumes(_event: ResponseDoneEvent, _fresh: boolean): boolean {
    return false;
  }

  /** Whether the turn is still owed something, so the audio draining is not an ending. */
  protected get turnHolds(): boolean {
    return false;
  }

  /**
   * A turn boundary crossed — a new reply, a finish, an interrupt, the
   * teardown — where whatever the last turn left outstanding is spent.
   */
  protected onTurnBoundary(): void {}

  /** The turn now under way, as the boundary a late write is checked against. */
  protected get turnEpoch(): number {
    return this.#turnEpoch;
  }

  protected bumpTurnEpoch(): void {
    this.#turnEpoch += 1;
  }

  /** Marks whose words the reply under way is speaking, and redraws. */
  protected setCaptionKind(kind: ReplyKind | undefined, runId?: string): void {
    this.#captions.mark(kind, runId);
  }

  protected startResponse(
    events: readonly WireRecord[],
    { keepCaption = false }: { keepCaption?: boolean } = {},
  ): void {
    // A pace still waiting from the last reply lands here, ahead of the
    // request: the channel is ordered and no response is in progress — a
    // cancel for the reply being talked over was sent before this — so the
    // reply about to be asked for is already spoken at the new pace.
    this.#flushPendingSpeed();
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
    this.onTurnBoundary();
    this.#clearQuietTimer();
    this.#responseItemId = undefined;
    // Nothing has been confirmed for this turn yet: whatever `response.done`
    // arrives before the server confirms this reply belongs to a superseded
    // one, and must find no active response to match.
    this.#activeResponseId = undefined;
    this.#audibleSince = undefined;
    // A new turn: any brain follow-up still awaiting from the last turn will
    // see this and stand down.
    this.#turnEpoch += 1;
    // A new turn starts with a clean strip; a follow-up continuing the same
    // exchange keeps the words just said, and its own words stack under them.
    if (!keepCaption) this.#captions.end();
    this.clearSettleTimer();
    this.onResponseStarted(events);
    this.send(events);
    this.setStatus(REALTIME_STATUS.RESPONDING);
  }

  /** The events a reply is being opened with, before they are sent. */
  protected onResponseStarted(_events: readonly WireRecord[]): void {}

  /** Ends the turn once the reply is done, so the next one can start. */
  #finishResponse(): void {
    this.#generationDone = false;
    // However the turn ended — the settle backstop included — whatever the
    // server still owed it is treated as concluded, so a `done` that never
    // comes cannot leave every later reply refused against it.
    this.#responseOutstanding = false;
    this.#audioDrained = false;
    this.onTurnBoundary();
    // The turn is over, and everything of it is spent — a write still in
    // flight from it finds this boundary and stands down, rather than opening
    // its follow-up out of a silence already declared.
    this.#turnEpoch += 1;
    // No reply is current once the turn is over: a `done` that outlives the
    // settle backstop reads as a stranger's, and nothing of it reaches the
    // turn the developer was already told had ended.
    this.#activeResponseId = undefined;
    // The caption is of speech, and the speech is over. Whatever ended the
    // reply — the audio draining, an error, the settle timer — the words leave
    // with the meter and the face rather than lingering under a quiet capsule.
    this.#captions.end();
    // Whatever ended the reply — an error, the settle timer, Luke simply
    // stopping — the next one has to be audible. Without this a reply that
    // failed before it started would leave Luke silenced with nothing to
    // un-silence him.
    this.unsilenceLuke();
    this.#clearQuietTimer();
    this.clearSettleTimer();
    this.#heardLuke = false;
    // The reply is over, so the API is between turns — the one moment it
    // accepts a pace change that arrived while Luke was speaking.
    this.#flushPendingSpeed();
    if (this.status === REALTIME_STATUS.RESPONDING) this.setStatus(REALTIME_STATUS.READY);
    this.options.onReplySettled?.();
  }

  /**
   * Cuts off the reply under way so a new turn does not land on top of it.
   */
  protected interruptReply(): void {
    // Stop the words that are already on their way, then stop more being
    // made. A disabled track drops what is buffered rather than playing it
    // out, so the cut-off is immediate rather than eventual.
    this.silenceLuke();
    // The caption is cut with the audio, but handed over first. Generated text
    // runs slightly ahead of playback; History keeps that available transcript
    // so an interrupted announcement can still be recalled.
    this.#captions.end();
    this.#interruption.cut({
      cancelGeneration: this.#responseOutstanding,
      truncate: this.#interruptedSpan(),
    });
    // The trim was this reply's last word: forgetting its item here is what
    // stops the transcript still trailing in — the server had produced it
    // before the cancel landed — from ever matching the caption again.
    this.#responseItemId = undefined;
    // And forgetting its response is what stops its finished form — cancelled
    // or not, the server may already have completed it — from being read as
    // the current turn's: a `response.done` that matches nothing can neither
    // act with the new turn's arming nor end the new turn early.
    this.#activeResponseId = undefined;
    // The cancel concludes the reply at the server before anything sent after
    // it is read — the channel is ordered — so nothing is outstanding from
    // here, and whatever `done` the cancelled reply still sends matches no
    // active response above.
    this.#responseOutstanding = false;
    this.#audioDrained = false;
    this.onTurnBoundary();
    this.#generationDone = false;
    this.#remoteQuiet = false;
    this.#heardLuke = false;
    this.#clearQuietTimer();
    this.clearSettleTimer();
  }

  /**
   * What to trim the cut-off reply to, if there is anything to trim. Nothing
   * heard means nothing to correct — a reply interrupted in the gap before its
   * first word left no impression to undo — and a reply whose audio already
   * ran out was heard whole: the record needs no correction, and the wall
   * clock has been counting past the audio's end for as long as the turn has
   * held for its `done`, so a trim measured from it would ask past the end
   * and be refused.
   */
  #interruptedSpan(): InterruptedSpan | undefined {
    const itemId = this.#responseItemId;
    const audibleSince = this.#audibleSince;
    if (!itemId || audibleSince === undefined || this.#currentReplyDrained()) return undefined;
    return { itemId, audioEndMs: this.now() - audibleSince };
  }

  /**
   * Whether the reply now under way has played out every word it generated.
   * Only a drain that is attributably this reply's own says so: an old
   * reply's late drain speaks for audio the current reply never played. A
   * drain that named no reply keeps the old reading — it is nearly always
   * the current one's, and reading it as another's would hold the turn to
   * the settle backstop.
   */
  #currentReplyDrained(): boolean {
    if (this.#audioDrained === false) return false;
    const { responseId } = this.#audioDrained;
    return responseId === undefined || responseId === this.#activeResponseId;
  }

  /** Starts the backstop for a reply whose proper ending never arrives. */
  protected armSettleTimer(delayMs: number = REALTIME_SETTLE_TIMEOUT_MS): void {
    this.#settleTimer ??= setTimeout(() => {
      this.#settleTimer = undefined;
      this.#finishResponse();
    }, delayMs);
  }

  protected clearSettleTimer(): void {
    if (this.#settleTimer === undefined) return;
    clearTimeout(this.#settleTimer);
    this.#settleTimer = undefined;
  }

  #clearQuietTimer(): void {
    if (this.#quietTimer === undefined) return;
    clearTimeout(this.#quietTimer);
    this.#quietTimer = undefined;
  }

  /** Sends the pace change that waited out a reply, once nothing is speaking. */
  #flushPendingSpeed(): void {
    const speed = this.#pendingSpeed;
    if (speed === undefined) return;
    this.#pendingSpeed = undefined;
    this.send(outputSpeedUpdateEvents(speed));
  }
}
