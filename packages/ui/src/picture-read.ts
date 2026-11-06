import { FAILURE_CONDITION } from "@repo/features/shown-failure";
import { type QueryKey, type UseQueryOptions, useQuery } from "@tanstack/react-query";
import type { ReportedFailure } from "./reported-failure.js";

/**
 * picture-read.ts -- a picture's read as TanStack Query keeps it: what its answer lands as, and where it stands as the place drawing it sees it.
 *
 * A picture is named by what it belongs to, a plan say, and its own id
 * there, and its bytes never change under that id: a new picture is a new
 * id. So the app keeps each under a query of those ids that never goes
 * stale, read once and shared by every place drawing it, and let go of a
 * while after the last of them is gone (its `gcTime`). The bytes arrive in
 * base64 and are drawn from a `data:` URL of the window's own making, which
 * the window's policy allows where it refuses any other address. A picture
 * the reader cannot reach, or whose bytes are gone, lands as missing; a read
 * that did not land keeps nothing, so the next place to mount reads it
 * again, and the place that asked draws it as failed, with the retry that
 * reads it again there, and the failure beneath it as the place reports it.
 * Nothing here knows whose pictures they are: the app hands the query, its
 * key and its read, and what a read that did not land is reported as.
 */

/** Where a picture's read stands: still out, landed as its `data:` URL, answered as none, or not landed this time. */
export const PICTURE_STATE = {
  READING: "reading",
  READY: "ready",
  MISSING: "missing",
  FAILED: "failed",
} as const;

/** What a picture's read lands as, the data its query keeps: its `data:` URL, or none, as a picture gone answers. */
export type PictureRead =
  | { readonly kind: typeof PICTURE_STATE.READY; readonly url: string }
  | { readonly kind: typeof PICTURE_STATE.MISSING };

export type PictureState =
  | PictureRead
  | { readonly kind: typeof PICTURE_STATE.READING }
  | {
      readonly kind: typeof PICTURE_STATE.FAILED;
      /** Reads the picture again, as the place drawing it asked for it the first time. */
      readonly retry: () => void;
      /** The read that did not land, as the place drawing it reports it. */
      readonly failure: ReportedFailure;
    };

/** A picture's read that did not land, one for each attempt, as a place reporting it takes it: its condition, as its code. */
export interface PictureUnread {
  readonly code: typeof FAILURE_CONDITION.UNREAD;
}

/** What a read answers: the bytes in base64 under their type, or why there are none, `NOT_FOUND_FAILURE` among them. */
export type PictureAnswer =
  | { readonly contentType: string; readonly base64: string }
  | { readonly failure: string };

/** The failure that settles a picture as missing; any other leaves it to be read again. */
const NOT_FOUND_FAILURE = "not-found";

const READING: PictureState = { kind: PICTURE_STATE.READING };

/** Each failed attempt's failure, by the error its read rejected with, which every place drawing the picture shares. */
const unreads = new WeakMap<Error, PictureUnread>();

/** The failure of the attempt that rejected with `error`, the same one for as long as that attempt stands. */
function unreadOf(error: Error): PictureUnread {
  const unread = unreads.get(error) ?? { code: FAILURE_CONDITION.UNREAD };
  unreads.set(error, unread);
  return unread;
}

/**
 * What `answer` lands as: drawn, or settled as missing. Any other failure
 * rejects, so the query keeps nothing and the picture is read again.
 */
export function readPicture(answer: Promise<PictureAnswer>): Promise<PictureRead> {
  return answer.then((answered): PictureRead => {
    if (!("failure" in answered)) {
      return {
        kind: PICTURE_STATE.READY,
        url: `data:${answered.contentType};base64,${answered.base64}`,
      };
    }
    if (answered.failure === NOT_FOUND_FAILURE) return { kind: PICTURE_STATE.MISSING };
    throw new Error(answered.failure);
  });
}

/** Where a picture kept as `read` stands, without reading it: reading where it has not landed. */
export function pictureStateOf(read: PictureRead | undefined): PictureState {
  return read ?? READING;
}

/**
 * The picture as the place drawing it sees it: reading until its query
 * lands, then its `data:` URL, or missing. A read that did not land draws
 * as failed until its retry reads it again, which draws as reading while it
 * is out; each attempt that fails is a failure of its own.
 */
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
