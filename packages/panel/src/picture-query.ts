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

export type PictureReader = (owner: string, id: string) => Promise<PictureAnswer>;

export function pictureQuery(owner: string, id: string, read?: PictureReader) {
  return queryOptions({
    queryKey: [QUERY_ROOT.PICTURE, owner, id],
    queryFn: read === undefined ? skipToken : () => readPicture(read(owner, id)),
    staleTime: Infinity,
    retry: false,
  });
}

export function pictureNow(client: QueryClient, owner: string, id: string): PictureState {
  return pictureStateOf(client.getQueryData(pictureQuery(owner, id).queryKey));
}

export function keepPictureRead(client: QueryClient, owner: string, id: string, url: string): void {
  const read: PictureRead = { kind: PICTURE_STATE.READY, url };
  client.setQueryData(pictureQuery(owner, id).queryKey, read);
}

export function forgetPictures(client: QueryClient): Promise<void> {
  return client.resetQueries({ queryKey: [QUERY_ROOT.PICTURE] });
}
