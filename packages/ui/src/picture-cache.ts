import { useEffect, useReducer, useState, useSyncExternalStore } from "react";

/**
 * picture-cache.ts -- the pictures this window read, each read once through the host and shared by every place that draws it, up to a byte budget.
 *
 * A picture is named by what it belongs to, a plan say, and its own id
 * there, and its bytes never change under that id: a new picture is a new
 * id. So a picture read once stands for as long as the window does, and a
 * second place drawing it reads nothing, until the pictures kept pass
 * `PICTURE_BYTE_BUDGET` and the one drawn longest ago is let go. The bytes
 * arrive in base64 and are drawn from a `data:` URL of the window's own making, which the window's
 * policy allows where it refuses any other address. A picture the reader
 * cannot reach, or whose bytes are gone, is kept as missing; a read that did
 * not land is not kept, so the next place to ask reads it again. Nothing
 * here knows whose pictures they are: the place drawing one hands its read.
 */

/** Where a picture's read stands: still out, landed as its `data:` URL, or answered as none. */
export const PICTURE_STATE = {
  READING: "reading",
  READY: "ready",
  MISSING: "missing",
} as const;

export type PictureState =
  | { readonly kind: typeof PICTURE_STATE.READING }
  | { readonly kind: typeof PICTURE_STATE.READY; readonly url: string }
  | { readonly kind: typeof PICTURE_STATE.MISSING };

/** What a read answers: the bytes in base64 under their type, or why there are none, `NOT_FOUND_FAILURE` among them. */
export type PictureAnswer =
  | { readonly contentType: string; readonly base64: string }
  | { readonly failure: string };

/** The failure that settles a picture as missing; any other leaves it to be read again. */
const NOT_FOUND_FAILURE = "not-found";

/**
 * How many bytes of `data:` URLs the window keeps; past it the picture
 * drawn longest ago is let go, and read again if a place draws it once more.
 * A picture's URL is its base64, a third larger than its bytes, and the
 * decoded bitmap is held besides while it is drawn.
 */
export const PICTURE_BYTE_BUDGET = 64 * 1024 * 1024;

const READING: PictureState = { kind: PICTURE_STATE.READING };
const MISSING: PictureState = { kind: PICTURE_STATE.MISSING };

/** A picture read or being read: the read every place asking shares, and where it stands. */
interface KeptPicture {
  readonly owner: string;
  readonly id: string;
  readonly read: Promise<PictureState>;
  state: PictureState;
  /** How many places drawing it stand now, which the byte budget never lets go of. */
  pins: number;
}

/** The pictures this window read, by what they belong to and then by id. */
const keptPictures = new Map<string, Map<string, KeptPicture>>();

/** The pictures that landed, the one drawn longest ago first, as the byte budget lets go of them. */
const drawnOrder = new Set<KeptPicture>();

/** The bytes the pictures in `drawnOrder` hold in their URLs. */
let keptBytes = 0;

/** What a landed picture holds, in bytes of its URL. */
const sizes = new WeakMap<KeptPicture, number>();

/** Marks the picture as drawn just now, if it landed. */
function touch(kept: KeptPicture | undefined): void {
  if (kept === undefined || !drawnOrder.delete(kept)) return;
  drawnOrder.add(kept);
}

/** Lets go of a landed picture, which a place drawing it reads again. */
function release(kept: KeptPicture): void {
  if (drawnOrder.delete(kept)) keptBytes -= sizes.get(kept) ?? 0;
  const pictures = keptPictures.get(kept.owner);
  if (pictures?.get(kept.id) === kept) pictures.delete(kept.id);
}

/** Lets go of the pictures drawn longest ago until the budget holds, sparing `newest` whatever its size and every picture a place is drawing now. */
function trim(newest: KeptPicture | undefined): void {
  for (const eldest of drawnOrder) {
    if (keptBytes <= PICTURE_BYTE_BUDGET) return;
    if (eldest !== newest && eldest.pins === 0) release(eldest);
  }
}

/** Counts a picture that landed, then trims to the budget. */
function land(kept: KeptPicture, url: string): void {
  if (drawnOrder.has(kept)) release(kept);
  // A picture let go of while it was read is not kept when it lands.
  if (keptPictures.get(kept.owner)?.get(kept.id) !== kept) return;
  sizes.set(kept, url.length);
  keptBytes += url.length;
  drawnOrder.add(kept);
  trim(kept);
}

