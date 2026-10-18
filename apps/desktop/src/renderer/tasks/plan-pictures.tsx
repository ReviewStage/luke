import type { FileChip } from "@luke/features/attachment-model";
import {
  planAttachmentIdsIn,
  planAttachmentOf,
  taskPicturesIn,
} from "@luke/features/plan-attachment-link";
import { planSections } from "@luke/features/plan-document";
import { ACT_KIND } from "@luke/host/acts";
import { PICTURE_STATE, type PictureAnswer, pictureNow, usePicture } from "@luke/ui/picture-cache";
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
import { useAct } from "../act";
import type { PictureDrawer } from "../markdown-message";
import { PictureBlock } from "../picture-block";
import { TextLink } from "../text-link";
import { AttachmentViewer } from "./attachment-viewer";
import { useOpenLink } from "./use-open-link";

/**
 * plan-pictures.tsx -- a plan's pictures where its words are drawn: each read through the host as the plan's, drawn in its own block, and opened over the window walking the plan's pictures in reading order.
 *
 * A plan's text names a picture by its address
 * (`@luke/features/plan-attachment-link`), so the place showing the plan, its
 * page or one of its versions, stands `PlanPictures` around its words, and
 * every `MarkdownMessage` under it draws a picture through the drawer
 * `usePlanPictureDrawer` hands. A press on a picture opens the window's file
 * viewer (`attachment-viewer.tsx`) on it, its arrows walking the plan's
 * other pictures that have been read, in the order the text names them. A
 * place that knows who last changed each section hands `sectionNote`, and
 * the viewer's header says it of the section the picture shown stands in,
 * which is where a picture's edit is named rather than over it in the text. A
 * picture of another plan, one copied across, is read as that plan's, which
 * only that plan's readers may, and opens nothing here. A picture from
 * outside Luke is never fetched, since the window's policy refuses it and a
 * fetch would tell its host who reads the plan: it is a link to it, which
 * opens in the browser.
 */

/** What a picture is called in the viewer where its Markdown gives it no alt text. */
const UNNAMED_PICTURE = "Picture";

/** A picture's type, as its `data:` address spells it. */
const DATA_URL_TYPE = /^data:([^;,]+)[;,]/u;

/** What the pictures under a plan's words share: the plan, how a picture is read, and how one is opened. */
export interface PlanPicturesDoor {
  readonly planId: string;
  readonly read: (owner: string, id: string) => Promise<PictureAnswer>;
  readonly open: (id: string) => void;
  /** Remembers the alt text a picture is drawn with, which the viewer names it by. */
  readonly name: (id: string, alt: string) => void;
}

const PlanPicturesContext = createContext<PlanPicturesDoor | undefined>(undefined);

/** The viewer as it stands open: the plan's read pictures, each by its id, and the one shown. */
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
 * The heading of the section of `text` that draws the plan's picture `id`,
 * empty for the words before the first; none where the text draws it
 * nowhere. Note that only a drawn picture counts, never its address in
 * words or code, and that a picture drawn twice is named by its first
 * section, as the viewer walks each picture once.
 */
function sectionOfPicture(text: string, taskId: string, id: string): string | undefined {
  return planSections(text).find((section) =>
    taskPicturesIn(section.text).some((address) => {
      const named = planAttachmentOf(address);
      return named?.taskId === taskId && named.attachmentId === id;
    }),
  )?.heading;
}

/**
 * The plan's pictures for every message drawn under it: `text` is the words
 * shown, which name the pictures in the order the viewer walks them, and
 * `sectionNote` what the viewer says of a picture by the heading of the
 * section it stands in.
 */
export function PlanPictures({
  planId: taskId,
  text,
  sectionNote,
  children,
}: {
  planId: string;
  text: string;
  sectionNote?: ((heading: string) => ReactNode) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const { act } = useAct();
  const [viewing, setViewing] = useState<Viewing | undefined>(undefined);
  const names = useRef(new Map<string, string>());
  const read = useCallback(
    (owner: string, id: string) =>
      act(ACT_KIND.TASKS_PICTURE_READ, { planId: owner, attachmentId: id }),
    [act],
  );
  const door = useMemo<PlanPicturesDoor>(
    () => ({
      planId: taskId,
      read,
      name: (id, alt) => names.current.set(id, alt),
      // Note that the viewer walks the pictures read by the press, since one still being read has nothing to show.
      open: (id) => {
        const shown = planAttachmentIdsIn(text, taskId).flatMap((each) => {
          const state = pictureNow(taskId, each);
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
    [taskId, read, text],
  );
  const shownId = viewing?.ids[viewing.at];
  const heading = shownId === undefined ? undefined : sectionOfPicture(text, taskId, shownId);
  return (
    <PlanPicturesContext.Provider value={door}>
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
    </PlanPicturesContext.Provider>
  );
}

/** One picture of a plan, read as that plan's; a press opens it only where it is the plan shown's own. */
function PlanPicture({
  door,
  owner,
  id,
  alt,
  caption,
}: {
  door: PlanPicturesDoor;
  owner: string;
  id: string;
  alt: string;
  caption: string | undefined;
}): React.JSX.Element {
  const state = usePicture(owner, id, door.read);
  door.name(id, alt);
  const own = owner === door.planId;
  return (
    <PictureBlock
      state={state}
      alt={alt}
      caption={caption}
      onOpen={own ? () => door.open(id) : undefined}
    />
  );
}

/** A picture from outside Luke: a link to it, never fetched. */
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
      <ImageIcon className="picture-outside-glyph" aria-hidden="true" />
      {words}
    </TextLink>
  );
}

/** What the pictures under a plan's words share, for a place that draws them itself, as the plan's editor does; none outside `PlanPictures`. */
export function usePlanPicturesDoor(): PlanPicturesDoor | undefined {
  return useContext(PlanPicturesContext);
}

/** The drawer for the messages under `PlanPictures`; none outside one, where every picture is its alt text. */
export function usePlanPictureDrawer(): PictureDrawer | undefined {
  const door = useContext(PlanPicturesContext);
  const openLink = useOpenLink();
  return useMemo(() => {
    if (door === undefined) return undefined;
    const drawer: PictureDrawer = (src, alt, title) => {
      const named = planAttachmentOf(src);
      if (named === undefined) return <OutsidePicture href={src} alt={alt} openLink={openLink} />;
      return (
        <PlanPicture
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
