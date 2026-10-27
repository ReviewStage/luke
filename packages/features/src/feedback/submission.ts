import { isRecord, isWireString, type UnparsedWireValue } from "@luke/wire";
import { Option, Schema } from "effect";
import { PICTURE_TYPE, type PictureType } from "../picture-wire.js";

/**
 * A note from the user to the people who make Luke. Two kinds, because they are
 * read differently on arrival: feedback is about Luke, and a prompt is an ask
 * Luke should have handled better. Both travel the same way — typed in the
 * panel, carried by the main process to one fixed endpoint, and forwarded from
 * there as email to the founders. Nothing observed ever rides along: a
 * submission holds only what the dialog showed the user — their words, their
 * signed-in account's name and address while they left "Include my name and
 * email" ticked, and the screenshots they chose.
 */
export const FEEDBACK_KIND = {
  FEEDBACK: "feedback",
  PROMPT: "prompt",
} as const;

export type FeedbackKind = (typeof FEEDBACK_KIND)[keyof typeof FEEDBACK_KIND];

/**
 * The image formats a screenshot arrives in. A fixed set rather than anything
 * `image/*`: the renderer re-encodes what does not fit, and the endpoint that
 * turns a submission into email forwards these types blind.
 */
export const FEEDBACK_IMAGE_TYPE = PICTURE_TYPE;

type FeedbackImageType = PictureType;

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
  /**
   * The experiment a note is about, by its key, where it was sent from that
   * experiment's row in Settings › Experimental. A fixed key, never prose:
   * this package sits below the settings vocabulary that lists them, so it
   * holds the key to a key's shape (`EXPERIMENT_KEY_PATTERN`).
   */
  experiment?: string;
}

/** An experiment key's shape: lowercase words joined by hyphens, as `@luke/settings`'s `EXPERIMENT` spells them. */
const EXPERIMENT_KEY_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

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

/** One line of credit, trimmed: not a second message, so a line break refuses it rather than being stripped into something the user did not type. */
function creditLineSchema(maxLength: number) {
  return Schema.Trim.check(
    Schema.isMaxLength(maxLength),
    Schema.makeFilter((line: string) => !/[\r\n]/.test(line)),
  );
}

/** One screenshot as it arrives: a name with something in it, a fixed type, and bounded base64. */
const feedbackImageSchema = Schema.Struct({
  name: Schema.String.check(
    Schema.isMaxLength(255),
    Schema.makeFilter((name: string) => name.trim().length > 0),
  ),
  mediaType: Schema.Literals(Object.values(FEEDBACK_IMAGE_TYPE)),
  base64: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isPattern(BASE64_PATTERN),
    Schema.makeFilter(
      (base64: string) => decodedByteLength(base64) <= FEEDBACK_LIMITS.IMAGE_MAX_BYTES,
    ),
  ),
});

/**
 * A submission as the window sends it. A name or an address may be absent,
 * `undefined`, or blank, each read as unsigned; anything else that is no
 * string, `null` among it, refuses the whole message.
 */
const feedbackSubmissionSchema = Schema.Struct({
  kind: Schema.Literals(Object.values(FEEDBACK_KIND)),
  message: Schema.Trim.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH),
  ),
  name: Schema.optional(creditLineSchema(FEEDBACK_LIMITS.NAME_MAX_LENGTH)),
  email: Schema.optional(creditLineSchema(FEEDBACK_LIMITS.EMAIL_MAX_LENGTH)),
  images: Schema.Array(feedbackImageSchema).check(Schema.isMaxLength(FEEDBACK_LIMITS.MAX_IMAGES)),
  experiment: Schema.optional(Schema.String.check(Schema.isPattern(EXPERIMENT_KEY_PATTERN))),
});

const readFeedbackSubmission = Schema.decodeUnknownOption(feedbackSubmissionSchema);

/**
 * Reads a renderer message into a submission, or nothing if it is malformed.
 * This is a trust boundary: every field arrives as `unknown`, and a message
 * that fails here is a broken request rather than something a user can fix —
 * the composer enforces the same bounds with words before anything is sent.
 */
export function feedbackSubmission(value: UnparsedWireValue): FeedbackSubmission | undefined {
  if (!isRecord(value)) return undefined;
  const read = Option.getOrUndefined(readFeedbackSubmission(value));
  if (read === undefined) return undefined;
  const { kind, message, name, email, images, experiment } = read;
  return {
    kind,
    message,
    ...(name ? { name } : undefined),
    ...(email ? { email } : undefined),
    images: images.map((image) => ({ ...image, name: image.name.trim() })),
    ...(experiment === undefined ? undefined : { experiment }),
  };
}
