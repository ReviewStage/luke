import {
  calledPicturesOf,
  recordedVideosOf,
  type ShownPicture,
  shownPicturesOf,
} from "@repo/features/agent-pictures-model";
import {
  AGENT_ATTACHMENT_TYPE,
  type AgentAttachment,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import type { FileChip } from "@repo/features/attachment-model";
import { isVideoType, type KeptPicture } from "@repo/features/conversation-picture-wire";
import { formatBytes } from "@repo/features/number-format";
import { ACT_KIND } from "@repo/host/acts";
import { isVideoDataUrl, PICTURE_SET_SHOWN, PictureSet, PictureSetTile } from "@repo/ui";
import {
  PICTURE_STATE,
  type PictureState,
  pictureStateOf,
  usePicture,
} from "@repo/ui/picture-read";
import { useQueries } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { askAct } from "../act.js";
import { pictureUnread } from "../failure-report.js";
import { PictureBlock } from "../picture-block.js";
import { type PictureReader, pictureQuery } from "../picture-query.js";
import { useAddToDescription } from "./add-to-description.js";
import {
  AttachedFileChips,
  type MessageFileChip,
  messageFileChips,
} from "./attached-file-chips.js";
import { AttachmentViewer, type ViewerAction } from "./attachment-viewer.js";

export interface AgentPictureDoor {
  readonly owner: string;
  readonly read: PictureReader;
}

const AgentPicturesContext = createContext<AgentPictureDoor | undefined>(undefined);

export const AgentPicturesProvider = AgentPicturesContext.Provider;

export function useAgentPictureDoor(agentId: string, callId?: string): AgentPictureDoor {
  const read = useCallback(
    (_owner: string, pictureId: string) =>
      askAct(ACT_KIND.AGENTS_PICTURE, {
        agentId,
        pictureId,
        ...(callId === undefined ? undefined : { callId }),
      }),
    [agentId, callId],
  );
  return useMemo(() => ({ owner: callId ?? agentId, read }), [agentId, callId, read]);
}

function viewerName(words: string, picture: KeptPicture): string {
  const extension = picture.mediaType.slice(picture.mediaType.indexOf("/") + 1);
  return `${words.replaceAll(/[/\\:]/gu, "-")}.${extension}`;
}

interface HeldFile {
  readonly file: FileChip;
  readonly id: string;
}

function usePictureStates(
  door: AgentPictureDoor | undefined,
  ids: readonly (string | undefined)[],
): readonly PictureState[] {
  return useQueries({
    queries: ids.map((id) =>
      pictureQuery(
        door?.owner ?? "",
        id ?? "",
        door === undefined || id === undefined ? undefined : door.read,
      ),
    ),
    combine: (results) => results.map((result) => pictureStateOf(result.data)),
  });
}

function heldFiles(
  items: readonly ViewedPicture[],
  states: readonly PictureState[],
): readonly HeldFile[] {
  return items.flatMap(({ picture, words }, index) => {
    const state = states[index];
    if (state?.kind !== PICTURE_STATE.READY) return [];
    const file = { name: viewerName(words, picture), mediaType: picture.mediaType, url: state.url };
    return [{ file, id: picture.id }];
  });
}

interface ViewedPicture {
  readonly picture: KeptPicture;
  readonly words: string;
}

interface PictureViewer {
  readonly open: (items: readonly ViewedPicture[], id: string) => void;
  readonly viewer: ReactNode;
}

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
  const states = usePictureStates(
    door,
    items.map((each) => each.picture.id),
  );
  const files = heldFiles(items, states);
  const at = files.findIndex((each) => each.id === id);
  return at < 0 ? null : (
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
  );
}

function useViewer(door: AgentPictureDoor | undefined): PictureViewer {
  const addToDescription = useAddToDescription();
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
        action={addToDescription}
      />
    );
  return { open, viewer };
}

function ShownOne({
  door,
  shown,
  onOpen,
}: {
  door: AgentPictureDoor;
  shown: ShownPicture & { readonly picture: KeptPicture };
  onOpen: () => void;
}): ReactNode {
  const state = usePicture(pictureQuery(door.owner, shown.picture.id, door.read), pictureUnread);
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
      state={usePicture(pictureQuery(door.owner, picture.id, door.read), pictureUnread)}
      width={picture.width}
      height={picture.height}
      words={words}
      caption={caption}
      onOpen={() => onOpen(picture.id)}
    />
  );
}

