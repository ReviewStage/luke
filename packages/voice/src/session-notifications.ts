import { ATTENTION_SPEECH_SOURCE, type AttentionSpeech } from "@sidecar/realtime";
import { ATTENTION_DISPOSITION, SESSION_NOTICE_STATUS, type SessionNotice } from "@sidecar/session";

const RECAP_EXCERPT_LENGTH = 240;
const MINIMUM_SENTENCE_CUT = RECAP_EXCERPT_LENGTH / 2;

function flattened(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function recapExcerpt(value: string): string {
  const line = flattened(value);
  if (line.length <= RECAP_EXCERPT_LENGTH) return line;
  const window = line.slice(0, RECAP_EXCERPT_LENGTH + 1);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  );
  if (sentenceEnd + 1 >= MINIMUM_SENTENCE_CUT) return window.slice(0, sentenceEnd + 1);
  const cut = line.slice(0, RECAP_EXCERPT_LENGTH - 1);
  const wordEnd = cut.lastIndexOf(" ");
  return `${(wordEnd > 0 ? cut.slice(0, wordEnd) : cut).trimEnd()}…`;
}

function noticeEvent(notice: SessionNotice): string {
  const { status } = notice;
  switch (status) {
    case SESSION_NOTICE_STATUS.WAITING:
      return notice.holdingForDeveloper === true
        ? "needs a decision to continue"
        : "finished what it was working on";
    case SESSION_NOTICE_STATUS.ERROR:
      return "ran into an error";
    case SESSION_NOTICE_STATUS.COMPLETE:
      return "finished";
    default:
      throw new Error(`Unknown notice status: ${String(status)}`);
  }
}

function quoted(value: string): string {
  return `"${flattened(value).replaceAll('"', "'")}"`;
}

function containsConcreteQuestion(value: string | undefined): value is string {
  if (!value) return false;
  return value.replace(/\bhttps?:\/\/[^\s?]+(?:\?[^\s#]+)?(?:#[^\s]+)?/gi, "").includes("?");
}

function decisionContext(notice: SessionNotice): readonly [string, string] | undefined {
  if (notice.activity) return ["permission context", quoted(notice.activity)];
  if (containsConcreteQuestion(notice.recap)) {
    return ["decision", quoted(recapExcerpt(notice.recap))];
  }
  return undefined;
}

/** The useful part of a status edge when it is read later as a chat message. */
function noticeHistoryText(notice: SessionNotice): string {
  if (notice.error) return flattened(notice.error);
  if (notice.recap) return recapExcerpt(notice.recap);
  const event = noticeEvent(notice);
  return `${event[0]?.toUpperCase() ?? ""}${event.slice(1)}.`;
}

/** Renders provider-observed status fields for the voice to summarize. */
function noticeUpdateContext(notice: SessionNotice): string {
  const decision = notice.holdingForDeveloper === true ? decisionContext(notice) : undefined;
  const fields: readonly (readonly [string, string] | undefined)[] = [
    ["provider", quoted(notice.providerName)],
    ["work", quoted(notice.title)],
    ["event", noticeEvent(notice)],
    notice.error ? ["error", quoted(notice.error)] : undefined,
    decision,
    !decision && notice.recap && notice.status !== SESSION_NOTICE_STATUS.ERROR
      ? ["work recap", quoted(recapExcerpt(notice.recap))]
      : undefined,
    notice.holdingForDeveloper === true && notice.canReceiveMessage
      ? ["can take a message now", "yes"]
      : undefined,
  ];
  return fields
    .filter((field): field is readonly [string, string] => field !== undefined)
    .map(([label, value]) => `${label}: ${value}`)
    .join("; ");
}

/**
 * Keeps the deterministic path for facts that cannot wait on model judgment.
 * Routine finishes still reach the attention evaluator, which can speak when
 * their outcome is actually useful; the status edge alone does not earn an
 * interruption.
 */
export function sessionNoticeSpeech(
  notice: SessionNotice,
  decidedAt: number,
): AttentionSpeech | undefined {
  if (notice.status === SESSION_NOTICE_STATUS.COMPLETE) return undefined;
  if (notice.status === SESSION_NOTICE_STATUS.WAITING && notice.holdingForDeveloper !== true) {
    return undefined;
  }
  if (notice.status === SESSION_NOTICE_STATUS.WAITING && !decisionContext(notice)) return undefined;
  return {
    providerId: notice.providerId,
    providerSessionId: notice.providerSessionId,
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    source: ATTENTION_SPEECH_SOURCE.STATUS_EDGE,
    summary: noticeUpdateContext(notice),
    historyText: noticeHistoryText(notice),
    decidedAt,
  };
}
