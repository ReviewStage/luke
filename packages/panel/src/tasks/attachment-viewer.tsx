import {
  ATTACHMENT_VIEW,
  attachmentText,
  attachmentView,
  chipBase64,
  type FileChip,
  sizeLabel,
} from "@repo/features/attachment-model";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { SHORTCUT_KEY, type ShortcutChord } from "@repo/settings/shortcuts";
import {
  Button,
  ButtonLink,
  CloseIcon,
  CopyButton,
  DIALOG_SIZE,
  DIALOG_VEIL,
  Dialog,
  DialogCard,
  FailureNote,
  IconButton,
  IMAGE_OPENING,
  type ImageOpening,
  type ImageZoom,
  OneLine,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  ThumbStrip,
  Tooltip,
  useImageZoom,
  usePageSwipe,
  usePictureExpand,
  VIDEO_PLAYER_PLACE,
  VideoPlayer,
  ZoomImage,
} from "@repo/ui";
import { DIAGRAM_DRAWING } from "@repo/ui/diagram-contract";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { DIAGRAM_REFUSED_LINE } from "../bundle-loader.js";
import {
  copyImageThroughShell,
  copyThroughShell,
  useCopyToast,
  useImageCopyToast,
} from "../copy-feedback.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { PhoneHead, PlaceMore } from "../desktop/phone-head.js";
import { diagramAlt, useAppearance, useDrawing } from "../diagram-drawing.js";
import { failureShown } from "../failure-report.js";
import { usePhoneRoom } from "../stage-room.js";
import { FileTypeIcon } from "./file-type-icon.js";
import { linkPressOf } from "./use-open-link.js";
import { WholeFile, type WholeFileNote } from "./whole-file.js";

const TITLE_CLASS = "attachment-viewer-title m-0 overflow-hidden whitespace-nowrap";

const SIZE_CLASS = "attachment-viewer-size flex-none text-caption text-muted-foreground";

const NOTE_CLASS =
  "attachment-viewer-note flex min-w-0 overflow-clip [overflow-clip-margin:var(--ui-focus-ring-room)] text-caption text-muted-foreground";

const STRIP_LABEL = "Files";

const VIEWER_LABEL = {
  PREVIOUS: "Previous file",
  NEXT: "Next file",
  ZOOM_OUT: "Zoom out",
  ZOOM_IN: "Zoom in",
  DOWNLOAD: "Download file",
  CLOSE: "Close",
} as const;

const COPY_WHAT = {
  TEXT: "text",
  IMAGE: "image",
} as const;

const ZOOM_CHORD = {
  IN: { key: SHORTCUT_KEY.EQUALS, plain: true },
  OUT: { key: SHORTCUT_KEY.MINUS, plain: true },
} as const satisfies Record<string, ShortcutChord>;

const VIEWER_CHORD = {
  PREVIOUS: { key: SHORTCUT_KEY.LEFT, plain: true },
  NEXT: { key: SHORTCUT_KEY.RIGHT, plain: true },
  CLOSE: { key: SHORTCUT_KEY.ESCAPE, bare: true },
} as const satisfies Record<string, ShortcutChord>;

const NO_NOTES: readonly WholeFileNote[] = [];

export type ViewerAction = {
  readonly label: string;
  readonly icon: React.ReactNode;
} & (
  | { readonly onPress: (file: FileChip) => void; readonly address?: undefined }
  | {
      readonly address: (file: FileChip) => string | undefined;
      readonly onOpen: (address: string) => void;
      readonly onPress?: undefined;
    }
);

function ViewerLink({
  action,
  address,
}: {
  action: Extract<ViewerAction, { onOpen: unknown }>;
  address: string | undefined;
}): React.JSX.Element | null {
  if (address === undefined) return null;
  return (
    <ButtonLink icon={action.icon} href={address} onClick={linkPressOf(action.onOpen, address)}>
      {action.label}
    </ButtonLink>
  );
}

function heldBytes(file: FileChip): boolean {
  return file.url.startsWith("data:");
}

