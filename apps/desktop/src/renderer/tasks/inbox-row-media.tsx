import type { PageLine } from "@luke/features/page-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import { appPlatform } from "@luke/panel/app-platform";
import { AppWindowIcon, ImageOffIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { INBOX_MEDIA, type InboxMedia } from "./inbox-model";
import { PAGE_SANDBOX } from "./page-pane";
import type { InboxImage } from "./use-task-inbox";

/**
 * inbox-row-media.tsx -- the media an Inbox row shows under its preview, where the window's Inbox shows them: each picture its item carries and each page it names, drawn small.
 *
 * The window's Inbox lists items of every task, and the pane's own reads
 * hold the chosen item's pictures alone (`use-task-inbox.ts`), so the list
 * reads its rows' media itself, once for the whole list and as each row is
 * first drawn: a picture by the attachment read the pane's takes
 * (`ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT`), held by its attachment, and
 * a page's newest version through its task's pages
 * (`ACT_KIND.TASKS_PAGES`), each task read once, and again once an item
 * naming one of its pages changes, as an agent showing a page anew does. A
 * picture is let go once no listed item's row draws it, its item having left
 * the list or been reposted without it, as the task Inbox lets go of a
 * picture its items no longer name, so the list holds
 * the bytes of what it lists rather than of every picture it ever drew, and
 * none while it shows no media. A picture is drawn to fill its tile; a page
 * in a frame laid out four times the tile's width and
 * scaled down to it, as a page's card draws its preview (`page-card.tsx`),
 * under the same sandbox, taking no pointer and no focus, and left out of
 * the screen recording. Until a picture or a page's frame lands its tile
 * holds its place in a quiet ground; a picture whose read did not answer,
 * and a page its task does not list, wear their kind's glyph instead. The
 * strip is decoration: the row's words say what the item is, and its pane
 * shows the media whole.
 */

/** A task's pages as read, or that the read did not answer. */
type PageRead = readonly PageLine[] | "failed";

/** The list's reads of its rows' media, shared by every row. */
export interface RowMediaReads {
  readonly images: ReadonlyMap<string, InboxImage>;
  /** Says which pictures an item's row draws now, asking for each that is neither held nor on its way, and letting go of those no listed row draws any longer. */
  readonly onImages: (itemId: string, attachmentIds: readonly string[]) => void;
  /** Each task's pages as read, by the task's id. */
  readonly pages: ReadonlyMap<string, PageRead>;
  /** Asks for a task's pages for an item changed at `at`, where no read asked since it changed is held or on its way. */
  readonly onPages: (taskId: string, at: number) => void;
}

/** The pictures held but those under the attachments given. */
function imagesWithout(
  images: ReadonlyMap<string, InboxImage>,
  gone: ReadonlySet<string>,
): ReadonlyMap<string, InboxImage> {
  return new Map([...images].filter(([attachmentId]) => !gone.has(attachmentId)));
}

/**
 * The reads of the list's rows' media: each picture and each task's pages read once, as a row first asks,
 * and a picture let go once no item among `listed` draws it.
 */
export function useRowMediaReads(
  /** The ids of the items whose rows may show their media: every item listed while media is shown, none while it is not. */
  listed: readonly string[],
): RowMediaReads {
  const { act } = useAct();
  const [images, setImages] = useState<ReadonlyMap<string, InboxImage>>(new Map());
  const [pages, setPages] = useState<ReadonlyMap<string, PageRead>>(new Map());
  // Note that what is on its way is kept apart from what landed, so a row drawn while a read is out asks nothing again.
  // Each read is kept under a token of its own, so one whose picture was let go while it was out lands nowhere.
  const asked = useRef(new Map<string, object>());
  // The pictures each item's row draws now, as it last said: a folded row keeps its say, since its item is still listed.
  const drawn = useRef(new Map<string, ReadonlySet<string>>());
  // Each task's pages are read again once an item naming one changed since they were last asked for,
  // since a page it names may have been shown, or shown again, since.
  const pagesAsked = useRef(new Map<string, number>());
  /** Lets go of every picture asked for that no item's row draws any longer, and of any read still out for one. */
  const letGo = useCallback(() => {
    const named = new Set<string>();
    for (const each of drawn.current.values())
      for (const attachmentId of each) named.add(attachmentId);
    const gone = new Set(
      [...asked.current.keys()].filter((attachmentId) => !named.has(attachmentId)),
    );
    if (gone.size === 0) return;
    for (const attachmentId of gone) asked.current.delete(attachmentId);
    setImages((standing) => imagesWithout(standing, gone));
  }, []);
  const read = useCallback(
    (itemId: string, attachmentId: string) => {
      const mine = {};
      asked.current.set(attachmentId, mine);
      const standsFor = () => asked.current.get(attachmentId) === mine;
      act(ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT, { itemId, attachmentId }).then(
        (answer) => {
          if (!standsFor()) return;
          const image: InboxImage =
            "failure" in answer
              ? { failed: true }
              : { url: `data:${answer.contentType};base64,${answer.base64}` };
          setImages((standing) => new Map(standing).set(attachmentId, image));
        },
        () => {
          if (standsFor()) {
            setImages((standing) => new Map(standing).set(attachmentId, { failed: true }));
          }
        },
      );
    },
    [act],
  );
  const onImages = useCallback(
    (itemId: string, attachmentIds: readonly string[]) => {
      const before = drawn.current.get(itemId);
      const now = new Set(attachmentIds);
      drawn.current.set(itemId, now);
      for (const attachmentId of now) {
        if (!asked.current.has(attachmentId)) read(itemId, attachmentId);
      }
      // Note that an item reposted under its key keeps its id, so a picture it no longer carries goes with the old version.
      if (before !== undefined && [...before].some((attachmentId) => !now.has(attachmentId))) {
        letGo();
      }
    },
    [read, letGo],
  );
  useEffect(() => {
    const still = new Set(listed);
    const left = [...drawn.current.keys()].filter((itemId) => !still.has(itemId));
    if (left.length === 0) return;
    for (const itemId of left) drawn.current.delete(itemId);
    letGo();
  }, [listed, letGo]);
  const onPages = useCallback(
    (taskId: string, at: number) => {
      const last = pagesAsked.current.get(taskId);
      if (last !== undefined && last >= at) return;
      pagesAsked.current.set(taskId, at);
      act(ACT_KIND.TASKS_PAGES, { taskId }).then(
        (answer) => {
          // Note that a read asked for since is the newer, so this one gives way to it.
          if (pagesAsked.current.get(taskId) !== at) return;
          const read: PageRead = "pages" in answer ? answer.pages : "failed";
          setPages((standing) => new Map(standing).set(taskId, read));
        },
        () => {
          if (pagesAsked.current.get(taskId) === at) {
            setPages((standing) => new Map(standing).set(taskId, "failed"));
          }
        },
      );
    },
    [act],
  );
  return { images, onImages, pages, onPages };
}

/** One picture's tile: the picture once read, its glyph where the read did not answer. */
function ImageTile({ image }: { image: InboxImage | undefined }): React.JSX.Element {
  if (image === undefined) return <span className="inbox-row-media-tile" />;
  if ("failed" in image) {
    return (
      <span className="inbox-row-media-tile" data-missing="">
        <ImageOffIcon />
      </span>
    );
  }
  return (
    <span className="inbox-row-media-tile">
      <img className="inbox-row-media-image" src={image.url} alt="" draggable={false} />
    </span>
  );
}

/** One page's tile: its newest version drawn small and inert once its task's pages are read, its glyph where they hold no such page. */
function PageTile({
  taskId,
  pageId,
  read,
}: {
  taskId: string;
  pageId: string;
  read: PageRead | undefined;
}): React.JSX.Element {
  // Note that what loaded is kept by its address, so a newer version's frame holds its place again until it loads.
  const [loadedFrom, setLoadedFrom] = useState<string | undefined>(undefined);
  if (read === undefined) return <span className="inbox-row-media-tile" />;
  const page = read === "failed" ? undefined : read.find((each) => each.id === pageId);
  if (page === undefined) {
    return (
      <span className="inbox-row-media-tile" data-missing="">
        <AppWindowIcon />
      </span>
    );
  }
  const src = appPlatform().pageFrameUrl({ taskId, pageId, version: page.version });
  return (
    <span className="inbox-row-media-tile ph-no-capture" data-loaded={String(loadedFrom === src)}>
      <iframe
        className="inbox-row-media-frame"
        title={page.title}
        src={src}
        sandbox={PAGE_SANDBOX}
        allow=""
        referrerPolicy="no-referrer"
        loading="lazy"
        tabIndex={-1}
        aria-hidden="true"
        onLoad={() => setLoadedFrom(src)}
      />
    </span>
  );
}

/** The strip of an item's media under its row's preview, each asked for as it is first drawn. */
export function RowMedia({
  itemId,
  changedAt,
  media,
  reads,
}: {
  itemId: string;
  /** When the item last changed, so its pages are read again once it does. */
  changedAt: number;
  media: readonly InboxMedia[];
  reads: RowMediaReads;
}): React.JSX.Element {
  const { onImages, onPages } = reads;
  useEffect(() => {
    const pictures: string[] = [];
    for (const each of media) {
      if (each.kind === INBOX_MEDIA.IMAGE) pictures.push(each.attachmentId);
      else onPages(each.taskId, changedAt);
    }
    onImages(itemId, pictures);
  }, [itemId, changedAt, media, onImages, onPages]);
  return (
    <>
      {media.map((each) =>
        each.kind === INBOX_MEDIA.IMAGE ? (
          <ImageTile key={each.attachmentId} image={reads.images.get(each.attachmentId)} />
        ) : (
          <PageTile
            key={each.pageId}
            taskId={each.taskId}
            pageId={each.pageId}
            read={reads.pages.get(each.taskId)}
          />
        ),
      )}
    </>
  );
}
