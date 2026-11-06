import { isRecord, isWireString, type UnparsedWireValue } from "@repo/wire";
import { Option, Schema } from "effect";
import { PICTURE_TYPE, type PictureType } from "../picture-wire.js";

export const FEEDBACK_KIND = {
  FEEDBACK: "feedback",
  PROMPT: "prompt",
} as const;

export type FeedbackKind = (typeof FEEDBACK_KIND)[keyof typeof FEEDBACK_KIND];

export const FEEDBACK_IMAGE_TYPE = PICTURE_TYPE;

type FeedbackImageType = PictureType;

const FEEDBACK_IMAGE_TYPES: readonly string[] = Object.values(FEEDBACK_IMAGE_TYPE);

export function isFeedbackImageType(value: UnparsedWireValue): value is FeedbackImageType {
  return isWireString(value) && FEEDBACK_IMAGE_TYPES.includes(value);
}

export const FEEDBACK_LIMITS = {
  MESSAGE_MAX_LENGTH: 8_000,
  NAME_MAX_LENGTH: 120,
  EMAIL_MAX_LENGTH: 254,
  MAX_IMAGES: 3,
  IMAGE_MAX_BYTES: 900_000,
} as const;

export interface FeedbackImage {
  name: string;
  mediaType: FeedbackImageType;
  base64: string;
}

export interface FeedbackSubmission {
  kind: FeedbackKind;
  message: string;
  name?: string;
  email?: string;
  images: readonly FeedbackImage[];
  experiment?: string;
}

const EXPERIMENT_KEY_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

export interface FeedbackResult {
  delivered: boolean;
  reason?: string;
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodedByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

function creditLineSchema(maxLength: number) {
  return Schema.Trim.check(
    Schema.isMaxLength(maxLength),
    Schema.makeFilter((line: string) => !/[\r\n]/.test(line)),
  );
}

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