function UnseenPicture({ door, picture }: { door: AgentPictureDoor; picture: KeptPicture }): null {
  usePicture(pictureQuery(door.owner, picture.id, door.read), pictureUnread);
  return null;
}

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

function isShownVideo(
  shown: ShownPicture,
): shown is ShownPicture & { readonly picture: KeptPicture } {
  return shown.picture !== undefined && isVideoType(shown.picture.mediaType);
}

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
  const kept = [...videos, ...stills].flatMap((each) =>
    each.picture === undefined
      ? []
      : [{ picture: each.picture, words: each.caption === "" ? each.name : each.caption }],
  );
  const openAt = (id: string) => open(kept, id);
  return (
    <>
      {videos.map((each, index) => (
        <ShownOne key={index} door={door} shown={each} onOpen={() => openAt(each.picture.id)} />
      ))}
      {stills.length === 0 ? null : <ShownStills door={door} shown={stills} openAt={openAt} />}
      {viewer}
    </>
  );
}

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
    <div className="my-block-gap">
      <PictureSet label={SHOWN_LABEL} count={shown.length}>
        {shown.slice(0, PICTURE_SET_SHOWN).map((each, index) => (
          <ShownTile key={index} door={door} shown={each} onOpen={openAt} />
        ))}
      </PictureSet>
      <UnseenPictures door={door} pictures={shown.map((each) => each.picture)} />
    </div>
  );
}

const SHOWN_LABEL = "Pictures the agent showed";
const CALLED_LABEL = "Pictures the call answered";

function notKeptWords(byteCount: number): string {
  return `not kept · ${formatBytes(byteCount)}`;
}

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
      <div className="mt-list-gap mr-0 mb-item-gap ml-transcript-gutter">
        <PictureSet label={CALLED_LABEL} count={called.length} thumbnails>
          {called.map((each, index) =>
            each.kept ? (
              <KeptTile
                key={index}
                door={door}
                picture={each.picture}
                words={each.name}
                caption=""
                onOpen={openAt}
              />
            ) : (
              <PictureSetTile
                key={index}
                state={{ kind: PICTURE_STATE.MISSING }}
                words={each.name}
                why={notKeptWords(each.byteCount)}
              />
            ),
          )}
        </PictureSet>
        {viewer}
      </div>
      {videos}
    </>
  );
}

const ATTACHMENT_TYPES: ReadonlySet<string> = new Set(Object.values(AGENT_ATTACHMENT_TYPE));

function attachmentOfData(name: string, url: string): AgentAttachment | undefined {
  const read = /^data:([^;,]+);base64,(.+)$/u.exec(url);
  const mediaType = read?.[1];
  const data = read?.[2];
  if (mediaType === undefined || data === undefined || !ATTACHMENT_TYPES.has(mediaType)) {
    return undefined;
  }
  return { name, mediaType: mediaType as AgentAttachment["mediaType"], data };
}

export interface LineAttachment {
  readonly key: string;
  readonly attachment: AgentAttachment;
}

export function useLineAttachments(message: AgentTranscriptMessage): {
  readonly attachments: readonly LineAttachment[];
  readonly reading: boolean;
} {
  const door = useContext(AgentPicturesContext);
  const files = messageFileChips(message);
  const states = usePictureStates(
    door,
    files.map(({ pictureId }) => pictureId),
  );
  let reading = false;
  const attachments = files.flatMap(({ name, url, pictureId }, index): LineAttachment[] => {
    const state = pictureId === undefined || door === undefined ? undefined : states[index];
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
  });
  return { attachments, reading };
}

export function MessageFileChips({
  message,
  sending = false,
}: {
  message: AgentTranscriptMessage;
  sending?: boolean;
}): ReactNode {
  return <KeptFileChips files={messageFileChips(message)} sending={sending} />;
}

export function KeptFileChips({
  files,
  sending = false,
}: {
  files: readonly MessageFileChip[];
  sending?: boolean;
}): ReactNode {
  const door = useContext(AgentPicturesContext);
  const states = usePictureStates(
    door,
    files.map(({ pictureId }) => pictureId),
  );
  const chips = files.map(({ pictureId, ...chip }, index): FileChip => {
    const state = states[index];
    return pictureId !== undefined && state?.kind === PICTURE_STATE.READY
      ? { ...chip, url: state.url }
      : chip;
  });
  return <AttachedFileChips files={chips} uploading={sending} />;
}
