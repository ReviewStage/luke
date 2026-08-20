import { ATTENTION_SPEECH_SOURCE, type AttentionSpeech } from "@sidecar/realtime";
import {
  ATTENTION_DISPOSITION,
  SESSION_NOTICE_STATUS,
  type SessionNotice,
  type SessionNoticeStatus,
} from "@sidecar/session";

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

function quoted(value: string): string {
  return `"${flattened(value).replaceAll('"', "'")}"`;
}

/** Renders provider-observed status fields for the voice to summarize. */
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

export function sessionNoticeSpeech(notice: SessionNotice, decidedAt: number): AttentionSpeech {
  return {
    providerId: notice.providerId,
    providerSessionId: notice.providerSessionId,
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    source: ATTENTION_SPEECH_SOURCE.STATUS_EDGE,
    summary: noticeUpdateContext(notice),
    decidedAt,
  };
}