function download(file: FileChip): void {
  const link = document.createElement("a");
  link.href = file.url;
  link.download = file.name;
  link.click();
}

function CopyTextButton({ text }: { text: string }): React.JSX.Element {
  return <CopyButton text={text} what={COPY_WHAT.TEXT} copy={copyThroughShell} />;
}

function CopyImageButton({ url }: { url: string }): React.JSX.Element {
  return <CopyButton key={url} text={url} what={COPY_WHAT.IMAGE} copy={copyImageThroughShell} />;
}

function HeaderButton({
  label,
  chord,
  onClick,
  icon,
}: {
  label: string;
  chord?: ShortcutChord;
  onClick: () => void;
  icon: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip label={label} chord={chord}>
      <IconButton icon={icon} label={label} onClick={onClick} />
    </Tooltip>
  );
}

function WalkButton({
  label,
  chord,
  onClick,
  icon,
}: {
  label: string;
  chord: ShortcutChord;
  onClick: () => void;
  icon: React.ReactNode;
}): React.JSX.Element {
  return (
    <span className="attachment-viewer-walk flex flex-none rounded-control bg-button-ground shadow-floating-edge [--ui-button-ground:var(--ui-color-well)]">
      <Tooltip label={label} chord={chord}>
        <IconButton icon={icon} label={label} onClick={onClick} />
      </Tooltip>
    </span>
  );
}

const COPIED = { TEXT: "Text copied", IMAGE: "Image copied" } as const;

const VIEWER_THING = "Attachment";

function viewerGroups(input: {
  readonly file: FileChip;
  readonly at: number;
  readonly count: number;
  readonly walk: (step: number) => void;
  readonly text: string | undefined;
  readonly picture: string | undefined;
  readonly held: boolean;
  readonly media: boolean;
  readonly zoom: ImageZoom;
  readonly action: ViewerAction | undefined;
  readonly copyText: (words: string, label: string) => void;
  readonly copyImage: (url: string, label: string) => void;
}): MenuAction[][] {
  const { file, at, count, walk, text, picture, held, media, zoom, action } = input;
  const place = `${String(at + 1)} of ${String(count)}`;
  const walking: MenuAction[] =
    count > 1
      ? [
          {
            label: VIEWER_LABEL.PREVIOUS,
            icon: <ChevronLeftIcon aria-hidden="true" />,
            detail: place,
            onSelect: () => walk(-1),
          },
          {
            label: VIEWER_LABEL.NEXT,
            icon: <ChevronRightIcon aria-hidden="true" />,
            detail: place,
            onSelect: () => walk(1),
          },
        ]
      : [];
  const looking: MenuAction[] = [
    ...(text === undefined
      ? []
      : [
          {
            label: `Copy ${COPY_WHAT.TEXT}`,
            icon: <CopyIcon aria-hidden="true" />,
            onSelect: () => input.copyText(text, COPIED.TEXT),
          },
        ]),
    ...(picture !== undefined && held
      ? [
          {
            label: `Copy ${COPY_WHAT.IMAGE}`,
            icon: <CopyIcon aria-hidden="true" />,
            onSelect: () => input.copyImage(picture, COPIED.IMAGE),
          },
        ]
      : []),
    ...(picture !== undefined
      ? [
          {
            label: VIEWER_LABEL.ZOOM_OUT,
            icon: <ZoomOutIcon aria-hidden="true" />,
            onSelect: () => zoom.step(-1),
          },
          {
            label: VIEWER_LABEL.ZOOM_IN,
            icon: <ZoomInIcon aria-hidden="true" />,
            onSelect: () => zoom.step(1),
          },
        ]
      : []),
  ];
  const keeping: MenuAction[] = [
    ...(action === undefined || !media ? [] : actionItems(action, file)),
    ...(held
      ? [
          {
            label: VIEWER_LABEL.DOWNLOAD,
            icon: <DownloadIcon aria-hidden="true" />,
            onSelect: () => download(file),
          },
        ]
      : []),
  ];
  return [walking, looking, keeping].filter((group) => group.length > 0);
}

