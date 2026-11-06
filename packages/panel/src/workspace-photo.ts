import {
  WORKSPACE_PHOTO_BOUNDS,
  WORKSPACE_PHOTO_TYPE,
  workspacePhotoOfDataUrl,
} from "@repo/features/workspace-wire";
import { type FilePicker, useFilePicker } from "@repo/ui";
import { useRef, useState } from "react";
import { encodeImage } from "./feedback-images.js";

const PHOTO_EDGE = 256;

const PHOTO_TYPES: ReadonlySet<string> = new Set(Object.values(WORKSPACE_PHOTO_TYPE));

export const PHOTO_ACCEPT = [...PHOTO_TYPES].join(",");

const PHOTO_REFUSAL = {
  KIND: (name: string) => `${name} isn't a PNG, JPEG, or WebP image.`,
  UNREADABLE: (name: string) => `${name} could not be read.`,
  TOO_LARGE: (name: string) => `${name} is too large for a workspace photo.`,
} as const;

export type PhotoRead = { readonly photo: string } | { readonly refusal: string };

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

export interface WorkspacePhotoPick {
  readonly photo: string | undefined;
  readonly reading: boolean;
  readonly picker: FilePicker;
  readonly clear: () => void;
}

export function useWorkspacePhotoPick(
  onRefusal: (refusal: string | undefined) => void,
): WorkspacePhotoPick {
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [reading, setReading] = useState(false);
  const picks = useRef(0);
  const picker = useFilePicker({
    accept: PHOTO_ACCEPT,
    onFiles: ([picked]) => {
      if (picked === undefined) return;
      picks.current += 1;
      const asked = picks.current;
      setReading(true);
      photoOfFile(picked).then((read) => {
        if (picks.current !== asked) return;
        setReading(false);
        if ("refusal" in read) onRefusal(read.refusal);
        else {
          onRefusal(undefined);
          setPhoto(read.photo);
        }
      });
    },
  });
  return {
    photo,
    reading,
    picker,
    clear: () => {
      picks.current += 1;
      setReading(false);
      setPhoto(undefined);
    },
  };
}
