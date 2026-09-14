import { Schema } from "effect";
import { chunkForAppend } from "./chunks.js";
import { greetingCue, launchGreetingInstruction } from "./instructions.js";
import { trimmedText } from "./trimmed-text.js";

/**
 * What Luke says first: the briefing the brain decided to give, and the
 * beats whose trigger is deterministic and whose words are a script fixed by
 * the build. A briefing and the onboarding beats become commentary appends
 * with a null delegation into the standing session, or one opened muted for
 * it, so Luke phrases them in his own voice; the launch greeting is the
 * Live conversations guide's greeting before the caller speaks, an
 * instructions append carrying the welcome and the cue that has the model
 * begin. The voice picker's audition is a beat like the onboarding ones: a
 * fixed line, said into the session its chosen voice opened. This is the
 * contract between the host that decides a turn and the session that speaks
 * it; the appends are built here and nowhere else.
 */

export const PROACTIVE_SPEECH_KIND = {
  /** Words the brain decided to say, already worded. */
  BRIEFING: "briefing",
  /** The once-per-install beat at the deterministic edge of the first sign-in. */
  ARRIVAL: "arrival",
  /** The line beside the calendar step of onboarding, carrying nothing observed. */
  CALENDAR_ONBOARDING: "calendar-onboarding",
  /** The greeting of every signed-in launch, spoken before the developer says a word. */
  LAUNCH: "launch",
  /**
   * The line the voice picker auditions a voice with: GPT Live fixes a
   * session's voice at creation and documents no preview of its own, so the
   * one way to hear a voice is a session created with it saying something,
   * and this is the something. Its words carry nothing observed.
   */
  VOICE_PREVIEW: "voice-preview",
} as const;

export type ProactiveSpeechKind =
  (typeof PROACTIVE_SPEECH_KIND)[keyof typeof PROACTIVE_SPEECH_KIND];

export const ProactiveSpeechKindSchema = Schema.Literals(Object.values(PROACTIVE_SPEECH_KIND));

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

/**
 * The launch greeting names the developer, and the name is the one observed
 * value it carries, bounded here before it enters the instruction.
 */
export interface LaunchSpeech {
  kind: typeof PROACTIVE_SPEECH_KIND.LAUNCH;
  /** The signed-in account's first name, as the account service reported it. */
  firstName?: string;
  decidedAt: number;
}

/** The picker's audition: nothing of the developer's own enters it, so it carries only its instant. */
export interface VoicePreviewSpeech {
  kind: typeof PROACTIVE_SPEECH_KIND.VOICE_PREVIEW;
  decidedAt: number;
}

export type ProactiveSpeechTurn =
  | BriefingSpeech
  | ArrivalSpeech
  | CalendarOnboardingSpeech
  | LaunchSpeech
  | VoicePreviewSpeech;

/**
 * A greeting spoken the way the Live conversations guide has it: the
 * instruction appended once the session starts, acknowledged before the cue
 * that asks the model to begin. Only the launch greeting speaks this way.
 */
export interface SpeechOpening {
  instruction: string;
  cue: string;
}

/**
 * How much of an observed value an append may carry: a title is a few words,
 * and one that runs longer is cut rather than given a paragraph of the
 * model's window. Newlines go too, since an append is one plain string.
 */
export const OBSERVED_VALUE_LENGTH = 200;

function observedValue(value: string | undefined): string | undefined {
  return trimmedText(value?.replace(/\s+/gu, " "))?.slice(0, OBSERVED_VALUE_LENGTH);
}

/** A value that stands inside the instruction's quoted welcome: bounded, and without the quote that would close it early. */
function quotableValue(value: string | undefined): string | undefined {
  return trimmedText(observedValue(value)?.replace(/"/gu, ""));
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

/**
 * The audition's script: the sentence is the build's, said once and closed on,
 * because what the developer is listening for is the voice and not the words.
 * A picker that heard a different sentence each time would be comparing
 * sentences.
 */
const VOICE_PREVIEW_CONTENT =
  "The developer has just chosen this voice in settings and is listening to hear it. Say exactly " +
  'these words and nothing else: "Hi, what can I help you with?" Do not greet them by name, do ' +
  "not add a sentence of your own, and do not wait for an answer.";

const CALENDAR_ONBOARDING_CONTENT =
  "The panel is asking the developer to connect a calendar. Say one short sentence, warmly, to the " +
  "effect of: connect your calendar so I don't talk during your meetings. Nothing more.";

/**
 * The commentary appends that speak one turn, in order, each under the
 * append bound. A briefing is the brain's own words, cut at sentence ends; the
 * onboarding beats are the build's script with their observed values
 * bounded. A briefing with nothing to say builds nothing, and the launch
 * greeting speaks through its opening instead, so it has no commentary of
 * its own.
 */
export function speechAppends(turn: ProactiveSpeechTurn): readonly string[] {
  switch (turn.kind) {
    case PROACTIVE_SPEECH_KIND.BRIEFING:
      return chunkForAppend(turn.briefing);
    case PROACTIVE_SPEECH_KIND.ARRIVAL:
      return chunkForAppend(arrivalContent(turn));
    case PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING:
      return chunkForAppend(CALENDAR_ONBOARDING_CONTENT);
    case PROACTIVE_SPEECH_KIND.VOICE_PREVIEW:
      return chunkForAppend(VOICE_PREVIEW_CONTENT);
    case PROACTIVE_SPEECH_KIND.LAUNCH:
      return [];
  }
}

/** The instruction-and-cue pair a turn opens with, for the one kind that greets. */
export function speechOpening(turn: ProactiveSpeechTurn): SpeechOpening | undefined {
  if (turn.kind !== PROACTIVE_SPEECH_KIND.LAUNCH) return undefined;
  return {
    instruction: launchGreetingInstruction(quotableValue(turn.firstName)),
    cue: greetingCue(),
  };
}
