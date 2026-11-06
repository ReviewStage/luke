import type { FeedbackImage } from "@repo/features/feedback";
import { FEEDBACK_IMAGE_TYPE, FEEDBACK_LIMITS, isFeedbackImageType } from "@repo/features/feedback";

const IMAGE_INTAKE = {
  KEEP: "keep",
  RECODE: "recode",
  REFUSE: "refuse",
} as const;

type ImageIntake = (typeof IMAGE_INTAKE)[keyof typeof IMAGE_INTAKE];

const RECODE_ROUNDS = [
  { maxEdge: 2000, quality: 0.82 },
  { maxEdge: 1400, quality: 0.6 },
] as const;

function imageIntake(
  file: { type: string; size: number },
  maxBytes: number,
  square: number | undefined,
): ImageIntake {
  if (square !== undefined) {
    return file.type.startsWith("image/") ? IMAGE_INTAKE.RECODE : IMAGE_INTAKE.REFUSE;
  }
  if (isFeedbackImageType(file.type)) {
    return file.size <= maxBytes ? IMAGE_INTAKE.KEEP : IMAGE_INTAKE.RECODE;
  }
  return file.type.startsWith("image/") ? IMAGE_INTAKE.RECODE : IMAGE_INTAKE.REFUSE;
}

function recodedImageName(name: string): string {
  const stem = name.replace(/\.[^.]*$/, "");
  return `${stem || "screenshot"}.webp`;
}

function base64FromBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

interface RecodeRegion {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly width: number;
  readonly height: number;
}

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
    return undefined;
  }
}

export function imageFiles(list: ArrayLike<File> | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((file) => file.type.startsWith("image/"));
}
