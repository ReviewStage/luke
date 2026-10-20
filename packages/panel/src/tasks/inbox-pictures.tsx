import type { FileChip } from "@luke/features/attachment-model";
import { inboxAttachmentOf } from "@luke/features/inbox-attachment-link";
import { ErrorState } from "@luke/ui";
import { PICTURE_STATE } from "@luke/ui/picture-cache";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PictureBlock } from "../picture-block.js";
import { AttachmentViewer } from "./attachment-viewer.js";
import type { TaskInboxControl } from "./use-task-inbox.js";

/**
 * inbox-pictures.tsx -- an Inbox item's pictures where its words are drawn: each read through the host as the item's, drawn in its own block with its caption, and opened over the window by a press.
 *
 * An image block names its picture by its attachment, and the item's
 * Markdown, its blocks, its thread's messages, and its answer's note, by
 * the picture's address (`@luke/features/inbox-attachment-link`), so the
 * pane standing an item stands `InboxPictures` around its words, and every
 * transcript's words under it draw a picture of that item as the item's
 * own, as `PlanPictures` does a plan's (`plan-pictures.tsx`). A press on
 * any of them opens one viewer over every picture of the item, in the order
 * they are drawn, which the arrow keys walk, as an agent's pictures' viewer
 * does (`agent-pictures.tsx`): a picture still read joins the walk once its
 * bytes are held, and one whose read failed is left out. The bytes are
 * the Inbox's own reads (`use-task-inbox.ts`), asked for as a picture is
 * first drawn, so one inside a card no one opened is never fetched. A
 * picture of another item, one copied across, is that item's to read, and
 * stands as its link here; a picture from outside Luke is never fetched.
 * Every picture is left out of the session recording (`picture-block.tsx`).
 */

/** What an item's picture says where its read did not answer. */
const IMAGE_FAILED_LINE = "The image could not be read.";

/** What a picture is called in the viewer where its Markdown gives it no alt text. */
const UNNAMED_PICTURE = "Picture";

/** What a file's name may not spell on the Mac it is saved to. */
const UNSAVEABLE = /[/\\:]/gu;

/** One of an item's pictures as drawn: what it is, and the element it stands in, which places it among the rest. */
interface DrawnPicture {
  readonly attachmentId: string;
  readonly alt: string;
  readonly anchor: RefObject<HTMLElement | null>;
}

/** What the pictures under an item's words share: the item, the reads held, how one is asked for, and the one viewer over them all. */
interface InboxPicturesDoor {
  readonly itemId: string;
  readonly images: TaskInboxControl["images"];
  readonly onImage: TaskInboxControl["onImage"];
  readonly onRetryImage: TaskInboxControl["onRetryImage"];
  /** Counts a picture drawn among the item's, under its own key, until the returned cleanup. */
  readonly register: (key: string, picture: DrawnPicture) => () => void;
  /** Opens the viewer over the item's pictures at the one drawn under `key`. */
  readonly open: (key: string) => void;
}

const InboxPicturesContext = createContext<InboxPicturesDoor | undefined>(undefined);

/** The picture as the viewer takes a file: named by its words under the type's own extension, since the viewer saves it by that name, and its type read off the `data:` URL. */
function viewerFile(alt: string, url: string): FileChip {
  const mediaType = url.slice("data:".length, url.indexOf(";"));
  const words = alt === "" ? UNNAMED_PICTURE : alt;
  const name = `${words.replace(UNSAVEABLE, "-")}.${mediaType.slice("image/".length)}`;
  return { name, mediaType, url };
}

/**
 * One of an item's pictures: drawn as a plan's picture is, at its own size
 * up to the column's width and a screenful's height, once its bytes are
 * held, its caption under it, pressed to open the item's pictures larger
 * over the window from it; a quiet box while they are read, and a line
 * with Retry where the read did not answer. It asks for its bytes as it is
 * first drawn. Nothing is drawn outside `InboxPictures`.
 */
