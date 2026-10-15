import type { FeedbackImage } from "@luke/features/feedback";
import { FEEDBACK_IMAGE_TYPE, FEEDBACK_LIMITS, isFeedbackImageType } from "@luke/features/feedback";

/**
 * What becomes of a picked file: it rides as it is, it is re-encoded first, or
 * it cannot come. Decided from the type and size alone, before a canvas is
 * reached for.
 */
const IMAGE_INTAKE = {
  KEEP: "keep",
  RECODE: "recode",
  REFUSE: "refuse",
} as const;

type ImageIntake = (typeof IMAGE_INTAKE)[keyof typeof IMAGE_INTAKE];

/**
 * How a re-encode is drawn: scaled to fit the longest edge and written as
 * lossy WebP. Two rounds, because the first is quality worth keeping and the
 * second is the difference between a screenshot arriving smaller and not
 * arriving at all. A screenshot is mostly flat colour and text, which WebP
 * holds well at these settings.
 */
const RECODE_ROUNDS = [
  { maxEdge: 2000, quality: 0.82 },
  { maxEdge: 1400, quality: 0.6 },
] as const;

function imageIntake(
  file: { type: string; size: number },
  maxBytes: number,
  square: number | undefined,
): ImageIntake {
  // A square is always drawn, since a file kept as it is keeps its own shape.
  if (square !== undefined) {
    return file.type.startsWith("image/") ? IMAGE_INTAKE.RECODE : IMAGE_INTAKE.REFUSE;
  }
  // A format the submission carries natively rides untouched while it fits;
  // past the cap it is re-encoded rather than refused, because the cap exists
  // for a request-body limit the user should never have to think about.
  if (isFeedbackImageType(file.type)) {
    return file.size <= maxBytes ? IMAGE_INTAKE.KEEP : IMAGE_INTAKE.RECODE;
  }
  // Anything else the platform can decode — HEIC off a phone, a GIF — still
  // comes, as a re-encode. Only a file that is not an image at all is refused.
  return file.type.startsWith("image/") ? IMAGE_INTAKE.RECODE : IMAGE_INTAKE.REFUSE;
}

/** The recode writes WebP, so the name should stop promising the old format. */
function recodedImageName(name: string): string {
  const stem = name.replace(/\.[^.]*$/, "");
  return `${stem || "screenshot"}.webp`;
}

function base64FromBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // SAFETY: FileReader returns a data URL string when readAsDataURL succeeds.
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The part of the picture a round draws, by its left, top, width, and height, and the canvas it draws on. */
interface RecodeRegion {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly width: number;
  readonly height: number;
}

/**
 * What a round draws: the whole picture scaled to fit its longest edge, or,
 * for a square, the picture's centre square, its shorter side's length on
 * both, scaled to the square's edge, so a wide or tall picture loses its
 * ends rather than being squashed.
 */
function recodeRegion(
  bitmap: ImageBitmap,
  maxEdge: number,
  square: number | undefined,
): RecodeRegion {
  const { width, height } = bitmap;
  if (square === undefined) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return {
      sourceX: 0,
      sourceY: 0,
      sourceWidth: width,
      sourceHeight: height,
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }
  const shorter = Math.min(width, height);
  return {
    sourceX: (width - shorter) / 2,
    sourceY: (height - shorter) / 2,
    sourceWidth: shorter,
    sourceHeight: shorter,
    width: square,
    height: square,
  };
}

async function recodedImage(
  file: File,
  maxBytes: number,
  square: number | undefined,
): Promise<FeedbackImage | undefined> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const round of RECODE_ROUNDS) {
      const region = recodeRegion(bitmap, round.maxEdge, square);
      const canvas = document.createElement("canvas");
      canvas.width = region.width;
      canvas.height = region.height;
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      context.drawImage(
        bitmap,
        region.sourceX,
        region.sourceY,
        region.sourceWidth,
        region.sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, FEEDBACK_IMAGE_TYPE.WEBP, round.quality),
      );
      if (!blob) return undefined;
      if (blob.size > maxBytes) continue;
      return {
        name: recodedImageName(file.name),
        mediaType: FEEDBACK_IMAGE_TYPE.WEBP,
        base64: await base64FromBlob(blob),
      };
    }
    return undefined;
  } finally {
    bitmap.close();
  }
}

/**
 * Turns one picked or pasted file into an image of at most the bytes given,
 * or nothing if it cannot come: a feedback note's screenshot, a file on a
 * coding agent's message, or, given `square`, a workspace's photo, always
 * re-encoded as WebP to its centre square that many pixels a side.
 * Everything here happens on the user's machine: a file is only read,
 * scaled, and encoded — nothing leaves until the message it belongs to is
 * sent.
 */
export async function encodeImage(
  file: File,
  maxBytes: number = FEEDBACK_LIMITS.IMAGE_MAX_BYTES,
  square?: number,
): Promise<FeedbackImage | undefined> {
  const intake = imageIntake(file, maxBytes, square);
  if (intake === IMAGE_INTAKE.REFUSE) return undefined;
  try {
    if (intake === IMAGE_INTAKE.KEEP && isFeedbackImageType(file.type)) {
      return { name: file.name, mediaType: file.type, base64: await base64FromBlob(file) };
    }
    return await recodedImage(file, maxBytes, square);
  } catch {
    // A file the decoder refused — a corrupt image, a format Chromium cannot
    // read — is a refusal for the composer to word, not an error to surface.
    return undefined;
  }
}

/** The image files among whatever was pasted or dropped, in their given order. */
export function imageFiles(list: ArrayLike<File> | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((file) => file.type.startsWith("image/"));
}
