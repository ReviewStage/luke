import {
  calledPicturesOf,
  recordedVideosOf,
  type ShownPicture,
  shownPicturesOf,
} from "@luke/features/agent-pictures-model";
import type { FileChip } from "@luke/features/attachment-model";
import {
  CODING_AGENT_ATTACHMENT_TYPE,
  type CodingAgentAttachment,
  type CodingAgentMessage,
} from "@luke/features/coding-agent-wire";
import { isVideoType, type KeptPicture } from "@luke/features/conversation-picture-wire";
import { formatBytes } from "@luke/features/number-format";
import { ACT_KIND } from "@luke/host/acts";
import { isVideoDataUrl, PICTURE_SET_SHOWN, PictureSet, PictureSetTile } from "@luke/ui";
import { PICTURE_STATE, type PictureAnswer, pictureNow, usePicture } from "@luke/ui/picture-cache";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { useAct } from "../act.js";
import { PictureBlock } from "../picture-block.js";
import { useAddToPlan } from "./add-to-plan.js";
import { AttachedFileChips, messageFileChips } from "./attached-file-chips.js";
import { AttachmentViewer, type ViewerAction } from "./attachment-viewer.js";

/**
 * agent-pictures.tsx -- the pictures in an agent's transcript: a set it showed with `show_image`, the pictures an integration's call answered, under the call's row, and an image a line handed it, over the line.
 *
 * Each picture is read once through the window's picture cache
 * (`@luke/ui/picture-cache`), under the agent, or under the worker whose
 * transcript names it, and drawn as a plan's picture is
 * (`../picture-block.tsx`): its own block while one, a quiet box while its
 * bytes are read, its words where it is gone. Several, whether the agent
 * showed them or an integration's call answered them under the call's row,
 * open or closed, are one set of tiles (`@luke/ui`'s `PictureSet`): a few
 * the agent showed in one row at their own shapes, more, and a call's
 * however few, as thumbnails that wrap, six drawn and
 * the rest read all the same for the viewer; a picture the call answered
 * that was not kept says so, with its size, since the model saw it all the
 * same, and a gone tile opens nothing. A press on any other opens the window's file viewer
 * walking the set, or the call's pictures, from it, with Add to plan
 * beside Download where the transcript is drawn on a plan's page. A WebM
 * the agent recorded, shown as a picture or answered by its browser's
 * `stop_recording`, plays where it stands instead, its own block above the
 * call's pictures, with the player's own controls, Full screen among them
 * (`@luke/ui`'s `VideoPlayer`); its Expand opens the same viewer over the
 * call's videos and pictures, which plays it there. An image a line handed
 * the agent, which its row names by the picture it was kept as rather than
 * carrying its bytes, is read the same way and drawn among the line's files
 * (`MessageFileChips`).
 * Everything here is left out of the screen recording, as the tab around
 * it is.
 */

/** Where an agent's or a worker's pictures are read through: the scope the cache keeps them under, and the read. */
export interface AgentPictureDoor {
  readonly owner: string;
  readonly read: (owner: string, id: string) => Promise<PictureAnswer>;
}

const AgentPicturesContext = createContext<AgentPictureDoor | undefined>(undefined);

/** Hands the transcript under it the door its pictures are read through. */
export const AgentPicturesProvider = AgentPicturesContext.Provider;

/**
 * The door to an agent's pictures, or a worker's where `callId` names the
 * delegation that started it; the cache keeps a worker's under its call, as
 * the service reads them from its own transcript.
 */
export function useAgentPictureDoor(agentId: string, callId?: string): AgentPictureDoor {
  const { act } = useAct();
  const read = useCallback(
    (_owner: string, pictureId: string) =>
      act(ACT_KIND.CODING_AGENTS_PICTURE, {
        agentId,
        pictureId,
        ...(callId === undefined ? undefined : { callId }),
      }),
    [act, agentId, callId],
  );
  return useMemo(() => ({ owner: callId ?? agentId, read }), [agentId, callId, read]);
}

