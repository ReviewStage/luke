import {
  ATTENTION_DISPOSITION,
  ATTENTION_SPEECH_SOURCE,
  type AttentionSpeech,
  SESSION_NOTICE_STATUS,
  type SessionNotice,
  type SessionNoticeStatus,
} from "@sidecar/core";
import type { SessionNoticePopup } from "./shared/contracts";

/**
 * Carries one notice to the voice as the bounded fields it was observed as —
 * the provider's name for the session, the workspace it is one chat of, where
 * it runs, the agent's parting words or the provider's error line, and whether
 * a reply can land. No sentence is composed here: the voice words the
 * announcement in the moment, under instructions fixed at build time, so what
 * is said sounds like Luke rather than a template — while what may be said
 * about, and when, stays decided by the deterministic status edge alone.
 */

/**
 * How much of the parting words travel. An excerpt, not the recap whole: the
 * announcement needs the question the session is waiting on, and a paragraph
 * of it is a readout, not news.
 */
const RECAP_EXCERPT_LENGTH = 240;

/**
 * The least of the bound a sentence cut may keep. The parting words usually
 * end on the question the session is waiting on, so a tidy boundary near the
 * start — a short status line before one long question — must not win over
 * carrying most of the words: below this the trim falls through to the word
 * cut, which spends the whole bound.
 */
const MINIMUM_SENTENCE_CUT = RECAP_EXCERPT_LENGTH / 2;

/** One line of data: whatever whitespace the provider reported, flattened. */
function flattened(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The parting words trimmed to their bound: whole when they fit, else cut at
 * the last sentence end when that keeps most of the room, else at a word.
 */
function recapExcerpt(text: string): string {
  const line = flattened(text);
  if (line.length <= RECAP_EXCERPT_LENGTH) return line;
  // One character past the bound, so a sentence ending exactly at the edge
  // still shows the space that marks its boundary.
  const window = line.slice(0, RECAP_EXCERPT_LENGTH + 1);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  );
  if (sentenceEnd + 1 >= MINIMUM_SENTENCE_CUT) return window.slice(0, sentenceEnd + 1);
  // The word cut spends one bounded character on the ellipsis; a sentence
  // cut ends on its own punctuation and spends nothing.
  const cut = line.slice(0, RECAP_EXCERPT_LENGTH - 1);
  const wordEnd = cut.lastIndexOf(" ");
  return `${(wordEnd > 0 ? cut.slice(0, wordEnd) : cut).trimEnd()}…`;
}

/** What happened, as data for the voice to word — not a sentence to read. */
function noticeEvent(status: SessionNoticeStatus): string {
  switch (status) {
    case SESSION_NOTICE_STATUS.WAITING:
      return "started waiting on the developer";
    case SESSION_NOTICE_STATUS.ERROR:
      return "stopped on an error";
    case SESSION_NOTICE_STATUS.COMPLETE:
      return "finished";
    default:
      throw new Error(`Unknown notice status: ${String(status)}`);
  }
}

/**
 * A provider-written value on the update line: flattened, quoted, and its own
 * double quotes bent to single so it cannot close the quote around it. The
 * labels and the two build-fixed values stand bare, so on the finished line
 * everything inside quotes is a provider's words and everything outside them
 * was written here — a title or recap that spells `; event: finished` stays
 * visibly inside its quotes rather than forging a field of its own.
 */
function quoted(text: string): string {
  return `"${flattened(text).replaceAll('"', "'")}"`;
}

/**
 * One notice as labeled fields on a single line. A field the provider left
 * empty stays absent rather than drawn as a blank, and the whole line is data:
 * the fixed announcement instructions are what tell the voice to word it.
 */
function noticeUpdateContext(notice: SessionNotice): string {
  const workspace =
    notice.workspace && flattened(notice.workspace) !== flattened(notice.title)
      ? notice.workspace
      : undefined;
  const fields: readonly (readonly [string, string] | undefined)[] = [
    ["provider", quoted(notice.providerName)],
    ["session", quoted(notice.title)],
    workspace ? ["workspace", quoted(workspace)] : undefined,
    notice.repository ? ["repository", quoted(notice.repository)] : undefined,
    notice.branch ? ["branch", quoted(notice.branch)] : undefined,
    ["event", noticeEvent(notice.status)],
    notice.error ? ["error", quoted(notice.error)] : undefined,
    // Only beside a wait or a finish: parting words beside a failure predate
    // the thing the update now has to say, and the privacy boundary promises
    // the excerpt travels for those two edges alone.
    notice.recap && notice.status !== SESSION_NOTICE_STATUS.ERROR
      ? ["parting words", quoted(recapExcerpt(notice.recap))]
      : undefined,
    ["takes a reply now", notice.canReceiveMessage ? "yes" : "no"],
  ];
  return fields
    .filter((field): field is readonly [string, string] => field !== undefined)
    .map(([label, value]) => `${label}: ${value}`)
    .join("; ");
}

/**
 * One notice as attention speech: the same shape the evaluator's readouts
 * travel in, so the renderer voices both through one door — the source is
 * what tells the protocol layer these are fields to word, not a sentence to
 * read. `decidedAt` is when the announcement was decided on, not when the
 * provider observed the session — it is what the renderer measures staleness
 * against.
 */
export function sessionNoticeSpeech(notice: SessionNotice, decidedAt: number): AttentionSpeech {
  return {
    providerId: notice.providerId,
    providerSessionId: notice.providerSessionId,
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    // The source is what entitles this update to open a call of Luke's own:
    // it was raised by a status edge the registry observed, not by a model.
    source: ATTENTION_SPEECH_SOURCE.STATUS_EDGE,
    summary: noticeUpdateContext(notice),
    decidedAt,
  };
}

/** Where the session runs, the way the popup's line takes it, or nothing. */
function noticePlace(notice: SessionNotice): string {
  const place = notice.repository ?? notice.branch;
  return place ? ` on ${flattened(place)}` : "";
}

/**
 * The line the notice popup draws under the session's name. The popup titles
 * itself with the name and the provider from the roster the renderer already
 * holds, so — unlike the spoken update, which arrives with nothing else on
 * screen — this line says only what just happened.
 */
function noticePopupBody(notice: SessionNotice): string {
  switch (notice.status) {
    case SESSION_NOTICE_STATUS.WAITING:
      return `Waiting on you${noticePlace(notice)}.`;
    case SESSION_NOTICE_STATUS.ERROR:
      // The provider's own reason when it gave one — already bounded by
      // normalization, never a transcript.
      return notice.error
        ? `Stopped: ${notice.error}`
        : `Stopped on an error${noticePlace(notice)}.`;
    case SESSION_NOTICE_STATUS.COMPLETE:
      return `Finished${noticePlace(notice)}.`;
    default:
      throw new Error(`Unknown notice status: ${String(notice.status)}`);
  }
}

/** One status edge as the popup the surface draws under the housing. */
export function sessionNoticePopup(notice: SessionNotice, decidedAt: number): SessionNoticePopup {
  return {
    providerId: notice.providerId,
    providerSessionId: notice.providerSessionId,
    body: noticePopupBody(notice),
    decidedAt,
  };
}

/**
 * An evaluator's speaking decisions as popups. The decided sentence was worded
 * to be said aloud, so it already carries its own subject; the popup's title
 * above it only makes the session it names pressable.
 */
export function attentionSpeechPopups(
  speech: readonly AttentionSpeech[],
): readonly SessionNoticePopup[] {
  return speech.map((item) => ({
    providerId: item.providerId,
    providerSessionId: item.providerSessionId,
    body: item.summary,
    decidedAt: item.decidedAt,
  }));
}
