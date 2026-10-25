import {
  ATTACHMENT_VIEW,
  attachmentText,
  attachmentView,
  chipBase64,
  type FileChip,
  sizeLabel,
} from "@luke/features/attachment-model";
import { SHORTCUT_KEY, type ShortcutChord } from "@luke/settings/shortcuts";
import {
  Button,
  ButtonLink,
  CloseIcon,
  CopyButton,
  DIALOG_SIZE,
  DIALOG_VEIL,
  Dialog,
  IconButton,
  IMAGE_OPENING,
  type ImageOpening,
  type ImageZoom,
  OneLine,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TOOLBAR_INSET,
  Toolbar,
  Tooltip,
  useImageZoom,
  usePictureExpand,
  VIDEO_PLAYER_PLACE,
  VideoPlayer,
  ZoomImage,
} from "@luke/ui";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useId, useState } from "react";
import {
  copyImageThroughShell,
  copyThroughShell,
  useCopyToast,
  useImageCopyToast,
} from "../copy-feedback.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { PhoneHead, PlaceMore } from "../desktop/phone-head.js";
import { usePhoneRoom } from "../stage-room.js";
import { FileTypeIcon } from "./file-type-icon.js";
import { linkPressOf } from "./use-open-link.js";
import { WholeFile, type WholeFileNote } from "./whole-file.js";

/**
 * attachment-viewer.tsx -- a file on a message opened over the window, as Quick Look opens one: an image fitted to the window, a video played there, a text file drawn as every code is, or any other file by its icon with a way to save it.
 *
 * A picture opens fitted to the window, or at its own pixels where the place
 * opening it asks, and zooms as Preview's does: a pinch, a trackpad's or two
 * fingers', or a Control-scroll about the pointer, a press to its own pixels there
 * and back, the header's buttons or a bare `=`, `-`, and `0`; zoomed, it is
 * moved by a drag or a two-finger scroll (`@luke/ui`'s ZoomImage). A video,
 * such as one an agent recorded and opened from its Expand,
 * plays at once as large as the window lets it, with the player's own
 * controls, Full screen among them (`@luke/ui`'s VideoPlayer).
 *
 * The files of one message are walked in place with the header's arrows or
 * the arrow keys, and the header names the file shown, its size, and how
 * far along the message's files it is, a note the place opening it gives
 * the file shown (who last edited it, for a plan's picture), beside Copy for a text file or a picture,
 * whatever the place opening it offers for a picture (Add to plan, in an
 * agent's transcript), Download, and the way out. It opens in the window's one modal frame,
 * `@luke/ui`'s dialog at the whole window's size: the file stands on a dark
 * veil, as large as the room under the header lets it, and the header is a
 * bar where the window's top bar stands (`@luke/ui`'s Toolbar), at its
 * height, clear of the traffic lights, and the window's drag handle on the
 * desktop. Tab stays inside the card, and Escape, a press on the room
 * around the file shown, and the way out all close it and hand focus back
 * to the chip that opened it. A picture opened from its
 * tile grows out of the tile and, closed on that picture, shrinks back into it. The
 * file's bytes are the chip's own, so a file in the message box and one
 * read back with the transcript open the same. A message's files are its
 * developer's own, so everything the card holds is left out of the screen
 * recording (`ph-no-capture`) as a second line behind the masking.
 *
 * On a phone the header is a phone's (`phone-head.tsx`): Close alone at its
 * start, the file's name centred over its size and note, and one ⋯ at its
 * end holding every other button of the header, the arrow keys still
 * walking the files.
 *
 * Note that a PDF is shown by its icon rather than drawn, because the
 * window's policy refuses the frames and objects Chromium draws one in.
 */

/** The file's name in the viewer's head, cut to its line. */
const TITLE_CLASS = "attachment-viewer-title m-0 overflow-hidden whitespace-nowrap";

/** How large the file is, quiet, in the caption role. */
const SIZE_CLASS = "attachment-viewer-size flex-none text-caption text-muted-foreground";

/** What the place opening the viewer says of the file, a plan's picture saying who last edited it, in the size's quiet ink, cut past the ring a press in it draws. */
const NOTE_CLASS =
  "attachment-viewer-note flex min-w-0 overflow-clip [overflow-clip-margin:var(--luke-focus-ring-room)] text-caption text-muted-foreground";

