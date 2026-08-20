import type { FeedbackImage } from "@sidecar/feedback";
import { FEEDBACK_IMAGE_TYPE, FEEDBACK_LIMITS, isFeedbackImageType } from "@sidecar/feedback";

/**
 * What becomes of a picked file: it rides as it is, it is re-encoded first, or
 * it cannot come. Decided from the type and size alone, so the decision is
 * testable without a canvas.
 */
export const IMAGE_INTAKE = {
  KEEP: "keep",
  RECODE: "recode",
  REFUSE: "refuse",
} as const;

export type ImageIntake = (typeof IMAGE_INTAKE)[keyof typeof IMAGE_INTAKE];

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

export function imageIntake(file: { type: string; size: number }): ImageIntake {
  // A format the submission carries natively rides untouched while it fits;
  // past the cap it is re-encoded rather than refused, because the cap exists
  // for a request-body limit the user should never have to think about.
  if (isFeedbackImageType(file.type)) {
    return file.size <= FEEDBACK_LIMITS.IMAGE_MAX_BYTES ? IMAGE_INTAKE.KEEP : IMAGE_INTAKE.RECODE;
  }
  // Anything else the platform can decode — HEIC off a phone, a GIF — still
  // comes, as a re-encode. Only a file that is not an image at all is refused.
  return file.type.startsWith("image/") ? IMAGE_INTAKE.RECODE : IMAGE_INTAKE.REFUSE;
}

/** The recode writes WebP, so the name should stop promising the old format. */
export function recodedImageName(name: string): string {
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

async function recodedImage(file: File): Promise<FeedbackImage | undefined> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const round of RECODE_ROUNDS) {
      const scale = Math.min(1, round.maxEdge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, FEEDBACK_IMAGE_TYPE.WEBP, round.quality),
      );
      if (!blob) return undefined;
      if (blob.size > FEEDBACK_LIMITS.IMAGE_MAX_BYTES) continue;
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
 * Turns one picked or pasted file into an attachment, or nothing if it cannot
 * come. Everything here happens on the user's machine: a file is only read,
 * scaled, and encoded — nothing leaves until the note it belongs to is sent.
 */
export async function encodeFeedbackImage(file: File): Promise<FeedbackImage | undefined> {
  const intake = imageIntake(file);
  if (intake === IMAGE_INTAKE.REFUSE) return undefined;
  try {
    if (intake === IMAGE_INTAKE.KEEP && isFeedbackImageType(file.type)) {
      return { name: file.name, mediaType: file.type, base64: await base64FromBlob(file) };
    }
    return await recodedImage(file);
  } catch {
    // A file the decoder refused — a corrupt image, a format Chromium cannot
    // read — is a refusal for the composer to word, not an error to surface.
    return undefined;
  }
}

/** The image files among whatever was pasted or dropped, in their given order. */
export function imageFiles(list: FileList | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((file) => file.type.startsWith("image/"));
}
