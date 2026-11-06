import type { FileChip } from "@repo/features/attachment-model";
import {
  descriptionAttachmentIdsIn,
  descriptionAttachmentOf,
  taskPicturesIn,
} from "@repo/features/description-attachment-link";
import { descriptionSections } from "@repo/features/description-document";
import { ACT_KIND } from "@repo/host/acts";
import { PICTURE_STATE, usePicture } from "@repo/ui/picture-read";
import { useQueryClient } from "@tanstack/react-query";
import { ImageIcon } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { askAct } from "../act.js";
import { pictureUnread } from "../failure-report.js";
import type { PictureDrawer } from "../markdown-message.js";
import { OUTSIDE_GLYPH_CLASS, PictureBlock } from "../picture-block.js";
import { type PictureReader, pictureNow, pictureQuery } from "../picture-query.js";
import { TextLink } from "../text-link.js";
import { AttachmentViewer } from "./attachment-viewer.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * description-pictures.tsx -- a description's pictures where its words are drawn: each read through the host as the description's, drawn in its own block, and opened over the window walking the description's pictures in reading order.
 *
 * A description's text names a picture by its address
 * (`@repo/features/description-attachment-link`), so the place showing the description, its
 * page or one of its versions, stands `DescriptionPictures` around its words, and
 * every `MarkdownMessage` under it draws a picture through the drawer
 * `useDescriptionPictureDrawer` hands. A press on a picture opens the window's file
 * viewer (`attachment-viewer.tsx`) on it, its arrows walking the description's
 * other pictures that have been read, in the order the text names them. A
 * place that knows who last changed each section hands `sectionNote`, and
 * the viewer's header says it of the section the picture shown stands in,
 * which is where a picture's edit is named rather than over it in the text. A
 * picture of another description, one copied across, is read as that description's, which
 * only that description's readers may, and opens nothing here. A picture from
 * outside the app is never fetched, since the window's policy refuses it and a
 * fetch would tell its host who reads the description: it is a link to it, which
 * opens in the browser.
 */

/** What a picture is called in the viewer where its Markdown gives it no alt text. */
const UNNAMED_PICTURE = "Picture";

/** A picture's type, as its `data:` address spells it. */
const DATA_URL_TYPE = /^data:([^;,]+)[;,]/u;

/** What the pictures under a description's words share: the description, how a picture is read, and how one is opened. */
export interface DescriptionPicturesDoor {
  readonly taskId: string;
  readonly read: PictureReader;
  readonly open: (id: string) => void;
  /** Remembers the alt text a picture is drawn with, which the viewer names it by. */
  readonly name: (id: string, alt: string) => void;
}

const DescriptionPicturesContext = createContext<DescriptionPicturesDoor | undefined>(undefined);

/** The viewer as it stands open: the description's read pictures, each by its id, and the one shown. */
interface Viewing {
  readonly ids: readonly string[];
  readonly files: readonly FileChip[];
  readonly at: number;
}

/** A read picture as the viewer takes a file. */
function chipOf(url: string, name: string): FileChip {
  return { name, mediaType: DATA_URL_TYPE.exec(url)?.[1] ?? "", url };
}

/**
 * The heading of the section of `text` that draws the description's picture `id`,
 * empty for the words before the first; none where the text draws it
 * nowhere. Note that only a drawn picture counts, never its address in
 * words or code, and that a picture drawn twice is named by its first
 * section, as the viewer walks each picture once.
 */
function sectionOfPicture(text: string, taskId: string, id: string): string | undefined {
  return descriptionSections(text).find((section) =>
    taskPicturesIn(section.text).some((address) => {
      const named = descriptionAttachmentOf(address);
      return named?.taskId === taskId && named.attachmentId === id;
    }),
  )?.heading;
}

/**
 * The description's pictures for every message drawn under it: `text` is the words
 * shown, which name the pictures in the order the viewer walks them, and
 * `sectionNote` what the viewer says of a picture by the heading of the
 * section it stands in.
 */