function actionItems(action: ViewerAction, file: FileChip): MenuAction[] {
  const icon = <>{action.icon}</>;
  if (action.address === undefined) {
    return [{ label: action.label, icon, onSelect: () => action.onPress(file) }];
  }
  const address = action.address(file);
  return address === undefined
    ? []
    : [{ label: action.label, icon, onSelect: () => action.onOpen(address) }];
}

interface DiagramShown {
  readonly picture: string | undefined;
  readonly refused: boolean;
  readonly retry: (() => void) | undefined;
}

function AttachmentBody({
  file,
  base64,
  text,
  diagram,
  zoom,
}: {
  file: FileChip;
  base64: string;
  text: string | undefined;
  diagram: DiagramShown;
  zoom: ImageZoom;
}): React.JSX.Element {
  const image = attachmentView(file) === ATTACHMENT_VIEW.IMAGE;
  if (image || diagram.picture !== undefined) {
    return (
      <div
        ref={zoom.frameRef}
        className="attachment-viewer-body min-h-0 flex-auto grid touch-none place-items-center overflow-hidden bg-surface"
        {...DIALOG_VEIL}
      >
        <ZoomImage
          zoom={zoom}
          src={diagram.picture ?? file.url}
          alt={image ? file.name : diagramAlt(text ?? "")}
        />
      </div>
    );
  }
  if (attachmentView(file) === ATTACHMENT_VIEW.VIDEO) {
    return (
      <div
        className="attachment-viewer-body min-h-0 flex-auto grid place-items-center overflow-hidden bg-veil"
        {...DIALOG_VEIL}
      >
        <VideoPlayer dataUrl={file.url} label={file.name} place={VIDEO_PLAYER_PLACE.VIEWER} />
      </div>
    );
  }
  if (text !== undefined) {
    return (
      <div className="attachment-viewer-body min-h-0 flex-auto attachment-viewer-lines mx-auto flex w-viewer-text flex-col bg-card-code">
        {diagram.refused ? (
          <FailureNote
            failure={failureShown({
              surface: FAILURE_SURFACE.DESCRIPTION_DIAGRAM,
              cause: FAILURE_CONDITION.REFUSED,
              refused: true,
            })}
            onRetry={diagram.retry}
          >
            {DIAGRAM_REFUSED_LINE}
          </FailureNote>
        ) : null}
        <WholeFile
          name={file.name}
          text={text.replace(/\r\n/gu, "\n")}
          revision={file.url}
          lit={undefined}
          notes={NO_NOTES}
          findFrom={1}
          findable={false}
        />
      </div>
    );
  }
  return (
    <div
      className="attachment-viewer-body min-h-0 flex-auto flex flex-col items-center justify-center gap-item-gap p-card text-center"
      {...DIALOG_VEIL}
    >
      <FileTypeIcon name={file.name} className="size-12" />
      <p className="mx-0 mt-item-gap mb-0 max-w-full text-section font-ui-semibold wrap-anywhere">
        {file.name}
      </p>
      <p className="mx-0 mt-0 mb-block-gap text-caption text-muted-foreground">
        {sizeLabel(base64)}
      </p>
      <Button icon={<DownloadIcon aria-hidden="true" />} onClick={() => download(file)}>
        {VIEWER_LABEL.DOWNLOAD}
      </Button>
    </div>
  );
}

