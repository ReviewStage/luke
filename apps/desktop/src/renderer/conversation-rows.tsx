import { WingFace } from "@sidecar/panel";
import { FACE_MOTION } from "@sidecar/surface";
import { useEffect, useState } from "react";
import { createConversationTimeBreakFormatter } from "./conversation-time-break";
import { ThinkingDots } from "./thinking-dots";

/**
 * The rows the thread draws that belong to no message: Luke's wait, the
 * developer's place before their words arrive, and the date set over a line
 * that followed a long silence. Here rather than in the panel because the
 * turn renderer draws them too, at the foot of a turn still running and
 * between turns, and a row two files share lives in neither.
 */

export const CONVERSATION_ENTRY_SPEAKER = {
  YOU: "you",
  LUKE: "luke",
  EVENT: "event",
} as const;

export type ConversationEntrySpeaker =
  (typeof CONVERSATION_ENTRY_SPEAKER)[keyof typeof CONVERSATION_ENTRY_SPEAKER];

const timeBreakLabel = createConversationTimeBreakFormatter();

/** What a reader is told of a run still going; the sighted read the face and the dots. */
const CONVERSATION_THINKING_LABEL = "Luke is thinking";

/** What a reader is told while a spoken turn is still owed its first words. */
const CONVERSATION_LISTENING_LABEL = "Luke is listening";

/** How long a run goes before the wait says how long it has been. */
const THINKING_ELAPSED_AFTER_MS = 10_000;

/** How often the wait's own clock moves once it is saying its age. */
const THINKING_CLOCK_MS = 1_000;

/**
 * What the wait says once a run has gone on long enough to be worth a word,
 * and nothing before that: a quick reply earns no sentence, and a run that has
 * stood for minutes must not read like one that started a second ago.
 */
export function thinkingElapsedLabel(since: number, now: number): string | undefined {
  const elapsed = now - since;
  if (elapsed < THINKING_ELAPSED_AFTER_MS) return undefined;
  const seconds = Math.floor(elapsed / 1000);
  return `Still thinking · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Luke's turn, drawn on his side of the thread in the bubble his reply will
 * fill, so the thread holds one object per turn and the reply replaces the wait
 * in place. His face plays the success hop on repeat — a run still going is
 * continuously true, which is what a repeating motion is for — and three dots
 * rise in its wake. Nothing here is a control: the stop is the composer's disc,
 * which both tabs share. The reader's line is the live region, and the age
 * beside it is not, so a ticking count is never read out second by second.
 */
export function ConversationThinkingRow({
  since,
  now,
}: {
  since: number;
  now: number;
}): React.JSX.Element {
  // The wait keeps a clock of its own past the app's, which moves only when
  // the app renders: a count of how long a run has been going has to move on
  // its own. Never behind the app's clock, so a fixed clock is never
  // contradicted by this one.
  const [clock, setClock] = useState(now);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), THINKING_CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = thinkingElapsedLabel(since, Math.max(clock, now));
  return (
    <li
      className="conversation-entry"
      data-speaker={CONVERSATION_ENTRY_SPEAKER.LUKE}
      data-thinking="true"
    >
      <small className="visually-hidden">Luke</small>
      <div className="conversation-message">
        <span className="conversation-bubble">
          <span className="conversation-thinking">
            <WingFace motion={FACE_MOTION.SUCCESS} repeat />
            <ThinkingDots />
            {elapsed ? <span className="conversation-thinking-elapsed">{elapsed}</span> : null}
            <span className="visually-hidden" role="status">
              {CONVERSATION_THINKING_LABEL}
            </span>
          </span>
        </span>
      </div>
    </li>
  );
}

/**
 * The developer's turn before its words arrive, in the sent bubble the
 * transcript will fill: the press is heard the moment it lands, not seconds
 * later when the transcription's first words come back. Three dots and no
 * face — the face is Luke's own mark, and this turn is the developer's. It is
 * presentation alone, drawn from the reported voice view and never entering
 * the thread; the words that settle it arrive as a live line and then a
 * recorded one, exactly as they always did.
 */
export function ConversationListeningRow(): React.JSX.Element {
  return (
    <li
      className="conversation-entry"
      data-speaker={CONVERSATION_ENTRY_SPEAKER.YOU}
      data-thinking="true"
    >
      <small className="visually-hidden">You</small>
      <div className="conversation-message">
        <span className="conversation-bubble">
          <span className="conversation-listening">
            <ThinkingDots />
            <span className="visually-hidden" role="status">
              {CONVERSATION_LISTENING_LABEL}
            </span>
          </span>
        </span>
      </div>
    </li>
  );
}

/**
 * The moment a line was said, set over it the way iMessage dates a message
 * that followed a long silence. It is the thread's line, not a message: it
 * reads in the quiet voice the requested actions use, and it stands still under
 * the pull like Luke's rows do, so uncovering the stamp column never pushes
 * a date off the screen.
 */
export function ConversationTimeBreak({
  recordedAt,
  now,
}: {
  recordedAt: number;
  now: number;
}): React.JSX.Element {
  const at = new Date(recordedAt);
  const label = timeBreakLabel(recordedAt, now);
  return (
    <li className="conversation-break">
      <time className="conversation-break-time" dateTime={at.toISOString()}>
        <strong>{label.day}</strong> {label.time}
      </time>
    </li>
  );
}
