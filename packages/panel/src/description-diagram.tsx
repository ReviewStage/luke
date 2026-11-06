import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
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
} from "@repo/ui";
import { DIAGRAM_DRAWING } from "@repo/ui/diagram-contract";
import { type ReactNode, useContext, useState } from "react";
import { DIAGRAM_REFUSED_LINE } from "./bundle-loader.js";
import { coarsePointerNow, useCoarsePointer } from "./coarse-pointer.js";
import { diagramAlt, heldDrawing, useAppearance, useDrawing } from "./diagram-drawing.js";
import { failureShown } from "./failure-report.js";
import { SHELL_ROOM } from "./shell-room.js";
import { ShellRoomContext } from "./stage-room.js";
import { AttachmentViewer } from "./tasks/attachment-viewer.js";

const DIAGRAM_FILE = "Diagram.svg";

const FULL_SCREEN_LABEL = "Full screen";

const HEAD_CLASS =
  "description-diagram-head mb-control-gap flex items-center justify-between text-caption-inline font-ui-semibold text-muted-foreground";

const NARROW_ROOM = '[data-room="narrow"]';

function opensFullScreen(element: Element): boolean {
  return coarsePointerNow() || element.closest(NARROW_ROOM) !== null;
}

function DiagramPicture({ url, alt }: { url: string; alt: string }): React.JSX.Element {
  return (
    <img
      className="description-diagram-picture mx-auto block h-auto max-w-full"
      src={url}
      alt={alt}
      decoding="async"
    />
  );
}

function RefusedLine({ onRetry }: { onRetry?: (() => void) | undefined }): React.JSX.Element {
  return (
    <FailureNote
      failure={failureShown({
        surface: FAILURE_SURFACE.DESCRIPTION_DIAGRAM,
        cause: FAILURE_CONDITION.REFUSED,
        refused: true,
      })}
      onRetry={onRetry}
    >
      {DIAGRAM_REFUSED_LINE}
    </FailureNote>
  );
}

function OpenDiagram({ url, onClose }: { url: string; onClose: () => void }): React.JSX.Element {
  return (
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

export function DescriptionDiagram({
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
  const coarse = useCoarsePointer();
  const room = useContext(ShellRoomContext);
  const pointerOpens = coarse || room === SHELL_ROOM.NARROW;
  return (
    <Card
      as={CARD_ELEMENT.FIGURE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      className="description-diagram ph-no-capture my-block-gap px-card-compact py-list-inset"
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
              const keyed = event.detail === 0;
              if (!keyed && !opensFullScreen(event.currentTarget)) return;
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