/** What the viewer saves a picture as: its words, or its file's name, under its type's extension. */
function viewerName(words: string, picture: KeptPicture): string {
  const extension = picture.mediaType.slice(picture.mediaType.indexOf("/") + 1);
  return `${words.replaceAll(/[/\\:]/gu, "-")}.${extension}`;
}

/** A held picture as the viewer takes it, beside the id it is opened by. */
interface HeldFile {
  readonly file: FileChip;
  readonly id: string;
}

/** The pictures among `items` the window holds now, as the viewer takes files, each beside the place it stands at. */
function heldFiles(owner: string, items: readonly ViewedPicture[]): readonly HeldFile[] {
  return items.flatMap(({ picture, words }) => {
    const state = pictureNow(owner, picture.id);
    if (state.kind !== PICTURE_STATE.READY) return [];
    const file = { name: viewerName(words, picture), mediaType: picture.mediaType, url: state.url };
    return [{ file, id: picture.id }];
  });
}

/** A picture a viewer walks: what it was kept as, and its words. */
interface ViewedPicture {
  readonly picture: KeptPicture;
  readonly words: string;
}

/** The viewer a set or a call's chips open: how one is opened over its pictures, and the viewer while it stands. */
interface PictureViewer {
  readonly open: (items: readonly ViewedPicture[], id: string) => void;
  readonly viewer: ReactNode;
}

/** One picture read through the door, watched so what draws it is drawn again as its read lands. */
function PictureWatch({
  door,
  id,
  onSettled,
}: {
  door: AgentPictureDoor;
  id: string;
  onSettled: () => void;
}): null {
  const state = usePicture(door.owner, id, door.read);
  useEffect(() => onSettled(), [state.kind, onSettled]);
  return null;
}

/**
 * The viewer over a set's pictures, from the one named: each picture held
 * now among the files it walks, and each still read joining them as its
 * read lands, so a press on the first picture to land reaches the rest.
 */
function OpenViewer({
  door,
  items,
  id,
  onId,
  onClose,
  action,
}: {
  door: AgentPictureDoor;
  items: readonly ViewedPicture[];
  id: string;
  onId: (id: string) => void;
  onClose: () => void;
  action: ViewerAction | undefined;
}): ReactNode {
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const files = heldFiles(door.owner, items);
  const at = files.findIndex((each) => each.id === id);
  return (
    <>
      {items.map((each) => (
        <PictureWatch key={each.picture.id} door={door} id={each.picture.id} onSettled={redraw} />
      ))}
      {at < 0 ? null : (
        <AttachmentViewer
          files={files.map((each) => each.file)}
          at={at}
          onAt={(next) => {
            const shown = files[next];
            if (shown !== undefined) onId(shown.id);
          }}
          onClose={onClose}
          action={action}
        />
      )}
    </>
  );
}

/** The viewer over a set's pictures, from the one named, until it is closed. */
function useViewer(door: AgentPictureDoor | undefined): PictureViewer {
  const addToPlan = useAddToPlan();
  const [viewing, setViewing] = useState<
    { readonly items: readonly ViewedPicture[]; readonly id: string } | undefined
  >();
  const open = useCallback(
    (items: readonly ViewedPicture[], id: string) => setViewing({ items, id }),
    [],
  );
  const viewer =
    viewing === undefined || door === undefined ? null : (
      <OpenViewer
        door={door}
        items={viewing.items}
        id={viewing.id}
        onId={(id) => setViewing({ ...viewing, id })}
        onClose={() => setViewing(undefined)}
        action={addToPlan}
      />
    );
  return { open, viewer };
}

/** One picture of a set the agent showed alone: its own block, at its own size up to the column's. */
function ShownOne({
  door,
  shown,
  onOpen,
}: {
  door: AgentPictureDoor;
  shown: ShownPicture & { readonly picture: KeptPicture };
  onOpen: () => void;
}): ReactNode {
  const state = usePicture(door.owner, shown.picture.id, door.read);
  // Note that a picture is described by its file's name, since its caption is drawn beside it, but a video's player is named by the caption, because "Video: flow" says nothing of what it shows.
  const video = state.kind === PICTURE_STATE.READY && isVideoDataUrl(state.url);
  return (
    <PictureBlock
      state={state}
      alt={video && shown.caption !== "" ? shown.caption : shown.name}
      caption={shown.caption === "" ? undefined : shown.caption}
      onOpen={onOpen}
    />
  );
}

