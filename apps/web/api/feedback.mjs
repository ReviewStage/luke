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
 * Deployment needs two values: `RESEND_API_KEY`, a Resend key for a domain
 * verified to send as the `from` address, and `FEEDBACK_TO`, the inbox
 * submissions are forwarded to — held in the deployment rather than this
 * public repository, so the address cannot be scraped from source.
 * `FEEDBACK_FROM` may override the sender. Without either required value the
 * endpoint answers 503 and the composer reports the service unavailable;
 * nothing else about the app depends on it.
 */

const RESEND_URL = "https://api.resend.com/emails";
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
  // `x-real-ip` is the client as Vercel itself saw it, set by the platform
  // and not forwardable past it. The forwarded chain is only a fallback for
  // running the function elsewhere: its first hop is client-controlled, so a
  // brake keyed on it alone could be rotated past with forged addresses.
  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
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
 * The bytes every claimed format is required to open with. A public endpoint
 * relaying attachments from a trusted sender must not take a media type at
 * its word: content that does not carry its format's own signature is refused,
 * so arbitrary binaries cannot ride out under an image's name.
 */
const IMAGE_SIGNATURE = {
  "image/png": (bytes) =>
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a,
  "image/jpeg": (bytes) =>
    bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/webp": (bytes) =>
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50,
};

/** What each verified format's attachment is named; the extension is ours. */
const IMAGE_EXTENSION = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * @param {string} base64
 * @param {string} mediaType
 */
function carriesImageSignature(base64, mediaType) {
  const check = IMAGE_SIGNATURE[mediaType];
  if (!check) return false;
  // The first sixteen encoded quartets decode to the leading bytes, which is
  // all any signature needs.
  return check(Buffer.from(base64.slice(0, 64), "base64"));
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
  if (!carriesImageSignature(base64, mediaType)) return undefined;
  return { name: name.trim(), mediaType, base64 };
}

/**
 * Whether an optional credit address is shaped like one worth handing Resend
 * as a reply-to. A typo here must not cost the message itself: an address
 * that fails this still rides in the body's credit line, and only the
 * reply-to header goes without.
 */
function isReplyableEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
  const destination = process.env.FEEDBACK_TO?.trim();
  if (!apiKey || !destination) {
    return json(503, { reason: "The feedback service is not configured." });
  }
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
        to: [destination],
        subject,
        text: emailBody(submission),
        // Replying to the email answers the person who wrote it, when they
        // said who that is — and only when the address is shaped like one:
        // a typo in an optional field must not cost the message itself.
        ...(isReplyableEmail(submission.email) ? { reply_to: [submission.email] } : {}),
        ...(submission.images.length > 0
          ? {
              // Named by this endpoint, not by the sender: the user's own
              // filename stays in the body of their note if they typed it
              // anywhere, and the attachment carries a name whose extension
              // is the verified format's own.
              attachments: submission.images.map((image, index) => ({
                filename: `screenshot-${index + 1}.${IMAGE_EXTENSION[image.mediaType]}`,
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
