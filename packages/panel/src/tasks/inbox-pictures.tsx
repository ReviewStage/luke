import type { FileChip } from "@repo/features/attachment-model";
import { inboxAttachmentOf } from "@repo/features/inbox-attachment-link";
import { cssCustomProperties, joinRefs, useNearView } from "@repo/ui";
import { PICTURE_STATE, usePicture } from "@repo/ui/picture-read";
import { useQueries } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { pictureUnread } from "../failure-report.js";
import { PICTURE_BLOCK_CLASS, PictureBlock } from "../picture-block.js";
import { type PictureReader, pictureQuery } from "../picture-query.js";
import { AttachmentViewer } from "./attachment-viewer.js";
import type { InboxImageReads } from "./use-task-inbox.js";

/**
 * inbox-pictures.tsx -- an Inbox item's pictures where its words are drawn: each read through the host as the item's, drawn in its own block with its caption, and opened over the window by a press.
 *
 * An image block names its picture by its attachment, and the item's
 * Markdown, its blocks, its thread's messages, and its answer's note, by
 * the picture's address (`@repo/features/inbox-attachment-link`), so the
 * pane standing an item stands `InboxPictures` around its words, and every
 * transcript's words under it draw a picture of that item as the item's
 * own, as `DescriptionPictures` does a description's (`description-pictures.tsx`). A press on
 * any of them opens one viewer over every picture of the item, in the order
 * they are drawn, which the arrow keys walk, as an agent's pictures' viewer
 * does (`agent-pictures.tsx`): a picture still read joins the walk once its
 * bytes are held, and one whose read failed is left out. A WebM the agent
 * recorded is drawn and walked as a picture is, as its still, and the viewer
 * plays it. The bytes are the Inbox's own reads (`use-task-inbox.ts`), asked
 * for as a picture first comes within a screenful of the screen, so one
 * inside a card no one opened, or far up a thread no one scrolled, is never
 * fetched; the viewer walks the pictures read so far. A picture or video
 * held is drawn only while it stands near the screen (`@repo/ui`'s
 * `useNearView`), and a box as tall as it stood everywhere else, so a long
 * thread of screenshots and recordings holds a few screens' worth of
 * decoded pictures and players at once rather than all of them, which a
 * phone's browser cannot. A
 * picture a comment carried that its words do not draw, a member's file,
 * is drawn after them by the same `InboxPicture` and walked with the rest. A
 * picture of another item, one copied across, is that item's to read, and
 * stands as its link here; a picture from outside the app is never fetched.
 * Every picture is left out of the session recording (`picture-block.tsx`).
 */

/** What a picture is called in the viewer where its Markdown gives it no alt text. */
const UNNAMED_PICTURE = "Picture";

/** What a file's name may not spell on the Mac it is saved to. */
const UNSAVEABLE = /[/\\:]/gu;

/** One of an item's pictures as drawn: what it is, and the element it stands in, which places it among the rest. */
interface DrawnPicture {
  readonly attachmentId: string;
  readonly alt: string;
  /** The file's own name, where it has one, which the viewer saves it by. */
  readonly name: string | undefined;
  readonly anchor: RefObject<HTMLElement | null>;
}

/** What the pictures under an item's words share: the item, how one is read, and the one viewer over them all. */
interface InboxPicturesDoor {
  readonly itemId: string;
  readonly read: PictureReader;
  /** Counts a picture drawn among the item's, under its own key, until the returned cleanup. */
  readonly register: (key: string, picture: DrawnPicture) => () => void;
  /** Opens the viewer over the item's pictures at the one drawn under `key`. */
  readonly open: (key: string) => void;
}

const InboxPicturesContext = createContext<InboxPicturesDoor | undefined>(undefined);

/**
 * The picture as the viewer takes a file: by the file's own name where it
 * has one, a file a member attached, or else named by its words under the
 * type's own extension, since the viewer saves it by that name; its type
 * read off the `data:` URL.
 */
function viewerFile(alt: string, name: string | undefined, url: string): FileChip {
  const mediaType = url.slice("data:".length, url.indexOf(";"));
  const words = alt === "" ? UNNAMED_PICTURE : alt;
  const saved = name ?? `${words}.${mediaType.slice(mediaType.indexOf("/") + 1)}`;
  return { name: saved.replace(UNSAVEABLE, "-"), mediaType, url };
}