export function AttachmentViewer({
  files,
  at,
  onAt,
  onClose,
  action,
  note,
  opening = IMAGE_OPENING.FITTED,
}: {
  files: readonly FileChip[];
  at: number;
  onAt: (at: number) => void;
  onClose: () => void;
  action?: ViewerAction | undefined;
  note?: React.ReactNode;
  opening?: ImageOpening;
}): React.JSX.Element | null {
  const titleId = useId();
  const viewer = useRef<HTMLDivElement>(null);
  const phone = usePhoneRoom();
  const copyText = useCopyToast();
  const copyImage = useImageCopyToast();
  const file = files[at];
  const base64 = file === undefined ? "" : chipBase64(file);
  const view = file === undefined ? ATTACHMENT_VIEW.OTHER : attachmentView(file);
  const text =
    view === ATTACHMENT_VIEW.TEXT || view === ATTACHMENT_VIEW.DIAGRAM
      ? attachmentText(base64)
      : undefined;
  const drawn = useDrawing(view === ATTACHMENT_VIEW.DIAGRAM ? text : undefined, useAppearance());
  const diagram: DiagramShown = {
    picture: drawn.drawing?.kind === DIAGRAM_DRAWING.DRAWN ? drawn.drawing.url : undefined,
    refused: drawn.drawing?.kind === DIAGRAM_DRAWING.REFUSED,
    retry: drawn.retry,
  };
  const picture = view === ATTACHMENT_VIEW.IMAGE ? file?.url : diagram.picture;
  const zoom = useImageZoom(file?.name ?? "", picture ?? file?.url ?? "", opening);
  const words = picture === undefined ? text : undefined;
  const [opened] = useState({ at, url: file?.url });
  const expand = usePictureExpand(at === opened.at && file?.url === opened.url);
  const close = () => expand.close(onClose);
  const walk = (step: number) => onAt((at + step + files.length) % files.length);
  usePageSwipe({ enabled: files.length > 1 && !zoom.zoomed, surface: viewer, onStep: walk });

  if (file === undefined) return null;
  const image = picture !== undefined;
  const held = heldBytes(file);
  const video = view === ATTACHMENT_VIEW.VIDEO;
  const media = view === ATTACHMENT_VIEW.IMAGE || video;
  const walking = !phone && files.length > 1;
  const hug = !phone && video;
  const walkKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (image && zoom.keyDown(event)) {
      event.preventDefault();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.target instanceof HTMLVideoElement || event.target instanceof HTMLInputElement)
      return;
    event.preventDefault();
    walk(event.key === "ArrowLeft" ? -1 : 1);
  };

  return (
    <Dialog
      open
      size={DIALOG_SIZE.WINDOW}
      labelledBy={titleId}
      onDismiss={close}
      onKeyDown={walkKey}
      expand={expand}
    >
      <div
        ref={viewer}
        className="attachment-viewer ph-no-capture flex size-full min-h-0 flex-col gap-ui-16"
        data-view={view}
        data-opening={opening}
        data-hug={hug}
        {...DIALOG_VEIL}
      >
        <div
          className="attachment-viewer-stage flex min-h-0 flex-auto items-center gap-ui-16"
          {...DIALOG_VEIL}
        >
          {walking ? (
            <WalkButton
              label={VIEWER_LABEL.PREVIOUS}
              chord={VIEWER_CHORD.PREVIOUS}
              onClick={() => walk(-1)}
              icon={<ArrowLeftIcon aria-hidden="true" />}
            />
          ) : null}
          <div
            className="attachment-viewer-room grid min-h-0 min-w-0 flex-auto self-stretch place-items-center"
            {...DIALOG_VEIL}
          >
            <DialogCard hug={hug}>
              {phone ? (
                <PhoneHead
                  place="attachment-viewer"
                  start={
                    <HeaderButton
                      label={VIEWER_LABEL.CLOSE}
                      chord={VIEWER_CHORD.CLOSE}
                      onClick={close}
                      icon={<CloseIcon />}
                    />
                  }
                  title={
                    <span className="flex min-w-0 flex-col items-center">
                      <Text
                        as={TEXT_ELEMENT.H2}
                        variant={TEXT_VARIANT.TOOLBAR_TITLE}
                        id={titleId}
                        className={`ui-toolbar-title max-w-full ${TITLE_CLASS}`}
                      >
                        <OneLine>{file.name}</OneLine>
                      </Text>
                      <span className="flex min-w-0 max-w-full">
                        {held ? (
                          <span className={`m-0 ${SIZE_CLASS}`}>{sizeLabel(base64)}</span>
                        ) : null}
                        {note === undefined || note === null ? null : (
                          <span className={`my-0 mr-0 ml-ui-8 ${NOTE_CLASS}`}>{note}</span>
                        )}
                      </span>
                    </span>
                  }
                  end={
                    <PlaceMore
                      thing={VIEWER_THING}
                      shown
                      groups={() =>
                        viewerGroups({
                          file,
                          at,
                          count: files.length,
                          walk,
                          text: words,
                          picture,
                          held,
                          media,
                          zoom,
                          action,
                          copyText,
                          copyImage,
                        })
                      }
                    />
                  }
                />
              ) : (
                <header className="flex flex-none items-center gap-tight-gap border-b border-border py-ui-4 pr-item-gap pl-list-inset">
                  <FileTypeIcon
                    name={file.name}
                    className="mr-tight-gap size-control-icon flex-none"
                  />
                  <Text
                    as={TEXT_ELEMENT.H2}
                    variant={TEXT_VARIANT.SECTION}
                    id={titleId}
                    className={TITLE_CLASS}
                  >
                    <OneLine>{file.name}</OneLine>
                  </Text>
                  <span className={`my-0 mr-auto ml-tight-gap ${SIZE_CLASS}`}>
                    {held ? sizeLabel(base64) : null}
                  </span>
                  {note === undefined || note === null ? null : (
                    <span className={`my-0 mr-auto ml-block-gap ${NOTE_CLASS}`}>{note}</span>
                  )}
                  {words === undefined ? null : <CopyTextButton text={words} />}
                  {picture === undefined ? null : (
                    <>
                      {held ? <CopyImageButton url={picture} /> : null}
                      <HeaderButton
                        label={VIEWER_LABEL.ZOOM_OUT}
                        chord={ZOOM_CHORD.OUT}
                        onClick={() => zoom.step(-1)}
                        icon={<ZoomOutIcon aria-hidden="true" />}
                      />
                      <HeaderButton
                        label={VIEWER_LABEL.ZOOM_IN}
                        chord={ZOOM_CHORD.IN}
                        onClick={() => zoom.step(1)}
                        icon={<ZoomInIcon aria-hidden="true" />}
                      />
                    </>
                  )}
                  {action === undefined || !media ? null : action.address === undefined ? (
                    <Button icon={action.icon} onClick={() => action.onPress(file)}>
                      {action.label}
                    </Button>
                  ) : (
                    <ViewerLink action={action} address={action.address(file)} />
                  )}
                  {held ? (
                    <HeaderButton
                      label={VIEWER_LABEL.DOWNLOAD}
                      onClick={() => download(file)}
                      icon={<DownloadIcon aria-hidden="true" />}
                    />
                  ) : null}
                  <HeaderButton
                    label={VIEWER_LABEL.CLOSE}
                    chord={VIEWER_CHORD.CLOSE}
                    onClick={close}
                    icon={<CloseIcon />}
                  />
                </header>
              )}
              <AttachmentBody
                key={at}
                file={file}
                base64={base64}
                text={text}
                diagram={diagram}
                zoom={zoom}
              />
            </DialogCard>
          </div>
          {walking ? (
            <WalkButton
              label={VIEWER_LABEL.NEXT}
              chord={VIEWER_CHORD.NEXT}
              onClick={() => walk(1)}
              icon={<ArrowRightIcon aria-hidden="true" />}
            />
          ) : null}
        </div>
        {walking ? (
          <div className="attachment-viewer-strip flex flex-none justify-center" {...DIALOG_VEIL}>
            <ThumbStrip
              label={STRIP_LABEL}
              items={files.map((each) => {
                const view = attachmentView(each);
                const drawn = view === ATTACHMENT_VIEW.IMAGE || view === ATTACHMENT_VIEW.VIDEO;
                return {
                  name: each.name,
                  image: view === ATTACHMENT_VIEW.IMAGE ? each.url : undefined,
                  video: view === ATTACHMENT_VIEW.VIDEO ? each.url : undefined,
                  glyph: drawn ? undefined : <FileTypeIcon name={each.name} />,
                };
              })}
              at={at}
              onPick={onAt}
            />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