/** One tile of a set the agent showed, read through the door; one the call has not answered yet waits. */
function ShownTile({
  door,
  shown,
  onOpen,
}: {
  door: AgentPictureDoor;
  shown: ShownPicture;
  onOpen: (id: string) => void;
}): ReactNode {
  const words = shown.caption === "" ? shown.name : shown.caption;
  if (shown.picture === undefined) {
    return (
      <PictureSetTile
        state={{ kind: PICTURE_STATE.READING }}
        words={words}
        caption={shown.caption}
      />
    );
  }
  return (
    <KeptTile
      door={door}
      picture={shown.picture}
      words={words}
      caption={shown.caption}
      onOpen={onOpen}
    />
  );
}

/** A tile of a picture that was kept, read through the door, opening the viewer from it. */
function KeptTile({
  door,
  picture,
  words,
  caption,
  onOpen,
}: {
  door: AgentPictureDoor;
  picture: KeptPicture;
  words: string;
  caption: string;
  onOpen: (id: string) => void;
}): ReactNode {
  return (
    <PictureSetTile
      state={usePicture(door.owner, picture.id, door.read)}
      width={picture.width}
      height={picture.height}
      words={words}
      caption={caption}
      onOpen={() => onOpen(picture.id)}
    />
  );
}

/** A picture of a set past the six drawn, read all the same, so the viewer walks the whole set. */
function UnseenPicture({ door, picture }: { door: AgentPictureDoor; picture: KeptPicture }): null {
  usePicture(door.owner, picture.id, door.read, false);
  return null;
}

/** The pictures of a set past the six drawn, each read ahead for the viewer. */
function UnseenPictures({
  door,
  pictures,
}: {
  door: AgentPictureDoor;
  pictures: readonly (KeptPicture | undefined)[];
}): ReactNode {
  return pictures
    .slice(PICTURE_SET_SHOWN)
    .flatMap((picture) =>
      picture === undefined
        ? []
        : [<UnseenPicture key={picture.id} door={door} picture={picture} />],
    );
}

/**
 * A `show_image` call drawn as what it showed: one picture or video as its
 * own block, several as one set, each in its place while the call reads it.
 */
export function ShownPictures({
  input,
  output,
}: {
  input: Parameters<typeof shownPicturesOf>[0];
  output: Parameters<typeof shownPicturesOf>[1];
}): ReactNode {
  const door = useContext(AgentPicturesContext);
  const all = shownPicturesOf(input, output);
  if (door === undefined || all.length === 0) return null;
  return <ShownSet door={door} shown={all} />;
}

/** Whether a shown file was kept as a video, played where it stands rather than drawn in a set. */
function isShownVideo(
  shown: ShownPicture,
): shown is ShownPicture & { readonly picture: KeptPicture } {
  return shown.picture !== undefined && isVideoType(shown.picture.mediaType);
}

/**
 * The pictures and videos of a `show_image` call, or a browser call's
 * recordings: each video played as its own block, then one picture as its
 * own block or several as one set, and one viewer over them all, which a
 * picture's press and a video's Expand open alike.
 */
function ShownSet({
  door,
  shown,
}: {
  door: AgentPictureDoor;
  shown: readonly ShownPicture[];
}): ReactNode {
  const { open, viewer } = useViewer(door);
  const videos = shown.filter(isShownVideo);
  const stills = shown.filter((each) => !isShownVideo(each));
  // Note that the viewer walks them in the order they are drawn, videos first, rather than the order the call named them.
  const kept = [...videos, ...stills].flatMap((each) =>
    each.picture === undefined
      ? []
      : [{ picture: each.picture, words: each.caption === "" ? each.name : each.caption }],
  );
  const openAt = (id: string) => open(kept, id);
  return (
    <>
      {videos.map((each, index) => (
        // Note that a video's place among the call's is its identity: a call never reorders.
        <ShownOne key={index} door={door} shown={each} onOpen={() => openAt(each.picture.id)} />
      ))}
      {stills.length === 0 ? null : <ShownStills door={door} shown={stills} openAt={openAt} />}
      {viewer}
    </>
  );
}