/**
 * One of an item's pictures: drawn as a description's picture is, at its own size
 * up to the column's width and a screenful's height, once its bytes are
 * held, its caption under it, pressed to open the item's pictures larger
 * over the window from it; a quiet box while they are read, and the same
 * box with Retry in the spinner's place where the read did not answer. It asks for its bytes as it
 * first comes near the screen, and away from it stands as a box of the
 * height it last stood. Nothing is drawn outside `InboxPictures`.
 */
export function InboxPicture({
  attachmentId,
  alt,
  caption,
  name,
}: {
  attachmentId: string;
  alt: string;
  caption: string | undefined;
  /** The file's own name, where it has one, which the viewer names it by; one drawn from Markdown has none. */
  name?: string | undefined;
}): React.JSX.Element | null {
  const door = useContext(InboxPicturesContext);
  const key = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const [place, { near, height }] = useNearView();
  const placed = useMemo(() => joinRefs(anchor, place), [place]);
  const register = door?.register;
  // Note that a picture is read as it first comes near the screen, and once read stands kept away from it.
  const state = usePicture(
    { ...pictureQuery(door?.itemId ?? "", attachmentId, door?.read), enabled: near },
    pictureUnread,
  );
  useLayoutEffect(
    () => register?.(key, { attachmentId, alt, name, anchor }),
    [register, key, attachmentId, alt, name],
  );
  if (door === undefined) return null;
  // Away from the screen, a picture once drawn holds its place and lets its bytes' drawing go.
  if (!near && height !== undefined) {
    return (
      <span
        ref={placed}
        className={`${PICTURE_BLOCK_CLASS} h-picture-held`}
        style={cssCustomProperties({ "--picture-held-height": `${height}px` })}
        data-state="away"
      />
    );
  }
  if (state.kind === PICTURE_STATE.READY && near) {
    return (
      <PictureBlock
        ref={placed}
        state={state}
        alt={alt}
        caption={caption}
        onOpen={() => door.open(key)}
      />
    );
  }
  return (
    <PictureBlock
      ref={placed}
      state={near ? state : { kind: PICTURE_STATE.READING }}
      alt={alt}
      caption={caption}
    />
  );
}

/** The picture the viewer shows: the item's, the copy it was opened or walked to by its key, and the picture itself by its attachment. */
interface ViewedPicture {
  readonly itemId: string;
  readonly key: string;
  readonly attachmentId: string;
}

/** A picture the viewer walks: the key it was drawn under, and what it is. */
interface WalkedPicture {
  readonly key: string;
  readonly attachmentId: string;
  readonly alt: string;
  readonly name: string | undefined;
}

