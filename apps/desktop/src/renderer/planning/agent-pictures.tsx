import {
  type CalledPicture,
  calledPicturesOf,
  type ShownPicture,
  shownPicturesOf,
} from "@luke/features/agent-pictures-model";
import type { FileChip } from "@luke/features/attachment-model";
import type { KeptPicture } from "@luke/features/conversation-picture-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  PICTURE_STATE,
  type PictureAnswer,
  type PictureState,
  pictureNow,
  usePicture,
} from "@luke/ui/picture-cache";
import { ImageOffIcon } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { useAct } from "../act";
import { PictureBlock } from "../picture-block";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { AttachmentViewer } from "./attachment-viewer";

/**
 * agent-pictures.tsx -- the pictures in an agent's transcript: a set it showed with `show_image`, and the pictures an integration's call answered, under the call's row.
 *
 * Each picture is read once through the window's picture cache
 * (`@luke/ui/picture-cache`), under the agent, or under the worker whose
 * transcript names it, and drawn as a plan's picture is
 * (`../picture-block.tsx`): its own block while one, a quiet box while its
 * bytes are read, its words where it is gone. A set of two or three stands
 * in one row, each picture at its own shape, uncropped, and the row
 * stretched to the column so they share a height; a set of more stands as
 * thumbnails of one height that wrap, six of them, the sixth saying how many
 * more there are. A call's pictures are the message box's chips under its
 * row, open or closed. A press on any opens the window's file viewer
 * walking the set, or the call's pictures, from it. Everything here is
 * left out of the screen recording, as the tab around it is.
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

/** How tall a set's row is aimed at before it is stretched to the column: a few large, many small. */
const SET_ROW_PX = { FEW: 120, MANY: 112 } as const;

/** How many pictures a set may hold and still stand in one captioned row. */
const SET_FEW = 3;

/** How many of a set's pictures are drawn before the last drawn says how many more the viewer holds. */
const SET_SHOWN = 6;

/** The shape a picture waits in while the call still reads it: a screenshot's. */
const WAITING_RATIO = 16 / 10;
const WAITING_ASPECT = "16 / 10";

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
function heldFiles(
  owner: string,
  items: readonly { readonly picture: KeptPicture; readonly words: string }[],
): readonly HeldFile[] {
  return items.flatMap(({ picture, words }) => {
    const state = pictureNow(owner, picture.id);
    if (state.kind !== PICTURE_STATE.READY) return [];
    const file = { name: viewerName(words, picture), mediaType: picture.mediaType, url: state.url };
    return [{ file, id: picture.id }];
  });
}

/** The viewer a set or a call's chips open: how one is opened over the files held, and the viewer while it stands. */
interface PictureViewer {
  readonly open: (files: readonly HeldFile[], id: string) => void;
  readonly viewer: ReactNode;
}