/** The pictures of a call that are no video: one as its own block, several as one set. */
function ShownStills({
  door,
  shown,
  openAt,
}: {
  door: AgentPictureDoor;
  shown: readonly ShownPicture[];
  openAt: (id: string) => void;
}): ReactNode {
  const [only] = shown;
  if (shown.length === 1 && only !== undefined && only.picture === undefined) {
    const caption = only.caption === "" ? undefined : only.caption;
    return (
      <PictureBlock state={{ kind: PICTURE_STATE.READING }} alt={only.name} caption={caption} />
    );
  }
  if (shown.length === 1 && only?.picture !== undefined) {
    const picture = only.picture;
    return <ShownOne door={door} shown={{ ...only, picture }} onOpen={() => openAt(picture.id)} />;
  }
  return (
    <div className="transcript-picture-set">
      <PictureSet label={SHOWN_LABEL} count={shown.length}>
        {shown.slice(0, PICTURE_SET_SHOWN).map((each, index) => (
          // Note that a picture's place in its set is its identity: a set never reorders.
          <ShownTile key={index} door={door} shown={each} onOpen={openAt} />
        ))}
      </PictureSet>
      <UnseenPictures door={door} pictures={shown.map((each) => each.picture)} />
    </div>
  );
}

/** What a set the agent showed is named, and what the pictures under a call's row are. */
const SHOWN_LABEL = "Pictures the agent showed";
const CALLED_LABEL = "Pictures the call answered";

/** Why a picture the call answered is not drawn: it was not kept, though the model saw it. */
function notKeptWords(byteCount: number): string {
  return `not kept · ${formatBytes(byteCount)}`;
}

/**
 * The pictures an integration's call answered, as a row of chips under its
 * line, open or closed: one kept is its thumbnail, opening the viewer over
 * the call's pictures; one not kept says so, with its size, since the
 * model saw it all the same. The videos a browser call recorded stand
 * under them as a `show_image` call's would.
 */
export function CallPictures({
  tool,
  input,
  output,
}: {
  tool: string;
  input: Parameters<typeof calledPicturesOf>[1];
  output: Parameters<typeof calledPicturesOf>[2];
}): ReactNode {
  const door = useContext(AgentPicturesContext);
  const { open, viewer } = useViewer(door);
  const called = calledPicturesOf(tool, input, output);
  const recorded = recordedVideosOf(tool, output);
  if (door === undefined || (called.length === 0 && recorded.length === 0)) return null;
  const videos = recorded.length === 0 ? null : <ShownSet door={door} shown={recorded} />;
  if (called.length === 0) return <>{videos}</>;
  const kept = called.flatMap((each) =>
    each.kept ? [{ picture: each.picture, words: each.name }] : [],
  );
  const openAt = (id: string) => open(kept, id);
  return (
    <>
      <div className="call-pictures">
        <PictureSet label={CALLED_LABEL} count={called.length} thumbnails>
          {called.slice(0, PICTURE_SET_SHOWN).map((each, index) =>
            each.kept ? (
              <KeptTile
                // Note that a picture's place among its call's is its identity: an answer never reorders.
                key={index}
                door={door}
                picture={each.picture}
                words={each.name}
                caption=""
                onOpen={openAt}
              />
            ) : (
              <PictureSetTile
                // Note that a picture's place among its call's is its identity: an answer never reorders.
                key={index}
                state={{ kind: PICTURE_STATE.MISSING }}
                words={each.name}
                why={notKeptWords(each.byteCount)}
              />
            ),
          )}
        </PictureSet>
        <UnseenPictures
          door={door}
          pictures={called.map((each) => (each.kept ? each.picture : undefined))}
        />
        {viewer}
      </div>
      {videos}
    </>
  );
}