/** What a read's answer comes to: drawn, settled as missing, or nothing to keep. */
function stateOf(answer: PictureAnswer): PictureState | undefined {
  if ("failure" in answer) return answer.failure === NOT_FOUND_FAILURE ? MISSING : undefined;
  return { kind: PICTURE_STATE.READY, url: `data:${answer.contentType};base64,${answer.base64}` };
}

/** The picture, read through `read` the first time any place asks and shared after. */
function keptPicture(owner: string, id: string, read: () => Promise<PictureAnswer>): KeptPicture {
  const pictures = keptPictures.get(owner) ?? new Map<string, KeptPicture>();
  keptPictures.set(owner, pictures);
  const standing = pictures.get(id);
  if (standing !== undefined) {
    touch(standing);
    return standing;
  }
  const kept: KeptPicture = {
    owner,
    id,
    pins: 0,
    state: READING,
    read: read()
      .then(stateOf, () => undefined)
      .then((state) => {
        // A read that did not land lets go of its own entry, so the next place to ask reads it again.
        if (state === undefined) {
          if (pictures.get(id) === kept) pictures.delete(id);
          return MISSING;
        }
        kept.state = state;
        if (state.kind === PICTURE_STATE.READY) land(kept, state.url);
        return state;
      }),
  };
  pictures.set(id, kept);
  return kept;
}

/** A picture this window made itself, kept as read under the id it was given, so no place reads it back. */
export function keepPictureRead(owner: string, id: string, url: string): void {
  const pictures = keptPictures.get(owner) ?? new Map<string, KeptPicture>();
  keptPictures.set(owner, pictures);
  const state: PictureState = { kind: PICTURE_STATE.READY, url };
  const standing = pictures.get(id);
  if (standing !== undefined) release(standing);
  const kept: KeptPicture = { owner, id, pins: 0, state, read: Promise.resolve(state) };
  pictures.set(id, kept);
  land(kept, url);
}

/** Where the picture stands now, without reading it; reading where no place has asked yet. */
export function pictureNow(owner: string, id: string): PictureState {
  const kept = keptPictures.get(owner)?.get(id);
  touch(kept);
  return kept?.state ?? READING;
}

/** How many times the window let go of every picture, which every place drawing one reads again on. */
let forgotten = 0;
const forgetting = new Set<() => void>();

function heedForgetting(listener: () => void): () => void {
  forgetting.add(listener);
  return () => forgetting.delete(listener);
}

/**
 * The picture as the place drawing it sees it: reading until its read
 * lands, then its `data:` URL, or missing. A read that did not land draws
 * as missing here, for this picture alone, and is read again by the next
 * place to mount; once the window lets go of every picture, it is read
 * again here. A place that reads a picture ahead and draws none of it
 * passes `drawn` false, so the byte budget may let its picture go.
 */
export function usePicture(
  owner: string,
  id: string,
  read: (owner: string, id: string) => Promise<PictureAnswer>,
  drawn = true,
): PictureState {
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const generation = useSyncExternalStore(heedForgetting, () => forgotten);
  const state = pictureNow(owner, id);
  // Note that a failure is this picture's own, so another drawn in its place still reads.
  const [failed, setFailed] = useState<{ owner: string; id: string; generation: number }>();
  useEffect(() => {
    let standing = true;
    const kept = keptPicture(owner, id, () => read(owner, id));
    // Note that the budget lets go of no picture a place is drawing, so one never goes back to reading under it; a place only reading ahead, which draws nothing, leaves its picture to the budget.
    if (drawn) kept.pins += 1;
    kept.read.then((answered) => {
      if (!standing) return;
      if (
        answered.kind === PICTURE_STATE.MISSING &&
        keptPictures.get(owner)?.get(id) === undefined
      ) {
        setFailed({ owner, id, generation });
      }
      redraw();
    });
    return () => {
      standing = false;
      if (drawn) kept.pins -= 1;
      trim(undefined);
    };
  }, [owner, id, read, generation, drawn]);
  const mine =
    failed !== undefined &&
    failed.owner === owner &&
    failed.id === id &&
    failed.generation === generation;
  return mine && state.kind === PICTURE_STATE.READING ? MISSING : state;
}

/**
 * Lets go of every picture this window read, as it must once the account
 * signed in changes, since a picture is read as the account and another
 * may not reach it; every place drawing one reads it again.
 */
export function forgetPictures(): void {
  keptPictures.clear();
  drawnOrder.clear();
  keptBytes = 0;
  forgotten += 1;
  for (const listener of forgetting) listener();
}
