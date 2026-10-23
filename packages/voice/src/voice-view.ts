import { LIVE_STATUS, type LiveStatus, TRANSCRIPT_SPEAKER } from "@luke/live";
import {
  isOptionalWireString,
  isRecord,
  isWireBoolean,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@luke/wire";
import { Schema } from "effect";

/**
 * What a panel needs to draw the live conversation and cannot derive or read
 * elsewhere. The voice window reports the whole snapshot on every edge and the
 * main process forwards it unchanged to every panel, so each display draws the
 * same voice state at the same instant and holds nothing it cannot lose.
 */
export interface VoiceSpeakers {
  /** Whether the developer's microphone is being heard. */
  listening: boolean;
  /** Whether Luke is audible on the remote track. */
  lukeSpeaking: boolean;
}

/** One line said on the standing call, as the voice window's ledger groups it, with its span in milliseconds into the call. */
const voiceCallLineSchema = Schema.Struct({
  rowId: Schema.String,
  speaker: Schema.Literals(Object.values(TRANSCRIPT_SPEAKER)),
  words: Schema.String,
  startMs: Schema.Number,
  endMs: Schema.Number,
});

type VoiceCallLine = typeof voiceCallLineSchema.Type;

/**
 * Everything said on the standing call so far: the store's id for its
 * session, which the task's stored transcript names the call by once it
 * ends, and its lines in the order they opened.
 *
 * It is not part of {@link VoiceView}, because it grows for the whole call
 * and the view is reported at the heard lines' rate. It is the app document's
 * `callTranscript`, beside the voice slice: the voice window reports only a
 * {@link VoiceCallTranscriptChange} with each view, main splices it in with
 * {@link withCallTranscriptChange}, a panel is handed only what moved in it
 * since the last it was handed ({@link callTranscriptChangeBetween}), and a
 * panel opened mid-call reads the whole of it from the document. Its one reader is the agent tab's live
 * transcript (`transcript-model.ts`'s `heardCalls`), which matches it to
 * `view.call`'s agent; it is none while no call stands or before its first line.
 */
export interface VoiceCallTranscript {
  readonly voiceSessionId: string | undefined;
  readonly lines: readonly VoiceCallLine[];
}

/**
 * What moved in the standing call's transcript since the voice window last
 * reported it: every line from index `from` on, as they stand now, and the
 * lines before it unchanged. A line said is carried once, and then only
 * while its words still grow; a call gone is the change from 0 to no lines.
 * Applied twice it is applied once, so a report heard again changes nothing.
 */
const voiceCallTranscriptChangeSchema = Schema.Struct({
  voiceSessionId: Schema.UndefinedOr(Schema.String),
  from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  lines: Schema.Array(voiceCallLineSchema),
});

export type VoiceCallTranscriptChange = typeof voiceCallTranscriptChangeSchema.Type;

const isTranscriptChange = Schema.is(voiceCallTranscriptChangeSchema);

/** Whether a value crossing from the voice window is a transcript change, read by its one Schema. */
export function isVoiceCallTranscriptChange(value: UnparsedWireValue): boolean {
  return isTranscriptChange(value);
}

/**
 * What a call is about: the agent it speaks into, and the task that agent is
 * on where it is on one, none for an agent with no task. The call is keyed
 * by its agent, and the host creates it only into an agent the account
 * reaches on eve, whose own task is the one named. One call stands on a Mac
 * at a time, about one agent; calling another hangs it up first.
 */
export interface VoiceCallAbout {
  readonly agentId: string;
  readonly taskId?: string | undefined;
}

/** Whether two calls are about the same agent, and so are the same call to press for. */
export function sameCallAbout(
  left: VoiceCallAbout | undefined,
  right: VoiceCallAbout | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.taskId === right.taskId && left.agentId === right.agentId;
}

export interface VoiceView extends VoiceSpeakers {
  /**
   * The one claim the status names, which the media duck and the exchange
   * count read; who is actually being heard is the two flags
   * above, since a full-duplex session can carry both at once.
   */
  voiceStatus: LiveStatus;
  voiceError: string | undefined;
  voiceNotice: string | undefined;
  talkOpening: boolean;
  /** The agent the standing call speaks into, and its task where it has one; none for no call. */
  call: VoiceCallAbout | undefined;
  /** The store's id for the session of the last call Luke ended himself; none before he has. */
  lukeEndedCall: string | undefined;
  /** Whether Luke's voice is silenced on this Mac for the standing call, his words still streaming into the transcript; never while none stands. */
  speakerMuted: boolean;
}

/**
 * The asks a panel forwards to the main process for the voice window to carry
 * out. No press decides anything in the panel: the talk key never travels this
 * way, because the main process routes it to the voice window directly.
 */
export const VOICE_COMMAND = {
  STOP_SPEAKING: "stop-speaking",
  END_CALL: "end-call",
  /** The standing call's microphone muted, or heard again, whatever the panel has open. */
  TOGGLE_MICROPHONE: "toggle-microphone",
  /** Luke's voice silenced on this Mac for the call standing, and heard again; the session is told nothing. */
  MUTE_SPEAKER: "mute-speaker",
  UNMUTE_SPEAKER: "unmute-speaker",
  REQUEST_MICROPHONE_ACCESS: "request-microphone-access",
} as const;

export type VoiceCommand = (typeof VOICE_COMMAND)[keyof typeof VOICE_COMMAND];

/**
 * The voice at rest: what a panel draws before the voice window has reported
 * anything, and what the main process tells every panel when the voice
 * renderer dies, so no display keeps drawing an exchange that is gone.
 */
export const IDLE_VOICE_VIEW: VoiceView = {
  voiceStatus: LIVE_STATUS.IDLE,
  listening: false,
  lukeSpeaking: false,
  voiceError: undefined,
  voiceNotice: undefined,
  talkOpening: false,
  call: undefined,
  lukeEndedCall: undefined,
  speakerMuted: false,
};

/** The statuses of a call still in progress, the ones a call holds the panel open through. */
const CALL_IN_PROGRESS: ReadonlySet<LiveStatus> = new Set([
  LIVE_STATUS.CONNECTING,
  LIVE_STATUS.MUTED,
  LIVE_STATUS.LISTENING,
  LIVE_STATUS.SPEAKING,
]);

/**
 * Whether a call is in progress: the developer is talking with an agent,
 * whatever the panel shows. A call closing or failed is not in
 * progress. The panel's call bar, the mute chords, and the floating call
 * window all answer to it.
 */
export function callInProgress(view: Pick<VoiceView, "voiceStatus" | "call">): boolean {
  return view.call !== undefined && CALL_IN_PROGRESS.has(view.voiceStatus);
}

const LIVE_STATUSES: ReadonlySet<string> = new Set(Object.values(LIVE_STATUS));

function isLiveStatus(value: UnparsedWireValue): value is LiveStatus {
  return isWireString(value) && LIVE_STATUSES.has(value);
}

const VOICE_COMMANDS: ReadonlySet<string> = new Set(Object.values(VOICE_COMMAND));

export function isVoiceCommand(value: UnparsedWireValue): value is VoiceCommand {
  return isWireString(value) && VOICE_COMMANDS.has(value);
}

function isOptionalCallAbout(value: UnparsedWireValue): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      (value.taskId === undefined || isWireString(value.taskId)) &&
      isWireString(value.agentId))
  );
}