/** The item's pictures drawn now, in the order they stand in the window. */
function inDrawnOrder(drawn: ReadonlyMap<string, DrawnPicture>): readonly WalkedPicture[] {
  const standing = [...drawn].flatMap(([key, { attachmentId, alt, name, anchor }]) =>
    anchor.current === null ? [] : [{ key, attachmentId, alt, name, element: anchor.current }],
  );
  standing.sort((one, other) =>
    one.element.compareDocumentPosition(other.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  return standing.map(({ key, attachmentId, alt, name }) => ({ key, attachmentId, alt, name }));
}

/** Whether the picture shown is drawn among the item's: its own copy, or, where its words were drawn again, another of the same picture. */
function stillDrawn(drawn: ReadonlyMap<string, DrawnPicture>, shown: ViewedPicture): boolean {
  if (drawn.has(shown.key)) return true;
  return [...drawn.values()].some((picture) => picture.attachmentId === shown.attachmentId);
}

/**
 * The viewer over an item's pictures, from the one named: each picture held
 * now among the files it walks, and each still read joining them as its
 * bytes land; one whose read failed is skipped. Note that the picture shown
 * is found by its copy's key, else by its attachment, because words drawn
 * again draw the same picture under a new key.
 */
function ItemViewer({
  itemId,
  pictures,
  shown,
  onShow,
  onClose,
}: {
  itemId: string;
  pictures: readonly WalkedPicture[];
  shown: ViewedPicture;
  onShow: (picture: WalkedPicture) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  // Note that the viewer reads nothing itself: it watches what the pictures drawn read, so one landing joins the walk.
  const reads = useQueries({
    queries: pictures.map((picture) => pictureQuery(itemId, picture.attachmentId)),
    combine: (results) => results.map((result) => result.data),
  });
  const held = pictures.flatMap((picture, index) => {
    const read = reads[index];
    if (read?.kind !== PICTURE_STATE.READY) return [];
    return [{ picture, file: viewerFile(picture.alt, picture.name, read.url) }];
  });
  const byKey = held.findIndex((each) => each.picture.key === shown.key);
  const at =
    byKey >= 0 ? byKey : held.findIndex((each) => each.picture.attachmentId === shown.attachmentId);
  if (at < 0) return null;
  return (
    <AttachmentViewer
      files={held.map((each) => each.file)}
      at={at}
      onAt={(next) => {
        const walked = held[next];
        if (walked !== undefined) onShow(walked.picture);
      }}
      onClose={onClose}
    />
  );
}

/**
 * The item's pictures for every word drawn under it, read through the
 * Inbox's own reads, and the one viewer a press on any opens over them all.
 * Note that the viewer walks them in the order they stand in the window,
 * because the words they stand in are drawn apart, a thread's messages and a
 * row's pictures each by their own Markdown, so no one list holds them all in
 * order; a picture drawn or gone while it is open joins or leaves the walk,
 * and the viewer closes once the picture it shows is drawn no more, never
 * while its words are only drawn again.
 */
export function InboxPictures({
  itemId,
  control,
  children,
}: {
  itemId: string;
  control: InboxImageReads;
  children: ReactNode;
}): React.JSX.Element {
  const { read } = control;
  const drawn = useRef(new Map<string, DrawnPicture>());
  const [viewing, setViewing] = useState<ViewedPicture | undefined>();
  const register = useCallback((key: string, picture: DrawnPicture) => {
    drawn.current.set(key, picture);
    // An open viewer is drawn again to take the picture in.
    setViewing((now) => (now === undefined ? now : { ...now }));
    return () => {
      drawn.current.delete(key);
      // An open viewer is drawn again to let the picture go.
      setViewing((now) => (now === undefined ? now : { ...now }));
    };
  }, []);
  // Note that the viewer closes here rather than as a picture lets go, because
  // words drawn again let their pictures go before drawing them anew, and
  // this runs once both are done.
  useLayoutEffect(() => {
    if (viewing !== undefined && !stillDrawn(drawn.current, viewing)) setViewing(undefined);
  }, [viewing]);
  const open = useCallback(
    (key: string) => {
      const picture = drawn.current.get(key);
      if (picture !== undefined) setViewing({ itemId, key, attachmentId: picture.attachmentId });
    },
    [itemId],
  );
  const door = useMemo<InboxPicturesDoor>(
    () => ({ itemId, read, register, open }),
    [itemId, read, register, open],
  );
  return (
    <InboxPicturesContext.Provider value={door}>
      {children}
      {viewing?.itemId === itemId ? (
        <ItemViewer
          itemId={itemId}
          pictures={inDrawnOrder(drawn.current)}
          shown={viewing}
          onShow={({ key, attachmentId }) => setViewing({ itemId, key, attachmentId })}
          onClose={() => setViewing(undefined)}
        />
      ) : null}
    </InboxPicturesContext.Provider>
  );
}

/**
 * What draws a picture by its address under `InboxPictures`: the item's
 * own picture as `InboxPicture`, nothing for any other address, which is
 * drawn as it is anywhere else; none outside one.
 */
export function useInboxPictureDrawer():
  | ((src: string, alt: string, caption: string | undefined) => ReactNode | undefined)
  | undefined {
  const door = useContext(InboxPicturesContext);
  return useMemo(() => {
    if (door === undefined) return undefined;
    return (src: string, alt: string, caption: string | undefined) => {
      const named = inboxAttachmentOf(src);
      if (named?.itemId !== door.itemId) return undefined;
      return <InboxPicture attachmentId={named.attachmentId} alt={alt} caption={caption} />;
    };
  }, [door]);
}
