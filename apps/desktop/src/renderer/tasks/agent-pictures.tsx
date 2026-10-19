import {
  type CalledPicture,
  calledPicturesOf,
  type ShownPicture,
  shownPicturesOf,
} from "@luke/features/agent-pictures-model";
import type { FileChip } from "@luke/features/attachment-model";
import type { KeptPicture } from "@luke/features/conversation-picture-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import { PictureBlock } from "@luke/panel/picture-block";
import { SPINNER_SIZE, Spinner } from "@luke/panel/spinner";
import { AttachmentViewer, type ViewerAction } from "@luke/panel/tasks/attachment-viewer";
import { Tooltip } from "@luke/panel/tooltip";
import { ATTACHMENT_CHIP_STATE, AttachmentChip, type AttachmentChipState } from "@luke/ui";
import {
  PICTURE_STATE,
  type PictureAnswer,
  type PictureState,
  pictureNow,
  usePicture,
} from "@luke/ui/picture-cache";
import { ImageOffIcon } from "lucide-react";
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
import { useAddToPlan } from "./add-to-plan";

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
 * more there are, the rest read all the same for the viewer. A call's
 * pictures are the message box's chips (`@luke/ui`'s `AttachmentChip`) under
 * its row, open or closed: a thumbnail, the spinner while read, or the
 * glyph where gone. A press on any opens the window's file viewer
 * walking the set, or the call's pictures, from it, with Add to plan
 * beside Download where the transcript is drawn on a plan's page. Everything here is
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

/** One picture of an open viewer's set, watched so the viewer is drawn again as its read lands. */
function PictureWatch({
  door,
  picture,
  onSettled,
}: {
  door: AgentPictureDoor;
  picture: KeptPicture;
  onSettled: () => void;
}): null {
  const state = usePicture(door.owner, picture.id, door.read);
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
        <PictureWatch key={each.picture.id} door={door} picture={each.picture} onSettled={redraw} />
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
    <Tooltip label={many ? words : undefined}>
      <button
        type="button"
        className="picture-set-tile"
        style={shape}
        aria-label={`Enlarge ${words}`}
        onClick={onOpen}
      >
        <span className="picture-set-frame" data-focus-ring="" style={{ aspectRatio: aspect }}>
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
    </Tooltip>
  );
}

/** A picture of a set past the six drawn, read all the same, so the viewer walks the whole set. */
function UnseenPicture({ door, picture }: { door: AgentPictureDoor; picture: KeptPicture }): null {
  usePicture(door.owner, picture.id, door.read);
  return null;
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
  const { open, viewer } = useViewer(door);
  const shown = shownPicturesOf(input, output);
  if (door === undefined || shown.length === 0) return null;
  const kept = shown.flatMap((each) =>
    each.picture === undefined
      ? []
      : [{ picture: each.picture, words: each.caption === "" ? each.name : each.caption }],
  );
  const openAt = (id: string) => open(kept, id);
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
      {shown
        .slice(SET_SHOWN)
        .flatMap((each) =>
          each.picture === undefined
            ? []
            : [<UnseenPicture key={each.picture.id} door={door} picture={each.picture} />],
        )}
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

/** Where a kept picture's chip stands as its read does. */
const CHIP_STATE = {
  [PICTURE_STATE.READING]: ATTACHMENT_CHIP_STATE.LOADING,
  [PICTURE_STATE.READY]: ATTACHMENT_CHIP_STATE.READY,
  [PICTURE_STATE.MISSING]: ATTACHMENT_CHIP_STATE.FAILED,
} as const satisfies Record<PictureState["kind"], AttachmentChipState>;

/** One chip under a call's row: its picture, its place while read, or that it is gone. */
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
  return (
    <AttachmentChip
      name={called.name}
      image={state.kind === PICTURE_STATE.READY ? state.url : undefined}
      icon={<ImageOffIcon aria-hidden="true" />}
      state={CHIP_STATE[state.kind]}
      onOpen={onOpen}
    />
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
  const { open, viewer } = useViewer(door);
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
            onOpen={() => open(kept, each.picture.id)}
          />
        ) : (
          <AttachmentChip
            // Note that a picture's place among its call's is its identity: an answer never reorders.
            key={index}
            name={each.name}
            icon={<ImageOffIcon aria-hidden="true" />}
            state={ATTACHMENT_CHIP_STATE.FAILED}
            failure={NOT_KEPT}
            detail={sizeWords(each.byteCount)}
          />
        ),
      )}
      {viewer}
    </ul>
  );
}
