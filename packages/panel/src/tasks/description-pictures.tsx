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

const UNNAMED_PICTURE = "Picture";

const DATA_URL_TYPE = /^data:([^;,]+)[;,]/u;

export interface DescriptionPicturesDoor {
  readonly taskId: string;
  readonly read: PictureReader;
  readonly open: (id: string) => void;
  readonly name: (id: string, alt: string) => void;
}

const DescriptionPicturesContext = createContext<DescriptionPicturesDoor | undefined>(undefined);

interface Viewing {
  readonly ids: readonly string[];
  readonly files: readonly FileChip[];
  readonly at: number;
}

function chipOf(url: string, name: string): FileChip {
  return { name, mediaType: DATA_URL_TYPE.exec(url)?.[1] ?? "", url };
}

function sectionOfPicture(text: string, taskId: string, id: string): string | undefined {
  return descriptionSections(text).find((section) =>
    taskPicturesIn(section.text).some((address) => {
      const named = descriptionAttachmentOf(address);
      return named?.taskId === taskId && named.attachmentId === id;
    }),
  )?.heading;
}

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

export function useDescriptionPicturesDoor(): DescriptionPicturesDoor | undefined {
  return useContext(DescriptionPicturesContext);
}

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