/** What the header's buttons are named. */
const VIEWER_LABEL = {
  PREVIOUS: "Previous file",
  NEXT: "Next file",
  ZOOM_OUT: "Zoom out",
  ZOOM_IN: "Zoom in",
  DOWNLOAD: "Download",
  CLOSE: "Close",
} as const;

/** What the header's two Copy buttons copy, which `CopyButton` names ("Copy text"). */
const COPY_WHAT = {
  TEXT: "text",
  IMAGE: "image",
} as const;

/** The bare keys a picture's zoom buttons name in their hints, which `@luke/ui`'s `useImageZoom` answers. */
const ZOOM_CHORD = {
  IN: { key: SHORTCUT_KEY.EQUALS, plain: true },
  OUT: { key: SHORTCUT_KEY.MINUS, plain: true },
} as const satisfies Record<string, ShortcutChord>;

/** The bare keys the walk's and Close's buttons name in their hints, which the card's `walkKey` and its dialog's dismissal answer. */
const VIEWER_CHORD = {
  PREVIOUS: { key: SHORTCUT_KEY.LEFT, plain: true },
  NEXT: { key: SHORTCUT_KEY.RIGHT, plain: true },
  CLOSE: { key: SHORTCUT_KEY.ESCAPE, bare: true },
} as const satisfies Record<string, ShortcutChord>;

/** No notes on a file of a message. */
const NO_NOTES: readonly WholeFileNote[] = [];

/**
 * One more thing the viewer's picture or video may be given to: its button's
 * words and glyph, and what a press does with the file shown, an act of the
 * window's (`onPress`), or opening a page outside it, which it draws as the
 * link it is (`address`, the page the file shown goes to, if it has one, and
 * `onOpen`, which opens it through the window's link-open act).
 */
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

/** The viewer's action that opens a page, drawn as a link to it; nothing for a file with no page to open. */
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

/** Saves the file where the system's download asks, under its own name. */
function download(file: FileChip): void {
  const link = document.createElement("a");
  link.href = file.url;
  link.download = file.name;
  link.click();
}

/** Copy for a text file's words, `@luke/ui`'s one Copy. */
function CopyTextButton({ text }: { text: string }): React.JSX.Element {
  return <CopyButton text={text} what={COPY_WHAT.TEXT} copy={copyThroughShell} />;
}

/**
 * Copy for a picture, put on the clipboard as a copy from Preview puts one;
 * its button's text is the picture's address. Note that it is keyed by that
 * address, because the button stands while the files are walked: a copy
 * answered after the next picture is shown lands nowhere, and the next
 * starts at rest.
 */
function CopyImageButton({ url }: { url: string }): React.JSX.Element {
  return <CopyButton key={url} text={url} what={COPY_WHAT.IMAGE} copy={copyImageThroughShell} />;
}

/** One of the header's icon buttons, its name its hint, beside the key that does the same where there is one. */
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

/** What a phone's ⋯ copies the file shown as, and what its toast says once it is copied. */
const COPIED = { TEXT: "Text copied", IMAGE: "Image copied" } as const;

/** What the viewer's ⋯ is named for on a phone: "File actions". */
const VIEWER_THING = "File";

/**
 * The header's buttons but Close as the groups of a phone's ⋯: the walk
 * through the message's files, saying how far along it the file shown is;
 * the copy and the zoom; then the place's own action and Download.
 */
