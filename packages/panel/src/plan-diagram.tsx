import { FAILURE_CONDITION, FAILURE_SURFACE } from "@luke/features/shown-failure";
import {
  Button,
  CARD_CORNER,
  CARD_ELEMENT,
  CARD_PADDING,
  Card,
  FailureNote,
  IMAGE_OPENING,
  PictureTile,
  PortalFence,
} from "@luke/ui";
import { DIAGRAM_DRAWING } from "@luke/ui/diagram-contract";
import { type ReactNode, useContext, useState } from "react";
import { DIAGRAM_REFUSED_LINE } from "./bundle-loader.js";
import { coarsePointerNow, useCoarsePointer } from "./coarse-pointer.js";
import { diagramAlt, heldDrawing, useAppearance, useDrawing } from "./diagram-drawing.js";
import { failureShown } from "./failure-report.js";
import { SHELL_ROOM } from "./shell-room.js";
import { ShellRoomContext } from "./stage-room.js";
import { AttachmentViewer } from "./tasks/attachment-viewer.js";

/**
 * plan-diagram.tsx -- a plan's ```` ```mermaid ```` fence drawn as its diagram, in the figure the read view and the editor's preview draw it in.
 *
 * Mermaid is the diagram bundle's (`diagram/`), loaded once per window the
 * first time a fence is drawn, so the bundle every window parses carries
 * this loader and nothing of Mermaid. Each picture is kept by the window's
 * appearance and then by its code (`diagram-drawing.ts`), so a section drawn
 * again, or a version opened twice, shows its diagram at once; the appearance
 * flipping draws each shown diagram again in the new one. A diagram can hold words, so the
 * figure is left out of the screen recording (`ph-no-capture`): a picture
 * of words is the one thing the recording's masking cannot reach.
 *
 * A diagram is drawn no wider than its column, which on a phone shrinks a
 * wide one's words past reading, so where the room is narrow or the window
 * is worked by a finger a tap on the picture, or its head's Full screen,
 * opens it over the window at its own pixels, to be moved about and pinched
 * (`tasks/attachment-viewer.tsx`). With a mouse in a wide room the picture
 * takes no press, and the head offers no Full screen (`tasks.css`).
 */

/** What a diagram opened over the window is named, its header's title and the file Download saves. */
const DIAGRAM_FILE = "Diagram.svg";

/** What the head's press that opens the diagram over the window says. */
const FULL_SCREEN_LABEL = "Full screen";

/** A figure's head: what it is, in the caption's size and the muted ink, and its presses at the row's end. */
const HEAD_CLASS =
  "plan-diagram-head mb-control-gap flex items-center justify-between text-caption-inline font-luke-semibold text-muted-foreground";

/** The shell standing as one pane, a phone's, which the stylesheet reads off its `data-room` (`shell-room.ts`). */
const NARROW_ROOM = '[data-room="narrow"]';

/** Whether a press on `element` opens its diagram over the window: in a narrow room, or on a device worked by a finger, asked as the press lands. */
function opensFullScreen(element: Element): boolean {
  return coarsePointerNow() || element.closest(NARROW_ROOM) !== null;
}

/** A diagram's picture, at its own size up to the column's. */
function DiagramPicture({ url, alt }: { url: string; alt: string }): React.JSX.Element {
  return (
    <img
      className="plan-diagram-picture mx-auto block h-auto max-w-full"
      src={url}
      alt={alt}
      decoding="async"
    />
  );
}

/** The line a refused fence stands under. */
function RefusedLine({ onRetry }: { onRetry?: (() => void) | undefined }): React.JSX.Element {
  return (
    <FailureNote
      failure={failureShown({
        surface: FAILURE_SURFACE.PLAN_DIAGRAM,
        cause: FAILURE_CONDITION.REFUSED,
        refused: true,
      })}
      onRetry={onRetry}
    >
      {DIAGRAM_REFUSED_LINE}
    </FailureNote>
  );
}

