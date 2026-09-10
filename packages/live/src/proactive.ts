import { chunkForAppend } from "./chunks.js";
import { trimmedText } from "./trimmed-text.js";

/**
 * What Luke says first: the briefing the brain decided to give, and the two
 * onboarding beats whose trigger is deterministic and whose words are a
 * script fixed by the build. Each becomes commentary appends with a null
 * delegation into the standing session, or one opened muted for it, so Luke
 * phrases them in his own voice. This is the contract between the host that
 * decides a turn and the session that speaks it; the appends are built here
 * and nowhere else.
 */

export const PROACTIVE_SPEECH_KIND = {
  /** Words the brain decided to say, already worded. */
  BRIEFING: "briefing",
  /** The once-per-install beat at the deterministic edge of the first sign-in. */
  ARRIVAL: "arrival",
  /** The line beside the calendar step of onboarding, carrying nothing observed. */
  CALENDAR_ONBOARDING: "calendar-onboarding",
} as const;

export type ProactiveSpeechKind =
  (typeof PROACTIVE_SPEECH_KIND)[keyof typeof PROACTIVE_SPEECH_KIND];

export interface BriefingSpeech {
  kind: typeof PROACTIVE_SPEECH_KIND.BRIEFING;
  briefing: string;
  /** When it was decided, so a stale one is dropped rather than said as though it just happened. */
  decidedAt: number;
}

/**
 * The arrival beat is about no session, so it carries no identity; the two
 * optional fields are the only observed things it may mention, each bounded
 * here before it enters an append.
 */
export interface ArrivalSpeech {
  kind: typeof PROACTIVE_SPEECH_KIND.ARRIVAL;
  /** A working session's title, so the suggested first ask is about the developer's own work. */
  sessionTitle?: string;
  /** The talk key worded for a sentence, present only while holding it would open a turn. */
  talkKeyLabel?: string;
  decidedAt: number;
}

export interface CalendarOnboardingSpeech {
  kind: typeof PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING;
  decidedAt: number;
}

export type ProactiveSpeechTurn = BriefingSpeech | ArrivalSpeech | CalendarOnboardingSpeech;

/**
 * How much of an observed value an append may carry: a title is a few words,
 * and one that runs longer is cut rather than given a paragraph of the
 * model's window. Newlines go too, since an append is one plain string.
 */
export const OBSERVED_VALUE_LENGTH = 200;

function observedValue(value: string | undefined): string | undefined {
  return trimmedText(value?.replace(/\s+/gu, " "))?.slice(0, OBSERVED_VALUE_LENGTH);
}

/**
 * The arrival beat's words: they are all set and should go back to work,
 * since Luke speaks when an agent needs them. The one suggestion it closes on
 * is chosen from two build-fixed lines by whether the talk key would work,
 * and the observed title enters only as a value to mention, so a title that
 * reads like an order is still a title.
 */
function arrivalContent(speech: ArrivalSpeech): string {
  const sessionTitle = observedValue(speech.sessionTitle);
  const talkKeyLabel = observedValue(speech.talkKeyLabel);
  const suggestion =
    talkKeyLabel === undefined
      ? 'Invite exactly one thing to try: typing "what needs me?" into the field at the foot of the panel.'
      : `Invite exactly one thing to try: holding the ${talkKeyLabel} key and asking "what needs me?"`;
  return [
    "The developer has just signed in for the first time. Tell them, warmly and in two or three",
    "short sentences, that they are all set and should go back to their work: when one of their",
    "coding agents needs them, hits an error, or finishes, you will say so from the top of their",
    "screen by the notch.",
    ...(sessionTitle === undefined
      ? []
      : [`One agent is already working, titled "${sessionTitle}"; mention it.`]),
    suggestion,
    "Do not greet and do not ask a question back.",
  ].join(" ");
}

const CALENDAR_ONBOARDING_CONTENT =
  "The panel is asking the developer to connect a calendar. Say one short sentence, warmly, to the " +
  "effect of: connect your calendar so I don't talk during your meetings. Nothing more.";

/**
 * The commentary appends that speak one turn, in order, each under the
 * append bound. A briefing is the brain's own words, cut at sentence ends; the
 * beats are the build's script with their observed values bounded. A briefing
 * with nothing to say builds nothing.
 */
export function speechAppends(turn: ProactiveSpeechTurn): readonly string[] {
  switch (turn.kind) {
    case PROACTIVE_SPEECH_KIND.BRIEFING:
      return chunkForAppend(turn.briefing);
    case PROACTIVE_SPEECH_KIND.ARRIVAL:
      return chunkForAppend(arrivalContent(turn));
    case PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING:
      return chunkForAppend(CALENDAR_ONBOARDING_CONTENT);
  }
}
