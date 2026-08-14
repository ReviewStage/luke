/**
 * Turns one Luke feedback submission into email to the founders.
 *
 * This is the fixed endpoint the desktop app's composer posts to
 * (`apps/desktop/src/feedback-delivery.ts`), deployed with the landing page.
 * It forwards exactly what the user typed and attached — the app never holds a
 * mail credential, and the destination never crosses the wire.
 *
 * Plain ESM rather than TypeScript, like every script in this repository: the
 * function is compiled by Vercel's builder, and handing it JavaScript leaves
 * that builder nothing to resolve, transpile, or fail on.
 *
 * Deployment needs one secret: `RESEND_API_KEY`, a Resend key for a domain
 * verified to send as the `from` address. `FEEDBACK_FROM` may override that
 * sender. Without the key the endpoint answers 503 and the composer reports
 * the service unavailable; nothing else about the app depends on it.
 */

const RESEND_URL = "https://api.resend.com/emails";
const DESTINATION = "founders@stagereview.app";
const DEFAULT_FROM = "Luke <feedback@tryluke.dev>";

/**
 * A best-effort brake on abuse: the endpoint is public and each accepted
 * submission spends mail quota, so one address gets a handful per window and
 * a 429 after. The counter lives in the function instance, which makes it a
 * per-instance brake rather than a guarantee — platform-level rules (Vercel's
 * firewall) are the real backstop — but it turns "curl in a loop" from a
 * flooded inbox into a trickle at zero infrastructure cost.
 */
const RATE_LIMIT = {
  WINDOW_MS: 10 * 60_000,
  MAX_PER_WINDOW: 6,
  /** The counter map is bounded; past this it forgets rather than grows. */
  MAX_TRACKED_SENDERS: 10_000,
};

/** @type {Map<string, { windowStart: number; count: number }>} */
const recentSenders = new Map();

/** @param {Request} request */
function senderAddress(request) {
  // The first hop in the forwarded chain is the caller as the platform saw it.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * @param {string} sender
 * @param {number} now
 */
function rateLimited(sender, now) {
  const held = recentSenders.get(sender);
  if (!held || now - held.windowStart >= RATE_LIMIT.WINDOW_MS) {
    if (recentSenders.size >= RATE_LIMIT.MAX_TRACKED_SENDERS) recentSenders.clear();
    recentSenders.set(sender, { windowStart: now, count: 1 });
    return false;
  }
  held.count += 1;
  return held.count > RATE_LIMIT.MAX_PER_WINDOW;
}

const FEEDBACK_KIND = {
  FEEDBACK: "feedback",
  PROMPT: "prompt",
};

const FEEDBACK_KINDS = Object.values(FEEDBACK_KIND);

const FEEDBACK_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/* The same bounds the composer and the app's trust boundary enforce; keep in
   step with `apps/desktop/src/shared/feedback.ts`. */
const FEEDBACK_LIMITS = {
  MESSAGE_MAX_LENGTH: 8_000,
  NAME_MAX_LENGTH: 120,
  EMAIL_MAX_LENGTH: 254,
  MAX_IMAGES: 3,
  IMAGE_MAX_BYTES: 900_000,
};

const SUBJECT_LINE = {
  [FEEDBACK_KIND.FEEDBACK]: "Luke feedback",
  [FEEDBACK_KIND.PROMPT]: "Luke prompt",
};

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** @param {string} base64 */
function decodedByteLength(base64) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/**
 * @param {unknown} value
 * @returns {{ name: string; mediaType: string; base64: string } | undefined}
 */
function feedbackImage(value) {
  if (value === null || typeof value !== "object") return undefined;
  const { name, mediaType, base64 } = /** @type {Record<string, unknown>} */ (value);
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 255) return undefined;
  if (typeof mediaType !== "string" || !FEEDBACK_IMAGE_TYPES.includes(mediaType)) return undefined;
  if (typeof base64 !== "string" || base64.length === 0) return undefined;
  if (!BASE64_PATTERN.test(base64)) return undefined;
  if (decodedByteLength(base64) > FEEDBACK_LIMITS.IMAGE_MAX_BYTES) return undefined;
  return { name: name.trim(), mediaType, base64 };
}

/*
 * A single line of credit: bounded, and never carrying a line break that could
 * reach a mail header. `null` means refused, `undefined` means not given.
 *
 * @param {unknown} value
 * @param {number} maxLength
 */
function optionalLine(value, maxLength) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Reads an untrusted request body into a submission, or nothing if malformed.
 *
 * @param {unknown} value
 */
function feedbackSubmission(value) {
  if (value === null || typeof value !== "object") return undefined;
  const { kind, message, name, email, images } = /** @type {Record<string, unknown>} */ (value);
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
  const parsedImages = [];
  for (const candidate of images) {
    const image = feedbackImage(candidate);
    if (!image) return undefined;
    parsedImages.push(image);
  }
  return {
    kind,
    message: messageText,
    ...(nameLine ? { name: nameLine } : {}),
    ...(emailLine ? { email: emailLine } : {}),
    images: parsedImages,
  };
}

/** @param {ReturnType<typeof feedbackSubmission> & object} submission */
function emailBody(submission) {
  const credit =
    submission.name || submission.email
      ? `From: ${[submission.name, submission.email].filter(Boolean).join(" — ")}`
      : "From: unsigned";
  return [submission.message, "", "—", credit, "Sent from the Luke panel."].join("\n");
}

/**
 * @param {number} status
 * @param {Record<string, unknown>} body
 */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** @param {Request} request */
export async function POST(request) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return json(503, { reason: "The feedback service is not configured." });
  if (rateLimited(senderAddress(request), Date.now())) {
    return json(429, { reason: "Too many submissions from this address. Try again later." });
  }

  let payload;
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

  let response;
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
        // Replying to the email answers the person who wrote it, when they
        // said who that is.
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