export function DescriptionPictures({
  taskId,
  text,
  sectionNote,
  children,
}: {
  taskId: string;
  text: string;
  sectionNote?: ((heading: string) => ReactNode) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState<Viewing | undefined>(undefined);
  const names = useRef(new Map<string, string>());
  // Note that the words are read as a picture is opened, so the door stands
  // while they change, and every section drawn under it is not drawn again
  // for a change to another's words.
  const shownText = useRef(text);
  shownText.current = text;
  const read = useCallback(
    (owner: string, id: string) =>
      askAct(ACT_KIND.TASKS_PICTURE_READ, { planId: owner, attachmentId: id }),
    [],
  );
  const door = useMemo<DescriptionPicturesDoor>(
    () => ({
      taskId,
      read,
      name: (id, alt) => names.current.set(id, alt),
      // Note that the viewer walks the pictures read by the press, since one still being read has nothing to show.
      open: (id) => {
        const shown = descriptionAttachmentIdsIn(shownText.current, taskId).flatMap((each) => {
          const state = pictureNow(queryClient, taskId, each);
          if (state.kind !== PICTURE_STATE.READY) return [];
          return [
            { id: each, chip: chipOf(state.url, names.current.get(each) || UNNAMED_PICTURE) },
          ];
        });
        const at = shown.findIndex((each) => each.id === id);
        if (at !== -1) {
          setViewing({
            ids: shown.map((each) => each.id),
            files: shown.map((each) => each.chip),
            at,
          });
        }
      },
    }),
    [taskId, read, queryClient],
  );
  const shownId = viewing?.ids[viewing.at];
  const heading = shownId === undefined ? undefined : sectionOfPicture(text, taskId, shownId);
  return (
    <DescriptionPicturesContext.Provider value={door}>
      {children}
      {viewing === undefined ? null : (
        <AttachmentViewer
          files={viewing.files}
          at={viewing.at}
          onAt={(at) => setViewing({ ...viewing, at })}
          onClose={() => setViewing(undefined)}
          note={heading === undefined ? undefined : sectionNote?.(heading)}
        />
      )}
    </DescriptionPicturesContext.Provider>
  );
}

/** One picture of a description, read as that description's; a press opens it only where it is the description shown's own. */
function DescriptionPicture({
  door,
  owner,
  id,
  alt,
  caption,
}: {
  door: DescriptionPicturesDoor;
  owner: string;
  id: string;
  alt: string;
  caption: string | undefined;
}): React.JSX.Element {
  const state = usePicture(pictureQuery(owner, id, door.read), pictureUnread);
  door.name(id, alt);
  const own = owner === door.taskId;
  return (
    <PictureBlock
      state={state}
      alt={alt}
      caption={caption}
      onOpen={own ? () => door.open(id) : undefined}
    />
  );
}

/** A picture from outside the app: a link to it, never fetched. */
function OutsidePicture({
  href,
  alt,
  openLink,
}: {
  href: string;
  alt: string;
  openLink: (href: string) => void;
}): React.JSX.Element {
  const words = alt === "" ? UNNAMED_PICTURE : alt;
  return (
    <TextLink href={href} words={words} onOpen={openLink}>
      <ImageIcon className={OUTSIDE_GLYPH_CLASS} aria-hidden="true" />
      {words}
    </TextLink>
  );
}

/** What the pictures under a description's words share, for a place that draws them itself, as the description's editor does; none outside `DescriptionPictures`. */
export function useDescriptionPicturesDoor(): DescriptionPicturesDoor | undefined {
  return useContext(DescriptionPicturesContext);
}

/** The drawer for the messages under `DescriptionPictures`; none outside one, where every picture is its alt text. */
export function useDescriptionPictureDrawer(): PictureDrawer | undefined {
  const door = useContext(DescriptionPicturesContext);
  const openLink = useOpenLink();
  return useMemo(() => {
    if (door === undefined) return undefined;
    const drawer: PictureDrawer = (src, alt, title) => {
      const named = descriptionAttachmentOf(src);
      if (named === undefined) return <OutsidePicture href={src} alt={alt} openLink={openLink} />;
      return (
        <DescriptionPicture
          door={door}
          owner={named.taskId}
          id={named.attachmentId}
          alt={alt}
          caption={title}
        />
      );
    };
    return drawer;
  }, [door, openLink]);
}