/**
 * The transcript held with a change applied: the lines before `from` kept
 * and the change's lines after them. A change about another session than
 * the one held starts over from its own lines, and no lines is no
 * transcript.
 */
export function withCallTranscriptChange(
  held: VoiceCallTranscript | undefined,
  change: VoiceCallTranscriptChange,
): VoiceCallTranscript | undefined {
  const kept =
    held === undefined || held.voiceSessionId !== change.voiceSessionId
      ? []
      : held.lines.slice(0, change.from);
  const lines = [...kept, ...change.lines];
  return lines.length === 0 ? undefined : { voiceSessionId: change.voiceSessionId, lines };
}

/**
 * What moved from `sent` to `next`, as the change that turns the one into the
 * other: the lines from the first that is not the line it was, and the empty
 * change from 0 for a call gone. A line keeps its object while it does not
 * move, so the walk is one comparison per line kept. None where nothing did.
 */
export function callTranscriptChangeBetween(
  sent: VoiceCallTranscript | undefined,
  next: VoiceCallTranscript | undefined,
): VoiceCallTranscriptChange | undefined {
  if (sent === next) return undefined;
  if (next === undefined) return { voiceSessionId: undefined, from: 0, lines: [] };
  const kept = sent !== undefined && sent.voiceSessionId === next.voiceSessionId ? sent.lines : [];
  let from = 0;
  while (from < kept.length && from < next.lines.length && kept[from] === next.lines[from]) {
    from += 1;
  }
  if (from === kept.length && from === next.lines.length) return undefined;
  return { voiceSessionId: next.voiceSessionId, from, lines: next.lines.slice(from) };
}

export function isVoiceView(value: UnparsedWireValue): value is VoiceView & WireRecord {
  if (!isRecord(value)) return false;
  if (!isLiveStatus(value.voiceStatus)) return false;
  if (!isOptionalWireString(value.voiceError) || !isOptionalWireString(value.voiceNotice))
    return false;
  if (!isWireBoolean(value.talkOpening)) return false;
  if (!isOptionalCallAbout(value.call)) return false;
  if (!isOptionalWireString(value.lukeEndedCall)) return false;
  if (!isWireBoolean(value.speakerMuted)) return false;
  return isWireBoolean(value.listening) && isWireBoolean(value.lukeSpeaking);
}