function viewerGroups(input: {
  readonly file: FileChip;
  readonly at: number;
  readonly count: number;
  readonly walk: (step: number) => void;
  readonly text: string | undefined;
  readonly image: boolean;
  /** Whether the file is a video, which the place's action is offered for as a picture is. */
  readonly video: boolean;
  readonly zoom: ImageZoom;
  readonly action: ViewerAction | undefined;
  readonly copyText: (words: string, label: string) => void;
  readonly copyImage: (url: string, label: string) => void;
}): MenuAction[][] {
  const { file, at, count, walk, text, image, video, zoom, action } = input;
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
    ...(image
      ? [
          {
            label: `Copy ${COPY_WHAT.IMAGE}`,
            icon: <CopyIcon aria-hidden="true" />,
            onSelect: () => input.copyImage(file.url, COPIED.IMAGE),
          },
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
    ...(action === undefined || !(image || video) ? [] : actionItems(action, file)),
    {
      label: VIEWER_LABEL.DOWNLOAD,
      icon: <DownloadIcon aria-hidden="true" />,
      onSelect: () => download(file),
    },
  ];
  return [walking, looking, keeping].filter((group) => group.length > 0);
}

/** The place's own action as an item of a phone's ⋯: its press, or the page it opens, none for a file with no page. */
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

/** The file shown: the picture, the video playing, its text drawn as every code is, or the icon, name, and size over Download. */
function AttachmentBody({
  file,
  base64,
  text,
  zoom,
}: {
  file: FileChip;
  base64: string;
  text: string | undefined;
  zoom: ImageZoom;
}): React.JSX.Element {
  if (attachmentView(file) === ATTACHMENT_VIEW.IMAGE) {
    return (
      // Two fingers anywhere on the frame pinch the picture (`@luke/ui`'s ZoomImage), never the page.
      <div
        ref={zoom.frameRef}
        className="attachment-viewer-body min-h-0 flex-auto grid touch-none place-items-center overflow-hidden p-control-gap"
        {...DIALOG_VEIL}
      >
        <ZoomImage zoom={zoom} src={file.url} alt={file.name} />
      </div>
    );
  }
  if (attachmentView(file) === ATTACHMENT_VIEW.VIDEO) {
    return (
      // A video plays on the veil, centred, as large as the room under the bar leaves it at its own shape.
      <div
        className="attachment-viewer-body min-h-0 flex-auto grid place-items-center overflow-hidden p-control-gap"
        {...DIALOG_VEIL}
      >
        <VideoPlayer dataUrl={file.url} label={file.name} place={VIDEO_PLAYER_PLACE.VIEWER} />
      </div>
    );
  }
  if (text !== undefined) {
    return (
      <div className="attachment-viewer-body min-h-0 flex-auto attachment-viewer-lines mx-auto flex w-viewer-text flex-col bg-card-code">
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
      <p className="mx-0 mt-item-gap mb-0 max-w-full text-section font-luke-semibold wrap-anywhere">
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

/**
 * The file at `at` among a message's files, over the window until it is
 * closed. Drawn over `document.body` so no stacking context of the row that
 * opened it can clip or cover it.
 */
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
  /** Shows the message's file at this place. */
  onAt: (at: number) => void;
  onClose: () => void;
  /** One more thing a picture or a video shown may be given to, named in the header before Download; none where the place opening the viewer offers nothing. */
  action?: ViewerAction | undefined;
  /** A quiet line the place says of the file shown, after its size, such as who last edited a plan's picture; none where it says nothing. */
  note?: React.ReactNode;
  /** How a picture is first drawn: fitted to the window, or at its own pixels, as a diagram too fine to read fitted opens. */
  opening?: ImageOpening;
}): React.JSX.Element | null {
  const titleId = useId();
  const phone = usePhoneRoom();
  const copyText = useCopyToast();
  const copyImage = useImageCopyToast();
  const file = files[at];
  const zoom = useImageZoom(file?.name ?? "", file?.url ?? "", opening);
  // A picture opened from its tile grows from it, and goes back into it
  // only while the picture it was opened on is the one shown. Note that the
  // place is asked beside the file's bytes, because two files may hold the
  // same picture, and a place that moved as others landed closes in place.
  const [opened] = useState({ at, url: file?.url });
  const expand = usePictureExpand(at === opened.at && file?.url === opened.url);
  const close = () => expand.close(onClose);

  if (file === undefined) return null;
  const base64 = chipBase64(file);
  const text = attachmentView(file) === ATTACHMENT_VIEW.TEXT ? attachmentText(base64) : undefined;
  // Note that the walk goes round from either end rather than stopping,
  // because a button that went disabled under the pointer would drop the
  // keyboard's focus out of the card.
  const walk = (step: number) => onAt((at + step + files.length) % files.length);
  const image = attachmentView(file) === ATTACHMENT_VIEW.IMAGE;
  const video = attachmentView(file) === ATTACHMENT_VIEW.VIDEO;
  // The arrows walk the message's files, and a picture's zoom keys zoom it;
  // a key's own default, a copy of the lines selected among them, is left alone.
  const walkKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (image && zoom.keyDown(event)) {
      event.preventDefault();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // Note that an arrow on a video or a field, such as a video's scrubber, moves it rather than walking away from it.
    if (event.target instanceof HTMLVideoElement || event.target instanceof HTMLInputElement)
      return;
    event.preventDefault();
    walk(event.key === "ArrowLeft" ? -1 : 1);
  };

  // Note that the card takes focus rather than a button, as Quick Look's
  // does, so no ring stands on a control nobody chose; Tab goes on to the
  // buttons from there. It stands while it is mounted (`open`), because its
  // exit is the flight back into its tile (`close`, through `expand`), which
  // its owner unmounts it after.
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
        className="attachment-viewer ph-no-capture flex size-full min-h-0 flex-col data-[view=other]:bg-ground data-[view=text]:bg-ground"
        data-view={attachmentView(file)}
        data-opening={opening}
        {...DIALOG_VEIL}
      >
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
                  className={`luke-toolbar-title max-w-full ${TITLE_CLASS}`}
                >
                  <OneLine>{file.name}</OneLine>
                </Text>
                <span className="flex min-w-0 max-w-full">
                  <span className={`m-0 ${SIZE_CLASS}`}>{sizeLabel(base64)}</span>
                  {note === undefined || note === null ? null : (
                    <span className={`my-0 mr-0 ml-luke-8 ${NOTE_CLASS}`}>{note}</span>
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
                    text,
                    image,
                    video,
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
          <Toolbar
            place="attachment-viewer"
            lead={<FileTypeIcon name={file.name} className="size-control-icon flex-none" />}
            title={
              <Text
                as={TEXT_ELEMENT.H2}
                variant={TEXT_VARIANT.TOOLBAR_TITLE}
                id={titleId}
                className={`luke-toolbar-title ${TITLE_CLASS}`}
              >
                <OneLine>{file.name}</OneLine>
              </Text>
            }
            detail={
              <>
                {sizeLabel(base64)}
                {note === undefined || note === null ? null : (
                  <span className="attachment-viewer-note ml-block-gap text-muted-foreground">
                    {note}
                  </span>
                )}
              </>
            }
            end={TOOLBAR_INSET.COLUMN}
            actions={
              <>
                {files.length > 1 ? (
                  <div className="flex items-center">
                    <HeaderButton
                      label={VIEWER_LABEL.PREVIOUS}
                      chord={VIEWER_CHORD.PREVIOUS}
                      onClick={() => walk(-1)}
                      icon={<ChevronLeftIcon aria-hidden="true" />}
                    />
                    <span className="attachment-viewer-place min-w-12 text-center text-caption text-muted-foreground tabular-nums">
                      {`${String(at + 1)} of ${String(files.length)}`}
                    </span>
                    <HeaderButton
                      label={VIEWER_LABEL.NEXT}
                      chord={VIEWER_CHORD.NEXT}
                      onClick={() => walk(1)}
                      icon={<ChevronRightIcon aria-hidden="true" />}
                    />
                  </div>
                ) : null}
                {text === undefined ? null : <CopyTextButton text={text} />}
                {image ? (
                  <>
                    <CopyImageButton url={file.url} />
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
                ) : null}
                {action === undefined || !(image || video) ? null : action.address === undefined ? (
                  <Button icon={action.icon} onClick={() => action.onPress(file)}>
                    {action.label}
                  </Button>
                ) : (
                  <ViewerLink action={action} address={action.address(file)} />
                )}
                <HeaderButton
                  label={VIEWER_LABEL.DOWNLOAD}
                  onClick={() => download(file)}
                  icon={<DownloadIcon aria-hidden="true" />}
                />
                <HeaderButton
                  label={VIEWER_LABEL.CLOSE}
                  chord={VIEWER_CHORD.CLOSE}
                  onClick={close}
                  icon={<CloseIcon />}
                />
              </>
            }
          />
        )}
        <AttachmentBody key={at} file={file} base64={base64} text={text} zoom={zoom} />
      </div>
    </Dialog>
  );
}
