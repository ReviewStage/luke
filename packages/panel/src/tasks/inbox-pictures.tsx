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

const UNNAMED_PICTURE = "Picture";

const UNSAVEABLE = /[/\\:]/gu;

interface DrawnPicture {
  readonly attachmentId: string;
  readonly alt: string;
  readonly name: string | undefined;
  readonly anchor: RefObject<HTMLElement | null>;
}

interface InboxPicturesDoor {
  readonly itemId: string;
  readonly read: PictureReader;
  readonly register: (key: string, picture: DrawnPicture) => () => void;
  readonly open: (key: string) => void;
}

const InboxPicturesContext = createContext<InboxPicturesDoor | undefined>(undefined);

function viewerFile(alt: string, name: string | undefined, url: string): FileChip {
  const mediaType = url.slice("data:".length, url.indexOf(";"));
  const words = alt === "" ? UNNAMED_PICTURE : alt;
  const saved = name ?? `${words}.${mediaType.slice(mediaType.indexOf("/") + 1)}`;
  return { name: saved.replace(UNSAVEABLE, "-"), mediaType, url };
}

export function InboxPicture({
  attachmentId,
  alt,
  caption,
  name,
}: {
  attachmentId: string;
  alt: string;
  caption: string | undefined;
  name?: string | undefined;
}): React.JSX.Element | null {
  const door = useContext(InboxPicturesContext);
  const key = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const [place, { near, height }] = useNearView();
  const placed = useMemo(() => joinRefs(anchor, place), [place]);
  const register = door?.register;
  const state = usePicture(
    { ...pictureQuery(door?.itemId ?? "", attachmentId, door?.read), enabled: near },
    pictureUnread,
  );
  useLayoutEffect(
    () => register?.(key, { attachmentId, alt, name, anchor }),
    [register, key, attachmentId, alt, name],
  );
  if (door === undefined) return null;
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

interface ViewedPicture {
  readonly itemId: string;
  readonly key: string;
  readonly attachmentId: string;
}

interface WalkedPicture {
  readonly key: string;
  readonly attachmentId: string;
  readonly alt: string;
  readonly name: string | undefined;
}

function inDrawnOrder(drawn: ReadonlyMap<string, DrawnPicture>): readonly WalkedPicture[] {
  const standing = [...drawn].flatMap(([key, { attachmentId, alt, name, anchor }]) =>
    anchor.current === null ? [] : [{ key, attachmentId, alt, name, element: anchor.current }],
  );
  standing.sort((one, other) =>
    one.element.compareDocumentPosition(other.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  return standing.map(({ key, attachmentId, alt, name }) => ({ key, attachmentId, alt, name }));
}

function stillDrawn(drawn: ReadonlyMap<string, DrawnPicture>, shown: ViewedPicture): boolean {
  if (drawn.has(shown.key)) return true;
  return [...drawn.values()].some((picture) => picture.attachmentId === shown.attachmentId);
}

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
    setViewing((now) => (now === undefined ? now : { ...now }));
    return () => {
      drawn.current.delete(key);
      setViewing((now) => (now === undefined ? now : { ...now }));
    };
  }, []);
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