/** The viewer over the files held, from the one named, until it is closed. */
function useViewer(): PictureViewer {
  const [viewing, setViewing] = useState<{ files: readonly FileChip[]; at: number } | undefined>();
  const open = useCallback((files: readonly HeldFile[], id: string) => {
    const at = files.findIndex((each) => each.id === id);
    if (at >= 0) setViewing({ files: files.map((each) => each.file), at });
  }, []);
  const viewer =
    viewing === undefined ? null : (
      <AttachmentViewer
        files={viewing.files}
        at={viewing.at}
        onAt={(at) => setViewing({ ...viewing, at })}
        onClose={() => setViewing(undefined)}
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
  return (
    <PictureBlock
      state={state}
      alt={shown.caption}
      caption={shown.caption === "" ? undefined : shown.caption}
      onOpen={onOpen}
    />
  );
}

/** What a tile shows: the picture, the spinner while it is read, or the glyph where it is gone. */
function TileFace({ state, words }: { state: PictureState | undefined; words: string }): ReactNode {
  if (state?.kind === PICTURE_STATE.READY) {
    return (
      <img
        className="picture-set-image"
        src={state.url}
        alt={words}
        decoding="async"
        draggable={false}
      />
    );
  }
  if (state?.kind === PICTURE_STATE.MISSING) return <ImageOffIcon aria-hidden="true" />;
  return <Spinner label="Reading the picture" size={SPINNER_SIZE.INLINE} />;
}

/** A tile's picture read through the cache; none for a picture the call has not answered yet. */
function TilePicture({
  door,
  picture,
  words,
}: {
  door: AgentPictureDoor;
  picture: KeptPicture;
  words: string;
}): ReactNode {
  return <TileFace state={usePicture(door.owner, picture.id, door.read)} words={words} />;
}

/** One tile of a set: at its own shape, never cropped; the last one drawn of many says how many more there are. */
function SetTile({
  door,
  shown,
  many,
  more,
  onOpen,
}: {
  door: AgentPictureDoor;
  shown: ShownPicture;
  many: boolean;
  more: number;
  onOpen: () => void;
}): ReactNode {
  const ratio =
    shown.picture === undefined ? WAITING_RATIO : shown.picture.width / shown.picture.height;
  const aspect =
    shown.picture === undefined
      ? WAITING_ASPECT
      : `${String(shown.picture.width)} / ${String(shown.picture.height)}`;
  const words = shown.caption === "" ? shown.name : shown.caption;
  // Note that many tiles keep one height and wrap rather than stretching to the column, because a
  // row the narrow column leaves one tile in would otherwise draw that tile the column's whole width.
  const shape = many
    ? { flex: "0 0 auto", width: `${String(Math.round(ratio * SET_ROW_PX.MANY))}px` }
    : { flexGrow: ratio, flexBasis: `${String(Math.round(ratio * SET_ROW_PX.FEW))}px` };
  return (
    <button
      type="button"
      className="picture-set-tile"
      style={shape}
      aria-label={`Enlarge ${words}`}
      title={many ? words : undefined}
      onClick={onOpen}
    >
      <span className="picture-set-frame" style={{ aspectRatio: aspect }}>
        {shown.picture === undefined ? (
          <TileFace state={undefined} words={words} />
        ) : (
          <TilePicture door={door} picture={shown.picture} words={words} />
        )}
        {more > 0 ? <span className="picture-set-more">+{more}</span> : null}
      </span>
      {many || shown.caption === "" ? null : (
        <span className="picture-set-caption">{shown.caption}</span>
      )}
    </button>
  );
}

/** The words under a set of many, saying how many pictures it holds. */
function setCount(count: number): string {
  return `${String(count)} pictures`;
}

/**
 * A `show_image` call drawn as what it showed: one picture as its own block,
 * several as one set, each in its place while the call reads it.
 */
export function ShownPictures({
  input,
  output,
}: {
  input: Parameters<typeof shownPicturesOf>[0];
  output: Parameters<typeof shownPicturesOf>[1];
}): ReactNode {
  const door = useContext(AgentPicturesContext);
  const { open, viewer } = useViewer();
  const shown = shownPicturesOf(input, output);
  if (door === undefined || shown.length === 0) return null;
  const kept = shown.flatMap((each) =>
    each.picture === undefined
      ? []
      : [{ picture: each.picture, words: each.caption === "" ? each.name : each.caption }],
  );
  const openAt = (id: string) => open(heldFiles(door.owner, kept), id);
  const [only] = shown;
  if (shown.length === 1 && only !== undefined && only.picture === undefined) {
    const caption = only.caption === "" ? undefined : only.caption;
    return (
      <PictureBlock state={{ kind: PICTURE_STATE.READING }} alt={only.caption} caption={caption} />
    );
  }
  if (shown.length === 1 && only?.picture !== undefined) {
    const picture = only.picture;
    return (
      <>
        <ShownOne door={door} shown={{ ...only, picture }} onOpen={() => openAt(picture.id)} />
        {viewer}
      </>
    );
  }
  const many = shown.length > SET_FEW;
  const drawn = shown.slice(0, SET_SHOWN);
  return (
    <figure className="picture-set ph-no-capture" data-count={shown.length}>
      <div className="picture-set-tiles">
        {drawn.map((each, index) => (
          <SetTile
            // Note that a picture's place in its set is its identity: a set never reorders.
            key={index}
            door={door}
            shown={each}
            many={many}
            more={index === drawn.length - 1 ? shown.length - drawn.length : 0}
            onOpen={() => {
              if (each.picture !== undefined) openAt(each.picture.id);
            }}
          />
        ))}
      </div>
      {many ? <figcaption className="picture-caption">{setCount(shown.length)}</figcaption> : null}
      {viewer}
    </figure>
  );
}

/** How a size is said under a picture that was not kept. */
function sizeWords(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${String(Math.max(1, Math.round(bytes / 1000)))} KB`;
}

/** What a chip says of a picture that was not kept. */
const NOT_KEPT = "Not kept";

/** One chip under a call's row: its picture, its place while read, or why it is not there. */
function CallChip({
  door,
  called,
  onOpen,
}: {
  door: AgentPictureDoor;
  called: Extract<CalledPicture, { kept: true }>;
  onOpen: () => void;
}): ReactNode {
  const state = usePicture(door.owner, called.picture.id, door.read);
  if (state.kind !== PICTURE_STATE.READY) {
    return (
      <li className="attached-file call-picture" data-state={state.kind} title={called.name}>
        <span className="attached-file-face">
          <TileFace state={state} words={called.name} />
        </span>
      </li>
    );
  }
  return (
    <li className="attached-file call-picture" title={called.name}>
      <button
        type="button"
        className="attached-file-face"
        aria-label={`Open ${called.name}`}
        onClick={onOpen}
      >
        <img src={state.url} alt={called.name} />
      </button>
    </li>
  );
}

/**
 * The pictures an integration's call answered, as a row of chips under its
 * line, open or closed: one kept is its thumbnail, opening the viewer over
 * the call's pictures; one not kept says so, with its size, since the
 * model saw it all the same.
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
  const { open, viewer } = useViewer();
  const called = calledPicturesOf(tool, input, output);
  if (door === undefined || called.length === 0) return null;
  const kept = called.flatMap((each) =>
    each.kept ? [{ picture: each.picture, words: each.name }] : [],
  );
  return (
    <ul
      className="attached-files call-pictures ph-no-capture"
      aria-label="Pictures the call answered"
    >
      {called.map((each, index) =>
        each.kept ? (
          <CallChip
            // Note that a picture's place among its call's is its identity: an answer never reorders.
            key={index}
            door={door}
            called={each}
            onOpen={() => open(heldFiles(door.owner, kept), each.picture.id)}
          />
        ) : (
          <li
            // Note that a picture's place among its call's is its identity: an answer never reorders.
            key={index}
            className="attached-file call-picture"
            data-state={each.omitted}
            title={`${each.name}: ${NOT_KEPT}, ${sizeWords(each.byteCount)}`}
          >
            <span className="attached-file-face">
              <ImageOffIcon aria-hidden="true" />
              <span className="attached-file-name">{NOT_KEPT}</span>
              <span className="attached-file-size">{sizeWords(each.byteCount)}</span>
            </span>
          </li>
        ),
      )}
      {viewer}
    </ul>
  );
}
