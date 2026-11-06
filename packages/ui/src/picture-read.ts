import { FAILURE_CONDITION } from "@repo/features/shown-failure";
import { type QueryKey, type UseQueryOptions, useQuery } from "@tanstack/react-query";
import type { ReportedFailure } from "./reported-failure.js";

export const PICTURE_STATE = {
  READING: "reading",
  READY: "ready",
  MISSING: "missing",
  FAILED: "failed",
} as const;

export type PictureRead =
  | { readonly kind: typeof PICTURE_STATE.READY; readonly url: string }
  | { readonly kind: typeof PICTURE_STATE.MISSING };

export type PictureState =
  | PictureRead
  | { readonly kind: typeof PICTURE_STATE.READING }
  | {
      readonly kind: typeof PICTURE_STATE.FAILED;
      readonly retry: () => void;
      readonly failure: ReportedFailure;
    };

export interface PictureUnread {
  readonly code: typeof FAILURE_CONDITION.UNREAD;
  readonly cause: Error;
}

export type PictureAnswer =
  | { readonly contentType: string; readonly base64: string }
  | { readonly failure: string; readonly cause?: unknown };

const NOT_FOUND_FAILURE = "not-found";

const READING: PictureState = { kind: PICTURE_STATE.READING };

const unreads = new WeakMap<Error, PictureUnread>();

function unreadOf(error: Error): PictureUnread {
  const unread = unreads.get(error) ?? { code: FAILURE_CONDITION.UNREAD, cause: error };
  unreads.set(error, unread);
  return unread;
}

export function readPicture(answer: Promise<PictureAnswer>): Promise<PictureRead> {
  return answer.then((answered): PictureRead => {
    if (!("failure" in answered)) {
      return {
        kind: PICTURE_STATE.READY,
        url: `data:${answered.contentType};base64,${answered.base64}`,
      };
    }
    if (answered.failure === NOT_FOUND_FAILURE) return { kind: PICTURE_STATE.MISSING };
    throw new Error(
      answered.failure,
      answered.cause === undefined ? undefined : { cause: answered.cause },
    );
  });
}

export function pictureStateOf(read: PictureRead | undefined): PictureState {
  return read ?? READING;
}

export function usePicture<Key extends QueryKey>(
  query: UseQueryOptions<PictureRead, Error, PictureRead, Key>,
  failure: (unread: PictureUnread) => ReportedFailure,
): PictureState {
  const { data, error, isFetching, refetch } = useQuery(query);
  if (data !== undefined) return data;
  if (error === null || isFetching) return READING;
  return {
    kind: PICTURE_STATE.FAILED,
    retry: () => {
      void refetch();
    },
    failure: failure(unreadOf(error)),
  };
}
