import {
  WORKSPACE_PHOTO_BOUNDS,
  WORKSPACE_PHOTO_TYPE,
  workspacePhotoOfDataUrl,
} from "@repo/features/workspace-wire";
import { encodeImage } from "./feedback-images.js";

/**
 * workspace-photo.ts -- a picked file read into a workspace's photo, as Settings' Workspace page and setup's team step both set one.
 */

/** How many pixels a side a workspace's photo is drawn to before it is sent: well past the largest tile's 32, so it stays sharp on a Retina screen. */
const PHOTO_EDGE = 256;

/** The image types a photo is picked from, which are the ones a photo may be kept as. */
const PHOTO_TYPES: ReadonlySet<string> = new Set(Object.values(WORKSPACE_PHOTO_TYPE));

/** The photo picker's `accept`: those types alone. */
export const PHOTO_ACCEPT = [...PHOTO_TYPES].join(",");

/** Why a picked file did not become the workspace's photo, in the words said under its row. */
const PHOTO_REFUSAL = {
  KIND: (name: string) => `${name} isn't a PNG, JPEG, or WebP image.`,
  UNREADABLE: (name: string) => `${name} could not be read.`,
  TOO_LARGE: (name: string) => `${name} is too large for a workspace photo.`,
} as const;

/** A picked file read into a workspace's photo: the `data:` URL to send, or why it cannot be one. */
export type PhotoRead = { readonly photo: string } | { readonly refusal: string };

/**
 * A picked file drawn as a workspace's photo on this machine: its centre
 * square at `PHOTO_EDGE` pixels a side, written as WebP. Note that it is
 * encoded with no bound of its own, because a photo past the service's is
 * said as too large rather than as a file that could not be read.
 */
export async function photoOfFile(file: File): Promise<PhotoRead> {
  if (!PHOTO_TYPES.has(file.type)) return { refusal: PHOTO_REFUSAL.KIND(file.name) };
  const image = await encodeImage(file, Number.POSITIVE_INFINITY, PHOTO_EDGE);
  if (image === undefined) return { refusal: PHOTO_REFUSAL.UNREADABLE(file.name) };
  const photo = `data:${image.mediaType};base64,${image.base64}`;
  const bytes = workspacePhotoOfDataUrl(photo)?.bytes.length;
  if (bytes === undefined) return { refusal: PHOTO_REFUSAL.UNREADABLE(file.name) };
  if (bytes > WORKSPACE_PHOTO_BOUNDS.MAX_BYTES) {
    return { refusal: PHOTO_REFUSAL.TOO_LARGE(file.name) };
  }
  return { photo };
}
