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
  CloseIcon,
  DIALOG_SIZE,
  Dialog,
  IconButton,
  IMAGE_OPENING,
  type ImageOpening,
  type ImageZoom,
  OneLine,
  Tooltip,
  useImageZoom,
  usePictureExpand,
  VideoPlayer,
  ZoomImage,
} from "@luke/ui";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { CopyGlyph, type CopyState, copyHint, useCopyFeedback } from "../copy-feedback.js";
import { FileTypeIcon } from "./file-type-icon.js";
import { WholeFile, type WholeFileNote } from "./whole-file.js";

/**
 * attachment-viewer.tsx -- a file on a message opened over the window, as Quick Look opens one: an image fitted to the window, a video played there, a text file drawn as every code is, or any other file by its icon with a way to save it.
 *
 * A picture opens fitted to the window, or at its own pixels where the place
 * opening it asks, and zooms as Preview's does: a pinch, a trackpad's or two
 * fingers', or a Control-scroll about the pointer, a press to its own pixels there
 * and back, the header's buttons or a bare `=`, `-`, and `0`; zoomed, it is
 * moved by a drag or a two-finger scroll (`@luke/ui`'s ZoomImage). A video,
 * such as one an agent recorded and opened from its still as a picture is,
 * plays at once as large as the card lets it, with the player's own
 * controls, Full screen among them (`@luke/ui`'s VideoPlayer).
 *
 * The files of one message are walked in place with the header's arrows or
 * the arrow keys, and the header names the file shown, its size, and how
 * far along the message's files it is, a note the place opening it gives
 * the file shown (who last edited it, for a plan's picture), beside Copy for a text file or a picture,
 * whatever the place opening it offers for a picture (Add to plan, in an
 * agent's transcript), Download, and the way out. It opens in the window's one modal frame,
 * `@luke/ui`'s dialog fitted to the file shown: the window dims, Tab stays inside the card, and
 * Escape, a press on the dimmed window, and the way out all close it and
 * hand focus back to the chip that opened it. A picture opened from its
 * tile grows out of the tile and, closed on that picture, shrinks back into it. The
 * file's bytes are the chip's own, so a file in the message box and one
 * read back with the transcript open the same. A message's files are its
 * developer's own, so everything the card holds is left out of the screen
 * recording (`ph-no-capture`) as a second line behind the masking.
 *
 * Note that a PDF is shown by its icon rather than drawn, because the
 * window's policy refuses the frames and objects Chromium draws one in.
 */

/** What the header's buttons are named. */
const VIEWER_LABEL = {
  PREVIOUS: "Previous file",
  NEXT: "Next file",
  COPY: "Copy text",
  COPY_IMAGE: "Copy image",
  ZOOM_OUT: "Zoom out",
  ZOOM_IN: "Zoom in",
  DOWNLOAD: "Download",
  CLOSE: "Close",
} as const;

/** The bare keys a picture's zoom buttons name in their hints, which `@luke/ui`'s `useImageZoom` answers. */
const ZOOM_CHORD = {
  IN: { key: SHORTCUT_KEY.EQUALS, plain: true },
  OUT: { key: SHORTCUT_KEY.MINUS, plain: true },
} as const satisfies Record<string, ShortcutChord>;

/** No notes on a file of a message. */
const NO_NOTES: readonly WholeFileNote[] = [];

/** One more thing the viewer's picture may be given to: its button's words and glyph, and what a press does with the file shown. */
export interface ViewerAction {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly onPress: (file: FileChip) => void;
}

/** Saves the file where the system's download asks, under its own name. */
function download(file: FileChip): void {
  const link = document.createElement("a");
  link.href = file.url;
  link.download = file.name;
  link.click();
}

/** Copy for a text file's words, answered on its glyph as every copy button is. */
function CopyTextButton({ text }: { text: string }): React.JSX.Element {
  const { state, copy } = useCopyFeedback();
  return (
    <Tooltip label={copyHint(state, VIEWER_LABEL.COPY)}>
      <IconButton
        icon={<CopyGlyph state={state} />}
        label={VIEWER_LABEL.COPY}
        onClick={() => copy(text)}
      />
    </Tooltip>
  );
}

/**
 * Copy for a picture, put on the clipboard as a copy from Preview puts one,
 * answered on its glyph as every copy button is. Note that the answer is
 * shown only beside the picture it was for, because the button stands
 * while the files are walked and a copy may land after the next is shown.
 */
