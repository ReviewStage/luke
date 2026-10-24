import {
  type CalledPicture,
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
import {
  ALIGN,
  ATTACHMENT_CHIP_STATE,
  AttachmentChip,
  type AttachmentChipState,
  CARD_CORNER,
  CARD_ELEMENT,
  CARD_PADDING,
  Card,
  GAP,
  Inline,
  LAYOUT_ELEMENT,
  PictureTile,
  SPINNER_SIZE,
  Spinner,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  Tooltip,
} from "@luke/ui";
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
 * bytes are read, its words where it is gone. A set of two or three stands
 * in one row, each picture at its own shape, uncropped, and the row
 * stretched to the column so they share a height; a set of more stands as
 * thumbnails of one height that wrap, six of them, the sixth saying how many
 * more there are, the rest read all the same for the viewer. A call's
 * pictures are the message box's chips (`@luke/ui`'s `AttachmentChip`) under
 * its row, open or closed: a thumbnail, the spinner while read, or the
 * glyph where gone. A press on any opens the window's file viewer
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
  return (
    <PictureBlock
      state={state}
      alt={shown.name}
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
  return <Spinner delay label="Reading the picture" size={SPINNER_SIZE.INLINE} />;
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
    <span className="picture-set-tile" style={shape}>
      <Tooltip label={many ? words : undefined}>
        <PictureTile
          name={words}
          fill
          onOpen={onOpen}
          caption={
            many || shown.caption === "" ? null : (
              <Text
                as={TEXT_ELEMENT.SPAN}
                variant={TEXT_VARIANT.INHERIT}
                truncate
                className="picture-set-caption"
              >
                {shown.caption}
              </Text>
            )
          }
        >
          <Card
            as={CARD_ELEMENT.SPAN}
            corner={CARD_CORNER.CONTROL}
            padding={CARD_PADDING.FLUSH}
            className="picture-set-frame"
            style={{ aspectRatio: aspect }}
          >
            {shown.picture === undefined ? (
              <TileFace state={undefined} words={words} />
            ) : (
              <TilePicture door={door} picture={shown.picture} words={words} />
            )}
            {more > 0 ? <span className="picture-set-more">+{more}</span> : null}
          </Card>
        </PictureTile>
      </Tooltip>
    </span>
  );
}

/** A picture of a set past the six drawn, read all the same, so the viewer walks the whole set. */
function UnseenPicture({ door, picture }: { door: AgentPictureDoor; picture: KeptPicture }): null {
  usePicture(door.owner, picture.id, door.read, false);
  return null;
}

/** The words under a set of many, saying how many pictures it holds. */
function setCount(count: number): string {
  return `${String(count)} pictures`;
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
    </figure>
  );
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
  const list = (
    <Inline
      as={LAYOUT_ELEMENT.UL}
      gap={GAP.CONTROL}
      align={ALIGN.STRETCH}
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
            detail={formatBytes(each.byteCount)}
          />
        ),
      )}
      {viewer}
    </Inline>
  );
  return (
    <>
      {list}
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
