import {
  ATTACHMENT_VIEW,
  attachmentText,
  attachmentView,
  chipBase64,
  type FileChip,
  sizeLabel,
} from "@luke/features/attachment-model";
import { CloseIcon } from "@luke/ui";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useId } from "react";
import { CopyGlyph, copyHint, useCopyFeedback } from "../copy-feedback";
import { ModalShell } from "../modal-shell";
import { Tooltip } from "../tooltip";
import { FileTypeIcon } from "./file-type-icon";
import { type ImageZoom, useImageZoom } from "./use-image-zoom";

/**
 * attachment-viewer.tsx -- a file on a message opened over the window, as Quick Look opens one: an image fitted to the window, a text file's numbered lines, or any other file by its icon with a way to save it.
 *
 * A picture opens fitted to the window and zooms as Preview's does: a pinch
 * or a Control-scroll about the pointer, a press to its own pixels there
 * and back, the header's buttons or a bare `=`, `-`, and `0`; zoomed, it is
 * moved by a drag or a two-finger scroll (`./use-image-zoom.ts`).
 *
 * The files of one message are walked in place with the header's arrows or
 * the arrow keys, and the header names the file shown, its size, and how
 * far along the message's files it is, a note the place opening it gives
 * the file shown (who last edited it, for a plan's picture), beside Copy for a text file,
 * whatever the place opening it offers for a picture (Add to plan, in an
 * agent's transcript), Download, and the way out. It opens in the window's one modal frame
 * (`../modal-shell.tsx`): the window dims, Tab stays inside the card, and
 * Escape, a press on the dimmed window, and the way out all close it and
 * hand focus back to the chip that opened it. The
 * file's bytes are the chip's own, so a file in the message box and one
 * read back with the transcript open the same. A message's files are its
 * developer's own, so the card is left out of the screen recording
 * (`ph-no-capture`) as a second line behind the masking.
 *
 * Note that a PDF is shown by its icon rather than drawn, because the
 * window's policy refuses the frames and objects Chromium draws one in.
 */

/** What the header's buttons are named. */
const VIEWER_LABEL = {
  PREVIOUS: "Previous file",
  NEXT: "Next file",
  COPY: "Copy text",
  ZOOM_OUT: "Zoom out",
  ZOOM_IN: "Zoom in",
  DOWNLOAD: "Download",
  CLOSE: "Close",
} as const;

/** One more thing the viewer's picture may be given to: its button's words and glyph, and what a press does with the file shown. */
export interface ViewerAction {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly onPress: (file: FileChip) => void;
}

/** A text file's lines; a final line break ends the last line rather than starting another. */
function linesOf(text: string): string[] {
  const lines = text.split(/\r?\n/u);
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
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
      <button
        type="button"
        className="icon-button"
        aria-label={VIEWER_LABEL.COPY}
        onClick={() => copy(text)}
      >
        <CopyGlyph state={state} />
      </button>
    </Tooltip>
  );
}

/** One of the header's icon buttons, its name its hint. */
function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip label={label}>
      <button type="button" className="icon-button" aria-label={label} onClick={onClick}>
        {children}
      </button>
    </Tooltip>
  );
}

/** The file shown: the picture, the numbered lines of its text, or the icon, name, and size over Download. */
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
        <img
          className="attachment-viewer-image"
          src={file.url}
          alt={file.name}
          {...zoom.imageProps}
        />
      </div>
    );
  }
  if (text !== undefined) {
    return (
      <div className="attachment-viewer-body code-lines attachment-viewer-lines">
        {linesOf(text).map((line, index) => (
          // Note that a line's place is its identity: the lines never reorder.
          <div key={index} className="code-line">
            <span className="code-line-number">{index + 1}</span>
            <code className="code-line-text">{line}</code>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="attachment-viewer-body attachment-viewer-other">
      <FileTypeIcon name={file.name} />
      <p className="attachment-viewer-other-name">{file.name}</p>
      <p className="attachment-viewer-other-size">{sizeLabel(base64)}</p>
      <button type="button" className="toolbar-button" onClick={() => download(file)}>
        <DownloadIcon aria-hidden="true" />
        {VIEWER_LABEL.DOWNLOAD}
      </button>
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
}): React.JSX.Element | null {
  const titleId = useId();
  const file = files[at];
  const zoom = useImageZoom(file?.name ?? "", file?.url ?? "");

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
    event.preventDefault();
    walk(event.key === "ArrowLeft" ? -1 : 1);
  };

  // Note that the card takes focus rather than a button, as Quick Look's
  // does, so no ring stands on a control nobody chose; Tab goes on to the
  // buttons from there.
  return (
    <ModalShell
      className="attachment-viewer"
      backdropClassName="attachment-viewer-backdrop ph-no-capture"
      labelledBy={titleId}
      onDismiss={onClose}
      onKeyDown={walkKey}
      data-view={attachmentView(file)}
    >
      <header className="attachment-viewer-header">
        <FileTypeIcon name={file.name} />
        <h2 id={titleId} className="attachment-viewer-title">
          {file.name}
        </h2>
        <span className="attachment-viewer-size">{sizeLabel(base64)}</span>
        {note === undefined || note === null ? null : (
          <span className="attachment-viewer-note">{note}</span>
        )}
        {files.length > 1 ? (
          <div className="attachment-viewer-walk">
            <HeaderButton label={VIEWER_LABEL.PREVIOUS} onClick={() => walk(-1)}>
              <ChevronLeftIcon aria-hidden="true" />
            </HeaderButton>
            <span className="attachment-viewer-place">
              {`${String(at + 1)} of ${String(files.length)}`}
            </span>
            <HeaderButton label={VIEWER_LABEL.NEXT} onClick={() => walk(1)}>
              <ChevronRightIcon aria-hidden="true" />
            </HeaderButton>
          </div>
        ) : null}
        {text === undefined ? null : <CopyTextButton text={text} />}
        {image ? (
          <>
            <HeaderButton label={VIEWER_LABEL.ZOOM_OUT} onClick={() => zoom.step(-1)}>
              <ZoomOutIcon aria-hidden="true" />
            </HeaderButton>
            <HeaderButton label={VIEWER_LABEL.ZOOM_IN} onClick={() => zoom.step(1)}>
              <ZoomInIcon aria-hidden="true" />
            </HeaderButton>
          </>
        ) : null}
        {action === undefined || !image ? null : (
          <button type="button" className="toolbar-button" onClick={() => action.onPress(file)}>
            {action.icon}
            {action.label}
          </button>
        )}
        <HeaderButton label={VIEWER_LABEL.DOWNLOAD} onClick={() => download(file)}>
          <DownloadIcon aria-hidden="true" />
        </HeaderButton>
        <HeaderButton label={VIEWER_LABEL.CLOSE} onClick={onClose}>
          <CloseIcon />
        </HeaderButton>
      </header>
      <AttachmentBody key={at} file={file} base64={base64} text={text} zoom={zoom} />
    </ModalShell>
  );
}
