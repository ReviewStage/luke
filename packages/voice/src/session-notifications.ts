import {
  ATTENTION_REVIEW_OUTCOME,
  ATTENTION_TRIGGER,
  type AttentionReview,
} from "@sidecar/attention";
import { SESSION_ANNOUNCEMENT_CHANGE, type SessionAnnouncement } from "@sidecar/realtime";
import {
  ATTENTION_DISPOSITION,
  SESSION_NOTICE_STATUS,
  SESSION_STATUS,
  type SessionIdentity,
  type SessionNotice,
} from "@sidecar/session";

function flattened(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

interface AnnouncementSource extends SessionIdentity {
  activity?: string;
  error?: string;
}

/**
 * The one line an announcement may add to its session's name: the failure
 * for a session that stopped, else the tool it is running or holding on. A
 * finished turn with neither says only that it finished — what the work was
 * is the subject's to name, never a scrape of the agent's last message.
 */
function announcementDetail(
  source: AnnouncementSource,
  change: SessionAnnouncement["change"],
): string | undefined {
  if (change === SESSION_ANNOUNCEMENT_CHANGE.FAILED && source.error) return flattened(source.error);
  return source.activity ? flattened(source.activity) : undefined;
}

function announcement(
  source: AnnouncementSource,
  change: SessionAnnouncement["change"],
  decidedAt: number,
): SessionAnnouncement | undefined {
  const detail = announcementDetail(source, change);
  const base = {
    providerId: source.providerId,
    providerSessionId: source.providerSessionId,
    decidedAt,
  };
  if (
    change === SESSION_ANNOUNCEMENT_CHANGE.NEEDS_INPUT ||
    change === SESSION_ANNOUNCEMENT_CHANGE.UPDATED
  ) {
    return detail ? { ...base, change, detail } : undefined;
  }
  return { ...base, change, ...(detail ? { detail } : undefined) };
}

/**
 * Keeps the deterministic path for facts that cannot wait on model judgment.
 * Routine finishes still reach the attention evaluator, which can speak when
 * their outcome is actually useful; the status edge alone does not earn an
 * interruption.
 */
export function sessionNoticeAnnouncement(
  notice: SessionNotice,
  decidedAt: number,
): SessionAnnouncement | undefined {
  if (notice.status === SESSION_NOTICE_STATUS.COMPLETE) return undefined;
  if (notice.status === SESSION_NOTICE_STATUS.WAITING && notice.holdingForDeveloper !== true) {
    return undefined;
  }
  const change =
    notice.status === SESSION_NOTICE_STATUS.WAITING
      ? SESSION_ANNOUNCEMENT_CHANGE.NEEDS_INPUT
      : SESSION_ANNOUNCEMENT_CHANGE.FAILED;
  return announcement(notice, change, decidedAt);
}

/** Turns one decided, non-silent review into the announcement it earned. */
export function sessionAnnouncementFromReview(
  review: AttentionReview,
): SessionAnnouncement | undefined {
  if (review.outcome !== ATTENTION_REVIEW_OUTCOME.DECIDED) return undefined;
  if (review.decision.disposition === ATTENTION_DISPOSITION.SILENT) return undefined;
  const { update } = review;
  const change =
    update.trigger === ATTENTION_TRIGGER.ERROR_REPORTED || update.status === SESSION_STATUS.ERROR
      ? SESSION_ANNOUNCEMENT_CHANGE.FAILED
      : update.status === SESSION_STATUS.WAITING && update.holdingForDeveloper === true
        ? SESSION_ANNOUNCEMENT_CHANGE.NEEDS_INPUT
        : update.status === SESSION_STATUS.COMPLETE
          ? SESSION_ANNOUNCEMENT_CHANGE.FINISHED
          : SESSION_ANNOUNCEMENT_CHANGE.UPDATED;
  return announcement(
    {
      providerId: review.providerId,
      providerSessionId: review.providerSessionId,
      ...(update.context?.activity ? { activity: update.context.activity } : undefined),
      ...(update.context?.error ? { error: update.context.error } : undefined),
    },
    change,
    review.decision.decidedAt,
  );
}
