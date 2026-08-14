import {
  ATTENTION_DISPOSITION,
  type AttentionSpeech,
  SESSION_NOTICE_STATUS,
  type SessionNotice,
  type SessionNoticeStatus,
} from "@sidecar/core";

/**
 * Words one notice as the sentence Luke says out loud. The fields are the
 * ones a row already draws — the provider's name for the session, where it
 * runs, the bounded error line — worded here, in the surface layer, so the
 * adapters keep reporting fields and the sentence leaves the machine only as
 * the thing to be read.
 */

/** Where the session runs, the way a sentence takes it, or nothing. */
function noticePlace(notice: SessionNotice): string {
  const place = notice.repository ?? notice.branch;
  return place ? ` on ${place}` : "";
}

const NOTICE_SENTENCE: Record<SessionNoticeStatus, (notice: SessionNotice) => string> = {
  [SESSION_NOTICE_STATUS.WAITING]: (notice) =>
    `${notice.providerName} is waiting on you in "${notice.title}"${noticePlace(notice)}.`,
  // The provider's own reason when it gave one — already bounded by
  // normalization, never a transcript.
  [SESSION_NOTICE_STATUS.ERROR]: (notice) =>
    notice.error
      ? `${notice.providerName} stopped in "${notice.title}"${noticePlace(notice)}: ${notice.error}`
      : `${notice.providerName} stopped on an error in "${notice.title}"${noticePlace(notice)}.`,
  [SESSION_NOTICE_STATUS.COMPLETE]: (notice) =>
    `${notice.providerName} finished "${notice.title}"${noticePlace(notice)}.`,
};

/**
 * One notice as attention speech: the same shape the evaluator's readouts
 * travel in, so the renderer voices both through one door. `decidedAt` is
 * when the announcement was decided on, not when the provider observed the
 * session — it is what the renderer measures staleness against.
 */
export function sessionNoticeSpeech(notice: SessionNotice, decidedAt: number): AttentionSpeech {
  return {
    providerId: notice.providerId,
    providerSessionId: notice.providerSessionId,
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    summary: NOTICE_SENTENCE[notice.status](notice),
    decidedAt,
  };
}
