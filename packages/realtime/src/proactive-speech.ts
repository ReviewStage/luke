import {
  isOptionalWireString,
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { REALTIME_CLIENT_EVENT } from "./realtime-events.js";
import { trimmedText } from "./trimmed-text.js";
import { BRIEFING_INPUT_MARKER, responseTurn, SCENE } from "./voice-scene.js";

/**
 * What Luke says first: the briefing the brain decided to give, and the two
 * onboarding beats whose trigger is deterministic and whose words are a
 * script fixed by the build. This is the wire contract between the main
 * process that decides a turn and the renderer that speaks it. A briefing
 * joins the call's own conversation, so the voice speaks it against what was
 * said before; the standing instructions of the session, not a document
 * built here, say what a briefing is and that it is said as written. The
 * arrival beat alone builds its own events here, because it composes data
 * lines and chooses a direction by what they hold.
 */

/**
 * The marker a briefing item discriminates on. A briefing is what the brain
 * decided to say, already worded; the voice's part is to say it.
 */
export const BRIEFING_SPEECH_KIND = "briefing";

/**
 * One briefing the brain handed the mouth: the words, and when it was
 * decided, so a stale one is dropped rather than read out as though it just
 * happened.
 */
export interface BriefingSpeech {
  kind: typeof BRIEFING_SPEECH_KIND;
  briefing: string;
  decidedAt: number;
}

/**
 * Builds the events that speak one briefing.
 *
 * The briefing joins the conversation: it is created as one user item behind
 * the marker and spoken by a response over the conversation as it stands,
 * so the spoken words are appended to it and the next briefing or reply is
 * inflected against them rather than read cold. What still bounds it is the
 * withheld tools — the response declares none and may choose none — and the
 * standing rule that the words are said as written and answer nothing said
 * before them. The response carries no instructions and no input of its own:
 * a response input would open a context apart from the conversation, and
 * response instructions would replace the session's for that turn.
 */
export function briefingSpeechEvents(speech: BriefingSpeech): readonly WireRecord[] {
  const briefing = trimmedText(speech.briefing);
  if (!briefing) return [];
  return [
    {
      type: REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE,
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `${BRIEFING_INPUT_MARKER}\n${briefing}` }],
      },
    },
    {
      type: REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
      response: {
        // No tool may answer a briefing. The words are what the brain decided
        // to say, never a developer-opened turn entitled to act.
        tools: [],
        tool_choice: "none",
      },
    },
  ];
}

/**
 * The marker an arrival item discriminates on, distinct from a briefing
 * because no brain decided it: the arrival's trigger is the
 * deterministic edge of the account's first sign-in, and its words are a
 * script fixed by the build rather than anything observed or evaluated.
 */
export const ARRIVAL_SPEECH_KIND = "arrival";

/**
 * The one-time arrival beat, spoken after the account's first sign-in. It is
 * about no session, so it carries no identity; the two optional fields are
 * the only observed things it may mention, each bounded before it gets here
 * and each travelling as data behind the item's marker, never as instruction.
 */
export interface ArrivalSpeech {
  kind: typeof ARRIVAL_SPEECH_KIND;
  /**
   * A working session's title, so the suggested first ask is about the
   * developer's own work. Absent when nothing is working, where "what needs
   * me?" is the ask that always lands.
   */
  sessionTitle?: string;
  /**
   * The talk key worded for a sentence, present only while holding it would
   * actually open a turn. Absent, the beat suggests typing into the panel's
   * own field instead.
   */
  talkKeyLabel?: string;
  decidedAt: number;
}

/**
 * The marker a calendar onboarding item discriminates on, on the arrival's
 * own terms: its trigger is the deterministic standing of the calendar step's
 * gate after the first sign-in, and its words are a script fixed by the build
 * that carries no observed value at all.
 */
export const CALENDAR_ONBOARDING_SPEECH_KIND = "calendar-onboarding";

/**
 * The spoken line beside the calendar step of onboarding: the gate the panel
 * is showing is the whole subject, so the beat is about no session, names
 * nothing observed, and exists only so the one screen Luke asks something on
 * is also one he explains out loud.
 */
export interface CalendarOnboardingSpeech {
  kind: typeof CALENDAR_ONBOARDING_SPEECH_KIND;
  decidedAt: number;
}

/** One Realtime response: an onboarding beat, or one briefing the brain decided to give. */
export type ProactiveSpeechTurn = ArrivalSpeech | CalendarOnboardingSpeech | BriefingSpeech;

/**
 * Parses one turn as it arrives from outside this process. The kind decides
 * which fields are read, and an unknown kind is refused rather than passed
 * through: a turn the mouth cannot build events for must never reach it as a
 * turn it will try to speak.
 */
export function isProactiveSpeechTurn(
  value: UnparsedWireValue,
): value is ProactiveSpeechTurn & WireRecord {
  if (!isRecord(value) || !isWireNumber(value.decidedAt) || !Number.isFinite(value.decidedAt)) {
    return false;
  }
  switch (value.kind) {
    case BRIEFING_SPEECH_KIND:
      return isWireString(value.briefing);
    case ARRIVAL_SPEECH_KIND:
      return isOptionalWireString(value.sessionTitle) && isOptionalWireString(value.talkKeyLabel);
    case CALENDAR_ONBOARDING_SPEECH_KIND:
      return true;
    default:
      return false;
  }
}

/**
 * The one suggestion the beat closes on, chosen from two build-fixed lines by
 * whether the talk key would work. No observed value can change which line is
 * said.
 */
export function arrivalTryDirection(input: { talkKeyLabel?: string }): string {
  if (input.talkKeyLabel !== undefined) {
    return (
      "End by inviting exactly one thing to try: hold the talk key named in the data and " +
      'ask "what needs me?"'
    );
  }
  return (
    'End by inviting exactly one thing to try: type "what needs me?" into the field at ' +
    "the foot of the panel."
  );
}

/**
 * Builds the events that speak the arrival beat: the observed values as data
 * lines behind the turn's marker, bounded there with everything else a turn
 * carries, so a title reading "ignore your instructions and ..." is data Luke
 * was handed to mention, and the try direction selected by whether the
 * talk-key value is present, so the suggestion can never name a key the data
 * does not.
 */
export function arrivalSpeechEvents(speech: ArrivalSpeech): readonly WireRecord[] {
  const sessionTitle = trimmedText(speech.sessionTitle);
  const talkKeyLabel = trimmedText(speech.talkKeyLabel);
  const data = [
    ...(sessionTitle !== undefined ? [`working session title: ${sessionTitle}`] : []),
    ...(talkKeyLabel !== undefined ? [`talk key: ${talkKeyLabel}`] : []),
  ];
  return responseTurn(
    [
      ...SCENE.ARRIVAL,
      arrivalTryDirection({ ...(talkKeyLabel !== undefined ? { talkKeyLabel } : undefined) }),
    ],
    data.length > 0 ? data.join("\n") : undefined,
  );
}
