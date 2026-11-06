const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Vespin <feedback@vespin.dev>";

const FEEDBACK_SURVEY = {
  ID: "01a1a39c-6e8f-0000-b2a9-1c94c0673240",
  NAME: "Feedback",
  QUESTION_ID: "27a12623-8bc1-494c-a0b3-58bc910437ac",
  QUESTION: "What can we do to improve Vespin?",
  RESPONSE_KEY: "$survey_response_27a12623-8bc1-494c-a0b3-58bc910437ac",
};

const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";
const POSTHOG_CAPTURE_PATH = "/i/v0/e/";

const POSTHOG_TIMEOUT_MS = 5_000;

const RATE_LIMIT = {
  WINDOW_MS: 10 * 60_000,
  MAX_PER_WINDOW: 6,
  MAX_TRACKED_SENDERS: 10_000,
};

/** @type {Map<string, { windowStart: number; count: number }>} */
const recentSenders = new Map();

/** @param {Request} request */
function senderAddress(request) {
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

const EXPERIMENT_KEY_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

const FEEDBACK_LIMITS = {
  MESSAGE_MAX_LENGTH: 8_000,
  NAME_MAX_LENGTH: 120,
  EMAIL_MAX_LENGTH: 254,
  MAX_IMAGES: 3,
  IMAGE_MAX_BYTES: 900_000,
};

const SUBJECT_LINE = {
  [FEEDBACK_KIND.FEEDBACK]: "Feedback",
  [FEEDBACK_KIND.PROMPT]: "Prompt",
};

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** @param {string} base64 */
function decodedByteLength(base64) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

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

const IMAGE_EXTENSION = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return (
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

/** @param {unknown} value @returns {string | undefined} */
function readString(value) {
  if (Object.prototype.toString.call(value) !== "[object String]") return undefined;
  return /** @type {string} */ (value);
}

/**
 * @param {string} base64
 * @param {string} mediaType
 */
function carriesImageSignature(base64, mediaType) {
  const check = IMAGE_SIGNATURE[mediaType];
  if (!check) return false;
  return check(Buffer.from(base64.slice(0, 64), "base64"));
}

/**
 * @param {unknown} value
 * @returns {{ name: string; mediaType: string; base64: string } | undefined}
 */
function feedbackImage(value) {
  if (!isRecord(value)) return undefined;
  const name = readString(value.name);
  const mediaType = readString(value.mediaType);
  const base64 = readString(value.base64);
  if (!name || name.trim().length === 0 || name.length > 255) return undefined;
  if (!mediaType || !FEEDBACK_IMAGE_TYPES.includes(mediaType)) return undefined;
  if (!base64 || base64.length === 0) return undefined;
  if (!BASE64_PATTERN.test(base64)) return undefined;
  if (decodedByteLength(base64) > FEEDBACK_LIMITS.IMAGE_MAX_BYTES) return undefined;
  if (!carriesImageSignature(base64, mediaType)) return undefined;
  return { name: name.trim(), mediaType, base64 };
}

function isReplyableEmail(value) {
  const email = readString(value);
  return email !== undefined && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function optionalLine(value, maxLength) {
  if (value === undefined) return undefined;
  const text = readString(value);
  if (text === undefined) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

/** @param {unknown} value */
function feedbackSubmission(value) {
  if (!isRecord(value)) return undefined;
  const kind = readString(value.kind);
  const message = readString(value.message);
  if (!kind || !FEEDBACK_KINDS.includes(kind)) return undefined;
  if (!message) return undefined;
  const messageText = message.trim();
  if (messageText.length === 0 || messageText.length > FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH) {
    return undefined;
  }
  const nameLine = optionalLine(value.name, FEEDBACK_LIMITS.NAME_MAX_LENGTH);
  if (nameLine === null) return undefined;
  const emailLine = optionalLine(value.email, FEEDBACK_LIMITS.EMAIL_MAX_LENGTH);
  if (emailLine === null) return undefined;
  const images = value.images;
  if (!Array.isArray(images) || images.length > FEEDBACK_LIMITS.MAX_IMAGES) return undefined;
  const experiment = value.experiment === undefined ? undefined : readString(value.experiment);
  if (value.experiment !== undefined && !(experiment && EXPERIMENT_KEY_PATTERN.test(experiment))) {
    return undefined;
  }
  const parsedImages = [];
  for (const candidate of images) {
    const image = feedbackImage(candidate);
    if (!image) return undefined;
    parsedImages.push(image);
  }
  const submission = {
    kind,
    message: messageText,
    images: parsedImages,
  };
  if (nameLine) submission.name = nameLine;
  if (emailLine) submission.email = emailLine;
  if (experiment) submission.experiment = experiment;
  return submission;
}

/** @param {ReturnType<typeof feedbackSubmission> & object} submission */
function emailBody(submission) {
  const credit =
    submission.name || submission.email
      ? `From: ${[submission.name, submission.email].filter(Boolean).join(" — ")}`
      : "From: unsigned";
  return [submission.message, "", "—", credit, "Sent from the panel."].join("\n");
}

/**
 * @param {ReturnType<typeof feedbackSubmission> & object} submission
 * @param {string} apiKey
 */
function surveyResponse(submission, apiKey) {
  const submissionId = crypto.randomUUID();
  return {
    api_key: apiKey,
    event: "survey sent",
    distinct_id: `feedback-${submissionId}`,
    properties: {
      $survey_id: FEEDBACK_SURVEY.ID,
      $survey_name: FEEDBACK_SURVEY.NAME,
      $survey_submission_id: submissionId,
      $survey_completed: true,
      $survey_questions: [
        {
          id: FEEDBACK_SURVEY.QUESTION_ID,
          question: FEEDBACK_SURVEY.QUESTION,
          response: submission.message,
        },
      ],
      [FEEDBACK_SURVEY.RESPONSE_KEY]: submission.message,
      feedback_kind: submission.kind,
      feedback_name: submission.name ?? null,
      feedback_email: submission.email ?? null,
      feedback_experiment: submission.experiment ?? null,
      feedback_screenshot_count: submission.images.length,
      environment: process.env.VERCEL_ENV?.trim() || "development",
      $process_person_profile: false,
      $geoip_disable: true,
    },
  };
}

/** @param {ReturnType<typeof feedbackSubmission> & object} submission */
async function recordSurveyResponse(submission) {
  const apiKey = process.env.POSTHOG_PROJECT_API_KEY?.trim();
  if (!apiKey) return;
  const host = process.env.POSTHOG_HOST?.trim() || POSTHOG_DEFAULT_HOST;
  try {
    const response = await fetch(new URL(POSTHOG_CAPTURE_PATH, host), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(surveyResponse(submission, apiKey)),
      signal: AbortSignal.timeout(POSTHOG_TIMEOUT_MS),
    });
    if (!response.ok)
      console.error(`Feedback survey response failed with status ${response.status}`);
  } catch {
    console.error("Feedback survey response did not reach PostHog");
  }
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
  const topic = submission.experiment
    ? `${SUBJECT_LINE[submission.kind]} on the ${submission.experiment} experiment`
    : SUBJECT_LINE[submission.kind];
  const subject = signature ? `${topic} from ${signature}` : topic;

  let response;
  try {
    const mailBody = {
      from: process.env.FEEDBACK_FROM?.trim() || DEFAULT_FROM,
      to: [destination],
      subject,
      text: emailBody(submission),
    };
    if (isReplyableEmail(submission.email)) {
      mailBody.reply_to = [submission.email];
    }
    if (submission.images.length > 0) {
      mailBody.attachments = submission.images.map((image, index) => ({
        filename: `screenshot-${index + 1}.${IMAGE_EXTENSION[image.mediaType]}`,
        content: image.base64,
      }));
    }
    response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(mailBody),
    });
  } catch {
    console.error("Feedback forwarding did not reach the mail service");
    return json(502, { reason: "The mail service could not be reached." });
  }

  if (!response.ok) {
    console.error(`Feedback forwarding failed with status ${response.status}`);
    return json(502, { reason: "The mail service refused this submission." });
  }
  await recordSurveyResponse(submission);
  return json(200, { delivered: true });
}