/** The media types a message may carry a file of, as the wire takes them. */
const ATTACHMENT_TYPES: ReadonlySet<string> = new Set(Object.values(CODING_AGENT_ATTACHMENT_TYPE));

/** A file's bytes as a message carries them, read off a `data:` address; none for any other address. */
function attachmentOfData(name: string, url: string): CodingAgentAttachment | undefined {
  const read = /^data:([^;,]+);base64,(.+)$/u.exec(url);
  const mediaType = read?.[1];
  const data = read?.[2];
  if (mediaType === undefined || data === undefined || !ATTACHMENT_TYPES.has(mediaType)) {
    return undefined;
  }
  // SAFETY: the type was just found among the wire's own.
  return { name, mediaType: mediaType as CodingAgentAttachment["mediaType"], data };
}

/** One of a line's files as Edit carries it again, by its place on the line, which never changes. */
export interface LineAttachment {
  readonly key: string;
  readonly attachment: CodingAgentAttachment;
}

/**
 * A line's files as a message to the agent carries them again, for Edit to
 * send: each one the line holds inline, and each one kept as a picture whose
 * bytes the window has read, by its place on the line; and whether a
 * picture is still being read, which joins them once it lands
 * (`LinePicturesWatch`). One that is gone is left out.
 */
export function useLineAttachments(message: CodingAgentMessage): {
  readonly attachments: readonly LineAttachment[];
  readonly reading: boolean;
} {
  const door = useContext(AgentPicturesContext);
  let reading = false;
  const attachments = messageFileChips(message).flatMap(
    ({ name, url, pictureId }, index): LineAttachment[] => {
      const state =
        pictureId === undefined || door === undefined
          ? undefined
          : pictureNow(door.owner, pictureId);
      if (
        state !== undefined &&
        state.kind !== PICTURE_STATE.READY &&
        state.kind !== PICTURE_STATE.MISSING
      ) {
        reading = true;
      }
      const attachment = attachmentOfData(
        name,
        state?.kind === PICTURE_STATE.READY ? state.url : url,
      );
      return attachment === undefined ? [] : [{ key: String(index), attachment }];
    },
  );
  return { attachments, reading };
}

/** Reads a line's kept pictures through the agent's door, and says so each time one settles; draws nothing. */
export function LinePicturesWatch({
  message,
  onSettled,
}: {
  message: CodingAgentMessage;
  onSettled: () => void;
}): ReactNode {
  const door = useContext(AgentPicturesContext);
  if (door === undefined) return null;
  return messageFileChips(message).map(({ pictureId }, index) =>
    pictureId === undefined ? null : (
      // Note that a file's place on its line is its identity: a line never reorders.
      <PictureWatch key={index} door={door} id={pictureId} onSettled={onSettled} />
    ),
  );
}

/**
 * The files on a line of the transcript, as chips: each from the bytes its
 * row carries, and an image its row names by the picture it was kept as
 * read through the agent's door, so it draws its thumbnail and opens once
 * the read lands, and is its name alone while read or where it is gone.
 * A line still on its way draws its files going up.
 */
export function MessageFileChips({
  message,
  sending = false,
}: {
  message: CodingAgentMessage;
  /** Whether the line is still on its way, its row not yet read back. */
  sending?: boolean;
}): ReactNode {
  const door = useContext(AgentPicturesContext);
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const files = messageFileChips(message);
  const chips = files.map(({ pictureId, ...chip }): FileChip => {
    if (pictureId === undefined || door === undefined) return chip;
    const state = pictureNow(door.owner, pictureId);
    return state.kind === PICTURE_STATE.READY ? { ...chip, url: state.url } : chip;
  });
  return (
    <>
      {door === undefined
        ? null
        : files.map(({ pictureId }, index) =>
            pictureId === undefined ? null : (
              // Note that a file's place on its line is its identity: a line never reorders.
              <PictureWatch key={index} door={door} id={pictureId} onSettled={redraw} />
            ),
          )}
      <AttachedFileChips files={chips} uploading={sending} />
    </>
  );
}
