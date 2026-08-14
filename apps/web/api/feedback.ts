/**
 * Turns one Luke feedback submission into email to the founders.
 *
 * This is the fixed endpoint the desktop app's composer posts to
 * (`apps/desktop/src/feedback-delivery.ts`), deployed with the landing page.
 * It forwards exactly what the user typed and attached — the app never holds a
 * mail credential, and the destination never crosses the wire.
 *
 * Deployment needs one secret: `RESEND_API_KEY`, a Resend key for a domain
 * verified to send as the `from` address. `FEEDBACK_FROM` may override that
 * sender. Without the key the endpoint answers 503 and the composer reports
 * the service unavailable; nothing else about the app depends on it.
 */

declare const process: { env: Record<string, string | undefined> };

const RESEND_URL = "https://api.resend.com/emails";
const DESTINATION = "founders@stagereview.app";
const DEFAULT_FROM = "Luke <feedback@tryluke.dev>";

const FEEDBACK_KIND = {
  FEEDBACK: "feedback",
  PROMPT: "prompt",
} as const;

type FeedbackKind = (typeof FEEDBACK_KIND)[keyof typeof FEEDBACK_KIND];

const FEEDBACK_KINDS: readonly string[] = Object.values(FEEDBACK_KIND);

const FEEDBACK_IMAGE_TYPE = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
} as const;

const FEEDBACK_IMAGE_TYPES: readonly string[] = Object.values(FEEDBACK_IMAGE_TYPE);

/* The same bounds the composer and the app's trust boundary enforce; keep in
   step with `apps/desktop/src/shared/feedback.ts`. */
const FEEDBACK_LIMITS = {
  MESSAGE_MAX_LENGTH: 8_000,
  NAME_MAX_LENGTH: 120,
  EMAIL_MAX_LENGTH: 254,
  MAX_IMAGES: 3,
  IMAGE_MAX_BYTES: 900_000,
} as const;

const SUBJECT_LINE: Record<FeedbackKind, string> = {
  [FEEDBACK_KIND.FEEDBACK]: "Luke feedback",
  [FEEDBACK_KIND.PROMPT]: "Luke prompt",
};

interface FeedbackImage {
  name: string;
  mediaType: string;
  base64: string;
}

interface FeedbackSubmission {
  kind: FeedbackKind;
  message: string;
  name?: string;
  email?: string;
  images: readonly FeedbackImage[];
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodedByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

function feedbackImage(value: unknown): FeedbackImage | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const { name, mediaType, base64 } = value as Partial<FeedbackImage>;
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 255) return undefined;
  if (typeof mediaType !== "string" || !FEEDBACK_IMAGE_TYPES.includes(mediaType)) return undefined;
  if (typeof base64 !== "string" || base64.length === 0) return undefined;
  if (!BASE64_PATTERN.test(base64)) return undefined;
  if (decodedByteLength(base64) > FEEDBACK_LIMITS.IMAGE_MAX_BYTES) return undefined;
  return { name: name.trim(), mediaType, base64 };
}

/* A single line of credit: bounded, and never carrying a line break that could
   reach a mail header. */
function optionalLine(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

function feedbackSubmission(value: unknown): FeedbackSubmission | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const { kind, message, name, email, images } = value as Partial<FeedbackSubmission>;
  if (typeof kind !== "string" || !FEEDBACK_KINDS.includes(kind)) return undefined;
  if (typeof message !== "string") return undefined;
  const messageText = message.trim();
  if (messageText.length === 0 || messageText.length > FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH) {
    return undefined;
  }
  const nameLine = optionalLine(name, FEEDBACK_LIMITS.NAME_MAX_LENGTH);
  if (nameLine === null) return undefined;
  const emailLine = optionalLine(email, FEEDBACK_LIMITS.EMAIL_MAX_LENGTH);
  if (emailLine === null) return undefined;
  if (!Array.isArray(images) || images.length > FEEDBACK_LIMITS.MAX_IMAGES) return undefined;
  const parsedImages: FeedbackImage[] = [];
  for (const candidate of images) {
    const image = feedbackImage(candidate);
    if (!image) return undefined;
    parsedImages.push(image);
  }
  return {
    kind: kind as FeedbackKind,
    message: messageText,
    ...(nameLine ? { name: nameLine } : {}),
    ...(emailLine ? { email: emailLine } : {}),
    images: parsedImages,
  };
}

function emailBody(submission: FeedbackSubmission): string {
  const credit =
    submission.name || submission.email
      ? `From: ${[submission.name, submission.email].filter(Boolean).join(" — ")}`
      : "From: unsigned";
  return [submission.message, "", "—", credit, "Sent from the Luke panel."].join("\n");
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return json(503, { reason: "The feedback service is not configured." });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { reason: "The submission was not JSON." });
  }
  const submission = feedbackSubmission(payload);
  if (!submission) return json(400, { reason: "Malformed submission." });

  const signature = submission.name ?? submission.email;
  const subject = signature
    ? `${SUBJECT_LINE[submission.kind]} from ${signature}`
    : SUBJECT_LINE[submission.kind];

  let response: Response;
  try {
    response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.FEEDBACK_FROM?.trim() || DEFAULT_FROM,
        to: [DESTINATION],
        subject,
        text: emailBody(submission),
        // Replying to the email answers the person who wrote it, when they said
        // who that is.
        ...(submission.email ? { reply_to: [submission.email] } : {}),
        ...(submission.images.length > 0
          ? {
              attachments: submission.images.map((image) => ({
                filename: image.name,
                content: image.base64,
              })),
            }
          : {}),
      }),
    });
  } catch {
    console.error("Feedback forwarding did not reach the mail service");
    return json(502, { reason: "The mail service could not be reached." });
  }

  if (!response.ok) {
    // The status is diagnosis enough; the submission itself is never logged.
    console.error(`Feedback forwarding failed with status ${response.status}`);
    return json(502, { reason: "The mail service refused this submission." });
  }
  return json(200, { delivered: true });
}