export function InboxPicture({
  attachmentId,
  alt,
  caption,
}: {
  attachmentId: string;
  alt: string;
  caption: string | undefined;
}): React.JSX.Element | null {
  const door = useContext(InboxPicturesContext);
  const key = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const itemId = door?.itemId;
  const onImage = door?.onImage;
  const register = door?.register;
  const image = door?.images.get(attachmentId);
  const held = image !== undefined;
  useEffect(() => {
    if (!held && itemId !== undefined) onImage?.(itemId, attachmentId);
  }, [held, itemId, attachmentId, onImage]);
  useLayoutEffect(
    () => register?.(key, { attachmentId, alt, anchor }),
    [register, key, attachmentId, alt],
  );
  if (door === undefined) return null;
  if (image === undefined) {
    return (
      <PictureBlock
        ref={anchor}
        state={{ kind: PICTURE_STATE.READING }}
        alt={alt}
        caption={caption}
      />
    );
  }
  if ("failed" in image) {
    return (
      <span ref={anchor} className="picture-block" data-inbox-image-failed="">
        <ErrorState onRetry={() => door.onRetryImage(attachmentId)}>{IMAGE_FAILED_LINE}</ErrorState>
      </span>
    );
  }
  return (
    <PictureBlock
      ref={anchor}
      state={{ kind: PICTURE_STATE.READY, url: image.url }}
      alt={alt}
      caption={caption}
      onOpen={() => door.open(key)}
    />
  );
}

/** A picture the viewer walks: the key it was drawn under, and what it is. */
interface WalkedPicture {
  readonly key: string;
  readonly attachmentId: string;
  readonly alt: string;
}

/** The item's pictures drawn now, in the order they stand in the window. */
function inDrawnOrder(drawn: ReadonlyMap<string, DrawnPicture>): readonly WalkedPicture[] {
  const standing = [...drawn].flatMap(([key, { attachmentId, alt, anchor }]) =>
    anchor.current === null ? [] : [{ key, attachmentId, alt, element: anchor.current }],
  );
  standing.sort((one, other) =>
    one.element.compareDocumentPosition(other.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  return standing.map(({ key, attachmentId, alt }) => ({ key, attachmentId, alt }));
}

/**
 * The viewer over an item's pictures, from the one named: each picture held
 * now among the files it walks, and each still read joining them as its
 * bytes land; one whose read failed is skipped.
 */
function ItemViewer({
  pictures,
  images,
  shownKey,
  onShow,
  onClose,
}: {
  pictures: readonly WalkedPicture[];
  images: TaskInboxControl["images"];
  shownKey: string;
  onShow: (key: string) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  const held = pictures.flatMap(({ key, attachmentId, alt }) => {
    const image = images.get(attachmentId);
    if (image === undefined || "failed" in image) return [];
    return [{ key, file: viewerFile(alt, image.url) }];
  });
  const at = held.findIndex((each) => each.key === shownKey);
  if (at < 0) return null;
  return (
    <AttachmentViewer
      files={held.map((each) => each.file)}
      at={at}
      onAt={(next) => {
        const shown = held[next];
        if (shown !== undefined) onShow(shown.key);
      }}
      onClose={onClose}
    />
  );
}

/** The item's pictures for every word drawn under it, read through the Inbox's own reads. */
export function InboxPictures({
  itemId,
  control,
  children,
}: {
  itemId: string;
  control: Pick<TaskInboxControl, "images" | "onImage" | "onRetryImage">;
  children: ReactNode;
}): React.JSX.Element {
  const { images, onImage, onRetryImage } = control;
  const drawn = useRef(new Map<string, DrawnPicture>());
  const [viewing, setViewing] = useState<
    | { readonly itemId: string; readonly pictures: readonly WalkedPicture[]; readonly key: string }
    | undefined
  >();
  const register = useCallback((key: string, picture: DrawnPicture) => {
    drawn.current.set(key, picture);
    return () => {
      drawn.current.delete(key);
    };
  }, []);
  // Note that the set is taken as the press opens it, in the order the pictures stand in the
  // window, because the words they stand in are drawn apart, a thread's messages and a row's
  // pictures each by their own Markdown, so no one list holds them all in order.
  const open = useCallback(
    (key: string) => setViewing({ itemId, pictures: inDrawnOrder(drawn.current), key }),
    [itemId],
  );
  const door = useMemo<InboxPicturesDoor>(
    () => ({ itemId, images, onImage, onRetryImage, register, open }),
    [itemId, images, onImage, onRetryImage, register, open],
  );
  return (
    <InboxPicturesContext.Provider value={door}>
      {children}
      {viewing?.itemId === itemId ? (
        <ItemViewer
          pictures={viewing.pictures}
          images={images}
          shownKey={viewing.key}
          onShow={(key) => setViewing({ ...viewing, key })}
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
