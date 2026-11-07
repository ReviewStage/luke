/**
 * picture-query.ts -- the query a picture is read and kept under, by what it belongs to and its id there, and the window's ways into those it keeps.
 *
 * A picture's bytes never change under its id (`@repo/ui/picture-read`), so
 * its query never goes stale (`staleTime: Infinity`) and is let go of by
 * time alone, the client's `gcTime` after the last place drawing it is
 * gone. A read that did not land is not tried again behind the place's
 * back (`retry: false`), since that place draws it as failed with a Retry
 * of its own. Its key is the picture's ids alone, never how it is read:
 * an agent's, a plan's, and a GitHub picture each hand their own read.
 */

import {
  PICTURE_STATE,
  type PictureAnswer,
  type PictureRead,
  type PictureState,
  pictureStateOf,
  readPicture,
} from "@repo/ui/picture-read";
import { type QueryClient, queryOptions, skipToken } from "@tanstack/react-query";
import { QUERY_ROOT } from "./query-keys.js";

/** How a picture is read: the scope it is kept under, and its id there. */
export type PictureReader = (owner: string, id: string) => Promise<PictureAnswer>;

/**
 * The picture `id` of `owner`, read through `read`. Without one it reads
 * nothing (`skipToken`), for a place that only looks at or writes what the
 * window keeps under its key.
 */
export function pictureQuery(owner: string, id: string, read?: PictureReader) {
  return queryOptions({
    queryKey: [QUERY_ROOT.PICTURE, owner, id],
    queryFn: read === undefined ? skipToken : () => readPicture(read(owner, id)),
    staleTime: Infinity,
    retry: false,
  });
}

/** Where the picture stands in `client` now, without reading it; reading where no place has read it. */
export function pictureNow(client: QueryClient, owner: string, id: string): PictureState {
  return pictureStateOf(client.getQueryData(pictureQuery(owner, id).queryKey));
}

/** A picture this window made itself, kept as read under the id it was given, so no place reads it back. */
export function keepPictureRead(client: QueryClient, owner: string, id: string, url: string): void {
  const read: PictureRead = { kind: PICTURE_STATE.READY, url };
  client.setQueryData(pictureQuery(owner, id).queryKey, read);
}

/**
 * Lets go of every picture the window read, as it must once the account
 * signed in changes, since a picture is read as the account and another may
 * not reach it. Note that the queries are reset rather than removed, because
 * a removed query is not told to the places drawing it, which would go on
 * drawing the last account's bytes: a reset one is read again where it is
 * drawn, and keeps nothing where it is not.
 */
export function forgetPictures(client: QueryClient): Promise<void> {
  return client.resetQueries({ queryKey: [QUERY_ROOT.PICTURE] });
}