function CopyImageButton({ url }: { url: string }): React.JSX.Element {
  const { state: copyState, answeredImage, copyImage } = useCopyFeedback();
  const state: CopyState = answeredImage === url ? copyState : "idle";
  return (
    <Tooltip label={copyHint(state, VIEWER_LABEL.COPY_IMAGE)}>
      <IconButton
        icon={<CopyGlyph state={state} />}
        label={VIEWER_LABEL.COPY_IMAGE}
        onClick={() => copyImage(url)}
      />
    </Tooltip>
  );
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
      <div ref={zoom.frameRef} className="attachment-viewer-body">
        <ZoomImage zoom={zoom} src={file.url} alt={file.name} />
      </div>
    );
  }
  if (attachmentView(file) === ATTACHMENT_VIEW.VIDEO) {
    return (
      <div className="attachment-viewer-body">
        <VideoPlayer dataUrl={file.url} label={file.name} />
      </div>
    );
  }
  if (text !== undefined) {
    return (
      <div className="attachment-viewer-body attachment-viewer-lines">
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
    <div className="attachment-viewer-body attachment-viewer-other">
      <FileTypeIcon name={file.name} />
      <p className="attachment-viewer-other-name">{file.name}</p>
      <p className="attachment-viewer-other-size">{sizeLabel(base64)}</p>
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
  /** One more thing a picture shown may be given to, named in the header before Download; none where the place opening the viewer offers nothing. */
  action?: ViewerAction | undefined;
  /** A quiet line the place says of the file shown, after its size, such as who last edited a plan's picture; none where it says nothing. */
  note?: React.ReactNode;
  /** How a picture is first drawn: fitted to the window, or at its own pixels, as a diagram too fine to read fitted opens. */
  opening?: ImageOpening;
}): React.JSX.Element | null {
  const titleId = useId();
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
  // The arrows walk the message's files, and a picture's zoom keys zoom it;
  // a key's own default, a copy of the lines selected among them, is left alone.
  const walkKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (image && zoom.keyDown(event)) {
      event.preventDefault();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // Note that an arrow on the video's own controls seeks it, as the player's keys do, rather than walking away from it.
    if (event.target instanceof HTMLVideoElement) return;
    event.preventDefault();
    walk(event.key === "ArrowLeft" ? -1 : 1);
  };

  // Note that the card takes focus rather than a button, as Quick Look's
  // does, so no ring stands on a control nobody chose; Tab goes on to the
  // buttons from there.
  return (
    <Dialog
      size={DIALOG_SIZE.MEDIA}
      labelledBy={titleId}
      onDismiss={close}
      onKeyDown={walkKey}
      expand={expand}
    >
      <div
        className="attachment-viewer ph-no-capture"
        data-view={attachmentView(file)}
        data-opening={opening}
      >
        <header className="attachment-viewer-header">
          <FileTypeIcon name={file.name} />
          <h2 id={titleId} className="attachment-viewer-title">
            <OneLine>{file.name}</OneLine>
          </h2>
          <span className="attachment-viewer-size">{sizeLabel(base64)}</span>
          {note === undefined || note === null ? null : (
            <span className="attachment-viewer-note">{note}</span>
          )}
          {files.length > 1 ? (
            <div className="attachment-viewer-walk">
              <HeaderButton
                label={VIEWER_LABEL.PREVIOUS}
                onClick={() => walk(-1)}
                icon={<ChevronLeftIcon aria-hidden="true" />}
              />
              <span className="attachment-viewer-place">
                {`${String(at + 1)} of ${String(files.length)}`}
              </span>
              <HeaderButton
                label={VIEWER_LABEL.NEXT}
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
          {action === undefined || !image ? null : (
            <Button icon={action.icon} onClick={() => action.onPress(file)}>
              {action.label}
            </Button>
          )}
          <HeaderButton
            label={VIEWER_LABEL.DOWNLOAD}
            onClick={() => download(file)}
            icon={<DownloadIcon aria-hidden="true" />}
          />
          <HeaderButton label={VIEWER_LABEL.CLOSE} onClick={close} icon={<CloseIcon />} />
        </header>
        <AttachmentBody key={at} file={file} base64={base64} text={text} zoom={zoom} />
      </div>
    </Dialog>
  );
}
