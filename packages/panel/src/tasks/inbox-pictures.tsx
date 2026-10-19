import type { FileChip } from "@luke/features/attachment-model";
import { inboxAttachmentOf } from "@luke/features/inbox-attachment-link";
import { ErrorState } from "@luke/ui";
import { PICTURE_STATE } from "@luke/ui/picture-cache";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
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
 * own, as `PlanPictures` does a plan's (`plan-pictures.tsx`). The bytes are
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

/** What the pictures under an item's words share: the item, the reads held, and how one is asked for. */
export interface InboxPicturesDoor {
  readonly itemId: string;
  readonly images: TaskInboxControl["images"];
  readonly onImage: TaskInboxControl["onImage"];
  readonly onRetryImage: TaskInboxControl["onRetryImage"];
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
 * held, its caption under it, pressed to open it larger over the window;
 * a quiet box while they are read, and a line with Retry where the read
 * did not answer. It asks for its bytes as it is first drawn.
 */
export function InboxPicture({
  door,
  attachmentId,
  alt,
  caption,
}: {
  door: InboxPicturesDoor;
  attachmentId: string;
  alt: string;
  caption: string | undefined;
}): React.JSX.Element {
  const [viewing, setViewing] = useState(false);
  const { itemId, onImage, onRetryImage } = door;
  const image = door.images.get(attachmentId);
  const held = image !== undefined;
  useEffect(() => {
    if (!held) onImage(itemId, attachmentId);
  }, [held, itemId, attachmentId, onImage]);
  if (image === undefined) {
    return <PictureBlock state={{ kind: PICTURE_STATE.READING }} alt={alt} caption={caption} />;
  }
  if ("failed" in image) {
    return (
      <span className="picture-block" data-inbox-image-failed="">
        <ErrorState onRetry={() => onRetryImage(attachmentId)}>{IMAGE_FAILED_LINE}</ErrorState>
      </span>
    );
  }
  return (
    <>
      <PictureBlock
        state={{ kind: PICTURE_STATE.READY, url: image.url }}
        alt={alt}
        caption={caption}
        onOpen={() => setViewing(true)}
      />
      {viewing ? (
        <AttachmentViewer
          files={[viewerFile(alt, image.url)]}
          at={0}
          onAt={() => undefined}
          onClose={() => setViewing(false)}
        />
      ) : null}
    </>
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
  const door = useMemo<InboxPicturesDoor>(
    () => ({ itemId, images, onImage, onRetryImage }),
    [itemId, images, onImage, onRetryImage],
  );
  return <InboxPicturesContext.Provider value={door}>{children}</InboxPicturesContext.Provider>;
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
      return (
        <InboxPicture door={door} attachmentId={named.attachmentId} alt={alt} caption={caption} />
      );
    };
  }, [door]);
}
