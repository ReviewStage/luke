import {
  ATTENTION_DISPOSITION,
  ATTENTION_SPEECH_SOURCE,
  type AttentionSpeech,
  SESSION_NOTICE_STATUS,
  type SessionNotice,
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

function noticeSentence(notice: SessionNotice): string {
  switch (notice.status) {
    case SESSION_NOTICE_STATUS.WAITING:
      return `${notice.providerName} is waiting on you in "${notice.title}"${noticePlace(notice)}.`;
    case SESSION_NOTICE_STATUS.ERROR:
      // The provider's own reason when it gave one — already bounded by
      // normalization, never a transcript.
      return notice.error
        ? `${notice.providerName} stopped in "${notice.title}"${noticePlace(notice)}: ${notice.error}`
        : `${notice.providerName} stopped on an error in "${notice.title}"${noticePlace(notice)}.`;
    case SESSION_NOTICE_STATUS.COMPLETE:
      return `${notice.providerName} finished "${notice.title}"${noticePlace(notice)}.`;
    default:
      throw new Error(`Unknown notice status: ${String(notice.status)}`);
  }
}

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
    // The source is what entitles this sentence to open a call of Luke's own:
    // it was worded from a status edge the registry observed, not by a model.
    source: ATTENTION_SPEECH_SOURCE.STATUS_EDGE,
    summary: noticeSentence(notice),
    decidedAt,
  };
}
