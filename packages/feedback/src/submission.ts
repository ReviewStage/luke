import { isRecord, isWireString, type UnparsedWireValue } from "@sidecar/wire";
/**
 * A note from the user to the people who make Luke. Two kinds, because they are
 * read differently on arrival: feedback is about Luke, and a prompt is an ask
 * Luke should have handled better. Both travel the same way — typed in the
 * panel, carried by the main process to one fixed endpoint, and forwarded from
 * there as email to the founders. Nothing observed ever rides along: a
 * submission holds only what the composer's fields showed the user — their
 * words, the signature those fields started with from their own signed-in
 * account and left theirs to edit or clear, and the screenshots they chose.
 */
export const FEEDBACK_KIND = {
  FEEDBACK: "feedback",
  PROMPT: "prompt",
} as const;

export type FeedbackKind = (typeof FEEDBACK_KIND)[keyof typeof FEEDBACK_KIND];

const FEEDBACK_KINDS: readonly string[] = Object.values(FEEDBACK_KIND);

export function isFeedbackKind(value: UnparsedWireValue): value is FeedbackKind {
  return isWireString(value) && FEEDBACK_KINDS.includes(value);
}

/**
 * A spoken ask to open the composer, carried on the lifecycle bus the way
 * `tab:settings` is. Keyed by kind rather than composed from one, so no
 * identifier is ever interpolated into an event name.
 */
export const FEEDBACK_LIFECYCLE_EVENT = {
  [FEEDBACK_KIND.FEEDBACK]: "feedback:feedback",
  [FEEDBACK_KIND.PROMPT]: "feedback:prompt",
};

export function feedbackKindForLifecycleEvent(eventName: string): FeedbackKind | undefined {
  if (eventName === FEEDBACK_LIFECYCLE_EVENT[FEEDBACK_KIND.FEEDBACK]) {
    return FEEDBACK_KIND.FEEDBACK;
  }
  if (eventName === FEEDBACK_LIFECYCLE_EVENT[FEEDBACK_KIND.PROMPT]) return FEEDBACK_KIND.PROMPT;
  return undefined;
}

/**
 * The image formats a screenshot arrives in. A fixed set rather than anything
 * `image/*`: the renderer re-encodes what does not fit, and the endpoint that
 * turns a submission into email forwards these types blind.
 */
export const FEEDBACK_IMAGE_TYPE = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
} as const;

export type FeedbackImageType = (typeof FEEDBACK_IMAGE_TYPE)[keyof typeof FEEDBACK_IMAGE_TYPE];

const FEEDBACK_IMAGE_TYPES: readonly string[] = Object.values(FEEDBACK_IMAGE_TYPE);

export function isFeedbackImageType(value: UnparsedWireValue): value is FeedbackImageType {
  return isWireString(value) && FEEDBACK_IMAGE_TYPES.includes(value);
}

/**
 * Bounds on a submission, shared by the composer that refuses early and the
 * main process that refuses last. The image byte cap is on the encoded bytes,
 * and the whole set has to clear a serverless request-body limit of about
 * four megabytes once base64 has inflated it by a third — which is why the
 * composer re-encodes a screenshot rather than asking anyone to shrink one.
 */
export const FEEDBACK_LIMITS = {
  MESSAGE_MAX_LENGTH: 8_000,
  NAME_MAX_LENGTH: 120,
  EMAIL_MAX_LENGTH: 254,
  MAX_IMAGES: 3,
  IMAGE_MAX_BYTES: 900_000,
} as const;

/** One attached screenshot: the file's own name — never a path — and its bytes. */
export interface FeedbackImage {
  name: string;
  mediaType: FeedbackImageType;
  /** Base64 of the encoded image, without any data-URL prefix. */
  base64: string;
}

/**
 * What the panel sends: the message, the kind it was written as, the name and
 * address the user chose to sign it with — both optional, because credit is
 * theirs to claim — and the screenshots they attached.
 */
export interface FeedbackSubmission {
  kind: FeedbackKind;
  message: string;
  name?: string;
  email?: string;
  images: readonly FeedbackImage[];
}

/** What became of a submission: delivered, or why not, in the user's terms. */
export interface FeedbackResult {
  delivered: boolean;
  reason?: string;
}

/** Standard base64: whole quartets of the alphabet, padded or not at the end. */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodedByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

function feedbackImage(value: UnparsedWireValue): FeedbackImage | undefined {
  if (!isRecord(value)) return undefined;
  const { name, mediaType, base64 } = value;
  if (!isWireString(name) || name.trim().length === 0 || name.length > 255) return undefined;
  if (!isFeedbackImageType(mediaType)) return undefined;
  if (!isWireString(base64) || base64.length === 0) return undefined;
  if (!BASE64_PATTERN.test(base64)) return undefined;
  if (decodedByteLength(base64) > FEEDBACK_LIMITS.IMAGE_MAX_BYTES) return undefined;
  return { name: name.trim(), mediaType, base64 };
}

function optionalLine(value: UnparsedWireValue, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (!isWireString(value)) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  // One line of credit, not a second message: a name or address has no
  // business containing a line break, and stripping one quietly would sign
  // the message with something the user did not type.
  if (trimmed.length > maxLength || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Reads a renderer message into a submission, or nothing if it is malformed.
 * This is a trust boundary: every field arrives as `unknown`, and a message
 * that fails here is a broken request rather than something a user can fix —
 * the composer enforces the same bounds with words before anything is sent.
 */
export function feedbackSubmission(value: UnparsedWireValue): FeedbackSubmission | undefined {
  if (!isRecord(value)) return undefined;
  const { kind, message, name, email, images } = value;
  if (!isFeedbackKind(kind)) return undefined;
  if (!isWireString(message)) return undefined;
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
    kind,
    message: messageText,
    ...(nameLine ? { name: nameLine } : undefined),
    ...(emailLine ? { email: emailLine } : undefined),
    images: parsedImages,
  };
}