/** A diagram opened over the window at its own pixels, until it is closed. */
function OpenDiagram({ url, onClose }: { url: string; onClose: () => void }): React.JSX.Element {
  return (
    // Note that what the viewer takes stays there: React carries a portal's events up the tree it
    // was drawn in, where the section would open to be edited at a press, or step its blocks at an arrow.
    <PortalFence>
      <AttachmentViewer
        files={[{ name: DIAGRAM_FILE, mediaType: "image/svg+xml", url }]}
        at={0}
        onAt={() => undefined}
        onClose={onClose}
        opening={IMAGE_OPENING.OWN_PIXELS}
      />
    </PortalFence>
  );
}

/**
 * A fence drawn as its diagram in the read view: its picture under a head
 * whose Show code puts the code in the picture's place. While the picture is
 * drawn the code stands where it will, as it stands on every surface without
 * diagrams; a fence Mermaid refused says so over its code.
 */
export function PlanDiagram({
  code,
  source,
}: {
  code: string;
  source: ReactNode;
}): React.JSX.Element {
  const { drawing: drawingNow, retry } = useDrawing(code, useAppearance());
  const [showingCode, setShowingCode] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const picture = drawingNow?.kind === DIAGRAM_DRAWING.DRAWN ? drawingNow.url : undefined;
  const alt = diagramAlt(code);
  const pictureShown = picture !== undefined && !showingCode;
  // Note that this draws what a press would do, where `opensFullScreen` asks again as the press lands.
  const coarse = useCoarsePointer();
  const room = useContext(ShellRoomContext);
  const pointerOpens = coarse || room === SHELL_ROOM.NARROW;
  return (
    <Card
      as={CARD_ELEMENT.FIGURE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      className="plan-diagram ph-no-capture my-block-gap px-card-compact py-list-inset"
      aria-busy={drawingNow === undefined}
    >
      <div className={HEAD_CLASS}>
        <span>Diagram</span>
        {picture === undefined ? null : (
          <span className="flex items-center gap-tight-gap">
            <Button onClick={() => setShowingCode((was) => !was)}>
              {showingCode ? "Show diagram" : "Show code"}
            </Button>
            {pictureShown ? (
              <span className="hidden pointer-coarse:flex shell-narrow:flex">
                <Button onClick={() => setFullScreen(true)}>{FULL_SCREEN_LABEL}</Button>
              </span>
            ) : null}
          </span>
        )}
      </div>
      {drawingNow?.kind === DIAGRAM_DRAWING.REFUSED ? <RefusedLine onRetry={retry} /> : null}
      {pictureShown ? (
        <div className="flex min-w-0 justify-center">
          <PictureTile
            name={alt}
            pointerOpens={pointerOpens}
            onOpen={(event) => {
              // Note that a key's press (no pointer's click count) opens it in any room, because the
              // head's Full screen stands only where a finger's tap would open it too.
              const keyed = event.detail === 0;
              if (!keyed && !opensFullScreen(event.currentTarget)) return;
              // The press is the picture's, so the section around it does not open to be edited.
              event.stopPropagation();
              setFullScreen(true);
            }}
          >
            <DiagramPicture url={picture} alt={alt} />
          </PictureTile>
        </div>
      ) : (
        source
      )}
      {fullScreen && picture !== undefined ? (
        <OpenDiagram url={picture} onClose={() => setFullScreen(false)} />
      ) : null}
    </Card>
  );
}

/**
 * A code block's diagram under it in the editor, drawn into the element the
 * editor stands there. While a changed code is drawn, the picture of the
 * code it was changed from stays, so typing in a diagram does not make the
 * page jump at every key.
 */
export function DiagramPreview({
  code,
  previous,
}: {
  code: string;
  previous: string | undefined;
}): React.JSX.Element {
  const appearance = useAppearance();
  const { drawing: drawingNow, retry } = useDrawing(code, appearance);
  const shown =
    drawingNow ?? (previous === undefined ? undefined : heldDrawing(appearance, previous));
  return (
    <>
      <div className={HEAD_CLASS}>
        <span>Preview</span>
      </div>
      {shown?.kind === DIAGRAM_DRAWING.DRAWN ? (
        <DiagramPicture
          url={shown.url}
          alt={diagramAlt(drawingNow === undefined ? (previous ?? code) : code)}
        />
      ) : null}
      {shown?.kind === DIAGRAM_DRAWING.REFUSED ? <RefusedLine onRetry={retry} /> : null}
    </>
  );
}
