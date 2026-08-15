/**
 * A note from the user to the people who make Luke. Two kinds, because they are
 * read differently on arrival: feedback is about Luke, and a prompt is an ask
 * Luke should have handled better. Both travel the same way — typed in the
 * panel, handed to the main process, and opened as a draft in the user's own
 * email client. Nothing observed ever rides along: a submission holds only
 * what the user typed and the names of screenshots they chose. The screenshots
 * themselves stay on this machine; mailto cannot attach them.
 */
export const FEEDBACK_KIND = {
  FEEDBACK: "feedback",
  PROMPT: "prompt",
} as const;

export type FeedbackKind = (typeof FEEDBACK_KIND)[keyof typeof FEEDBACK_KIND];

const FEEDBACK_KINDS: readonly string[] = Object.values(FEEDBACK_KIND);

export function isFeedbackKind(value: unknown): value is FeedbackKind {
  return typeof value === "string" && FEEDBACK_KINDS.includes(value);
}

/**
 * The tray's ask to open the composer, carried on the lifecycle bus the way
 * `tab:settings` is. Keyed by kind rather than composed from one, so no
 * identifier is ever interpolated into an event name.
 */
export const FEEDBACK_LIFECYCLE_EVENT: Record<FeedbackKind, string> = {
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
 * `image/*`: the renderer re-encodes what does not fit so the composer can
 * still preview it. The bytes never leave the renderer; mailto cannot attach
 * them, and the names are all the main process is told.
 */
export const FEEDBACK_IMAGE_TYPE = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
} as const;

export type FeedbackImageType = (typeof FEEDBACK_IMAGE_TYPE)[keyof typeof FEEDBACK_IMAGE_TYPE];

const FEEDBACK_IMAGE_TYPES: readonly string[] = Object.values(FEEDBACK_IMAGE_TYPE);

export function isFeedbackImageType(value: unknown): value is FeedbackImageType {
  return typeof value === "string" && FEEDBACK_IMAGE_TYPES.includes(value);
}

/**
 * Bounds on a submission, shared by the composer that refuses early and the
 * main process that refuses last. The image byte cap is on the encoded preview
 * the composer holds, not on anything that crosses IPC — the names are what
 * travel, so a huge screenshot cannot be smuggled out as payload.
 */
export const FEEDBACK_LIMITS = {
  MESSAGE_MAX_LENGTH: 8_000,
  NAME_MAX_LENGTH: 120,
  EMAIL_MAX_LENGTH: 254,
  MAX_IMAGES: 3,
  IMAGE_MAX_BYTES: 900_000,
  IMAGE_NAME_MAX_LENGTH: 255,
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
 * theirs to claim — and the names of screenshots they picked. The image bytes
 * stay in the renderer; a name is how the draft can ask the user to attach
 * the file in their email client rather than pretending it rode along.
 */
export interface FeedbackSubmission {
  kind: FeedbackKind;
  message: string;
  name?: string;
  email?: string;
  imageNames: readonly string[];
}

/** What became of a submission: the mail client opened, or why not, in the user's terms. */
export interface FeedbackResult {
  delivered: boolean;
  reason?: string;
}

function optionalLine(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  // One line of credit, not a second message: a name or address has no
  // business containing a line break, and stripping one quietly would sign
  // the message with something the user did not type.
  if (trimmed.length > maxLength || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

function imageName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > FEEDBACK_LIMITS.IMAGE_NAME_MAX_LENGTH) {
    return undefined;
  }
  // A filename in a mail body must stay one line: a break would look like a
  // second instruction, and stripping one quietly would name a file the user
  // did not pick.
  if (/[\r\n]/.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Reads a renderer message into a submission, or nothing if it is malformed.
 * This is a trust boundary: every field arrives as `unknown`, and a message
 * that fails here is a broken request rather than something a user can fix —
 * the composer enforces the same bounds with words before anything is sent.
 * A URL never arrives: the main process builds the mailto from this, and the
 * renderer names a note rather than an address.
 */
export function feedbackSubmission(value: unknown): FeedbackSubmission | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const { kind, message, name, email, imageNames } = value as Partial<FeedbackSubmission>;
  if (!isFeedbackKind(kind)) return undefined;
  if (typeof message !== "string") return undefined;
  const messageText = message.trim();
  if (messageText.length === 0 || messageText.length > FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH) {
    return undefined;
  }
  const nameLine = optionalLine(name, FEEDBACK_LIMITS.NAME_MAX_LENGTH);
  if (nameLine === null) return undefined;
  const emailLine = optionalLine(email, FEEDBACK_LIMITS.EMAIL_MAX_LENGTH);
  if (emailLine === null) return undefined;
  if (!Array.isArray(imageNames) || imageNames.length > FEEDBACK_LIMITS.MAX_IMAGES)
    return undefined;
  const parsedNames: string[] = [];
  for (const candidate of imageNames) {
    const parsed = imageName(candidate);
    if (!parsed) return undefined;
    parsedNames.push(parsed);
  }
  return {
    kind,
    message: messageText,
    ...(nameLine ? { name: nameLine } : {}),
    ...(emailLine ? { email: emailLine } : {}),
    imageNames: parsedNames,
  };
}
