import { FEEDBACK_KIND, type FeedbackResult, type FeedbackSubmission } from "./shared/feedback";

/**
 * The one mailbox a note opens as a draft to. Fixed here rather than passed
 * in, so the renderer names an intent and never an address — the same posture
 * as a provider's key page: the places Luke can send you are this build's.
 */
export const FEEDBACK_MAIL = {
  RECIPIENT: "founders@stagereview.app",
  SUBJECT: {
    [FEEDBACK_KIND.FEEDBACK]: "Luke feedback",
    [FEEDBACK_KIND.PROMPT]: "Luke prompt",
  },
} as const;

/** What opening the mail client failed as, in words the composer can put under its field. */
export const FEEDBACK_MAIL_REFUSAL = {
  UNOPENED: `Could not open your email client. Send mail to ${FEEDBACK_MAIL.RECIPIENT}`,
} as const;

const MAILTO_PROTOCOL = "mailto:";

type OpenExternal = (url: string) => Promise<void>;

function creditLine(submission: FeedbackSubmission): string | undefined {
  if (!submission.name && !submission.email) return undefined;
  return `From: ${[submission.name, submission.email].filter(Boolean).join(" — ")}`;
}

/**
 * The draft the mail client is asked to open. The user's words first; then,
 * when they picked screenshots, an instruction to attach those files there —
 * mailto cannot carry them, and dropping the names would pretend they were
 * never chosen. Credit last, when they claimed it.
 */
export function feedbackMailBody(submission: FeedbackSubmission): string {
  const lines = [submission.message];
  if (submission.imageNames.length > 0) {
    lines.push(
      "",
      "Please attach these screenshots in your email client — they cannot be attached automatically:",
      ...submission.imageNames.map((name) => `- ${name}`),
    );
  }
  const credit = creditLine(submission);
  if (credit) lines.push("", "—", credit);
  return lines.join("\n");
}

/**
 * Builds the mailto URL for one validated submission. Subject and body are
 * percent-encoded; the mailbox is the fixed recipient, never taken from the
 * renderer, so a crafted payload cannot redirect the draft.
 */
export function feedbackMailtoUrl(submission: FeedbackSubmission): string {
  const subject = encodeURIComponent(FEEDBACK_MAIL.SUBJECT[submission.kind]);
  const body = encodeURIComponent(feedbackMailBody(submission));
  return `${MAILTO_PROTOCOL}${FEEDBACK_MAIL.RECIPIENT}?subject=${subject}&body=${body}`;
}

/**
 * Whether a URL is one this build would open for feedback: mailto, the fixed
 * mailbox, and a subject from the two this composer writes. Defense in depth
 * for the IPC boundary — the renderer never hands over a URL, and openExternal
 * still refuses anything that is not this shape.
 */
export function isFeedbackMailtoUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== MAILTO_PROTOCOL) return false;
  if (parsed.pathname !== FEEDBACK_MAIL.RECIPIENT) return false;
  if (parsed.username || parsed.password || parsed.hostname) return false;
  const subject = parsed.searchParams.get("subject");
  if (
    subject !== FEEDBACK_MAIL.SUBJECT[FEEDBACK_KIND.FEEDBACK] &&
    subject !== FEEDBACK_MAIL.SUBJECT[FEEDBACK_KIND.PROMPT]
  ) {
    return false;
  }
  const body = parsed.searchParams.get("body");
  return typeof body === "string" && body.length > 0;
}

/**
 * Opens the user's mail client on a draft for this note. A refusal is an
 * answer for the composer, never a throw: opening mail is the user's own act,
 * and what became of it belongs beside the field it left. Nothing is sent —
 * the client opens with a draft, and sending stays a press in that client.
 * The address is in the refusal so it can be copied when the client will not
 * open.
 */
export async function openFeedbackMail(
  submission: FeedbackSubmission,
  openExternal: OpenExternal,
): Promise<FeedbackResult> {
  const url = feedbackMailtoUrl(submission);
  if (!isFeedbackMailtoUrl(url)) {
    return { delivered: false, reason: FEEDBACK_MAIL_REFUSAL.UNOPENED };
  }
  try {
    await openExternal(url);
    return { delivered: true };
  } catch {
    return { delivered: false, reason: FEEDBACK_MAIL_REFUSAL.UNOPENED };
  }
}
