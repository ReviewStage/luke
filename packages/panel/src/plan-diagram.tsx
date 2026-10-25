import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
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
import { drawnDark, onDrawnThemeChange } from "@luke/ui/appearance";
import {
  DIAGRAM_APPEARANCE,
  DIAGRAM_DRAWING,
  type DiagramAppearance,
  type DiagramDrawing,
  type DiagramModule,
} from "@luke/ui/diagram-contract";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import {
  type ReactNode,
  useContext,
  useEffect,
  useReducer,
  useState,
  useSyncExternalStore,
} from "react";
import { DIAGRAM_REFUSED_LINE, useSideBundles } from "./bundle-loader.js";
import { coarsePointerNow, useCoarsePointer } from "./coarse-pointer.js";
import { SHELL_ROOM } from "./shell-room.js";
import { ShellRoomContext } from "./stage-room.js";
import { AttachmentViewer } from "./tasks/attachment-viewer.js";

/**
 * plan-diagram.tsx -- a plan's ```` ```mermaid ```` fence drawn as its diagram: the diagram bundle loaded the first time one is shown, each picture kept by its code and appearance, and the figure the read view and the editor's preview draw it in.
 *
 * Mermaid is the diagram bundle's (`diagram/`), loaded once per window the
 * first time a fence is drawn, so the bundle every window parses carries
 * this loader and nothing of Mermaid. Each picture is kept by the window's
 * appearance and then by its code, so a section drawn again, or a version
 * opened twice, shows its diagram at once; the appearance flipping draws
 * each shown diagram again in the new one. A diagram can hold words, so the
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

/** How many pictures the window keeps in each appearance, the oldest let go first; enough for every diagram in a plan, and the drafts the editor's preview drew. */
const HELD_PICTURES = 64;

/** Each drawing the window holds, by appearance and then by code, oldest first. */
const drawn = new Map<DiagramAppearance, Map<string, DiagramDrawing>>();

/** Each draw still running, by appearance and then by code, which a second figure of the same code joins. */
const drawing = new Map<DiagramAppearance, Map<string, Promise<DiagramDrawing>>>();

/** The drawing held for a code in an appearance; nothing before it has been drawn. */
function heldDrawing(appearance: DiagramAppearance, code: string): DiagramDrawing | undefined {
  return drawn.get(appearance)?.get(code);
}

/** A drawing kept, as the newest, the oldest past the bound let go. */
function keep(appearance: DiagramAppearance, code: string, answer: DiagramDrawing): void {
  const held = drawn.get(appearance) ?? new Map<string, DiagramDrawing>();
  held.delete(code);
  held.set(code, answer);
  const oldest = held.keys().next();
  if (held.size > HELD_PICTURES && oldest.done !== true) held.delete(oldest.value);
  drawn.set(appearance, held);
}

/** A code drawn in an appearance, joining the draw already running for it; a draw that fails is a refusal. */
function drawnBy(
  module: DiagramModule,
  appearance: DiagramAppearance,
  code: string,
): Promise<DiagramDrawing> {
  const running = drawing.get(appearance)?.get(code);
  if (running !== undefined) return running;
  const pending = drawing.get(appearance) ?? new Map<string, Promise<DiagramDrawing>>();
  drawing.set(appearance, pending);
  const answer = module
    .draw(code, appearance)
    .catch((): DiagramDrawing => ({ kind: DIAGRAM_DRAWING.REFUSED }))
    .then((settled) => {
      keep(appearance, code, settled);
      pending.delete(code);
      return settled;
    });
  pending.set(code, answer);
  return answer;
}

/** The window's appearance now. */
function appearanceNow(): DiagramAppearance {
  return drawnDark() ? DIAGRAM_APPEARANCE.DARK : DIAGRAM_APPEARANCE.LIGHT;
}

/** Calls back each time the window's appearance flips; answers what stops it. */
function onAppearance(changed: () => void): () => void {
  return onDrawnThemeChange(changed);
}

/** The window's appearance, kept as it flips. */
function useAppearance(): DiagramAppearance {
  return useSyncExternalStore(onAppearance, appearanceNow, appearanceNow);
}

/**
 * A code's drawing in the window's appearance: the one held, or nothing
 * while the bundle loads and the draw runs, which then lands. A bundle that
 * could not load refuses every code, so each fence stands as its code, with
 * the `retry` that imports the bundle again; a fence the bundle itself
 * refused has none, since drawing it again would refuse it again.
 */
function useDrawing(
  code: string,
  appearance: DiagramAppearance,
): { readonly drawing: DiagramDrawing | undefined; readonly retry: (() => void) | undefined } {
  const { diagram } = useSideBundles();
  const bundle = useAtomValue(diagram);
  const retryBundle = useAtomRefresh(diagram);
  const held = heldDrawing(appearance, code);
  const [, landed] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (held !== undefined || !AsyncResult.isSuccess(bundle)) return undefined;
    let standing = true;
    void drawnBy(bundle.value, appearance, code).then(() => {
      if (standing) landed();
    });
    return () => {
      standing = false;
    };
  }, [held, bundle, appearance, code]);
  if (held !== undefined) return { drawing: held, retry: undefined };
  return AsyncResult.isFailure(bundle)
    ? { drawing: { kind: DIAGRAM_DRAWING.REFUSED }, retry: retryBundle }
    : { drawing: undefined, retry: undefined };
}

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

/** What a diagram's picture is called where its code names nothing: the kind of thing it is. */
const DIAGRAM_ALT = "Diagram";

/** How much of a title or first line an alt text keeps, so a long one does not read out whole. */
const ALT_LIMIT = 80;

/** The front matter a Mermaid code may open with: its settings between two `---` fences, which name nothing of the diagram but a `title`. */
const FRONT_MATTER = /^\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/u;

/** The title a front matter names (`title: Order flow`), a top-level key. */
const FRONT_TITLE = /^title:[ \t]*(.+?)[ \t]*$/mu;

/** A title a diagram's own lines name, as a line of its own or after the diagram's kind (`title Votes`, `pie title Votes`). */
const BODY_TITLE = /^[ \t]*(?:\w+[ \t]+)?title[ \t]+(.+?)[ \t]*$/mu;

/** A line of Mermaid code that names nothing of the diagram: blank or a comment. */
const SILENT_LINE = /^\s*(?:%%.*)?\s*$/u;

/** The words kept of a title or first line, cut at the limit with an ellipsis. */
function altWords(line: string): string {
  const words = line.replace(/^["']|["']$/gu, "").trim();
  return words.length > ALT_LIMIT ? `${words.slice(0, ALT_LIMIT).trimEnd()}…` : words;
}

/** What a diagram's picture says it is, and what its press is named for after "Enlarge": its title, or its first line, after "Diagram". */
function diagramAlt(code: string): string {
  const front = FRONT_MATTER.exec(code);
  const body = front === null ? code : code.slice(front[0].length);
  const title = FRONT_TITLE.exec(front?.[1] ?? "")?.[1] ?? BODY_TITLE.exec(body)?.[1];
  const first = body.split("\n").find((line) => !SILENT_LINE.test(line));
  const words = altWords(title ?? first ?? "");
  return words === "" ? DIAGRAM_ALT : `${DIAGRAM_ALT}: ${words}`;
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
  return <FailureNote onRetry={onRetry}>{DIAGRAM_REFUSED_LINE}</FailureNote>;
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
