import { useAtomValue } from "@effect/atom-react";
import type { AgentBrowserTab } from "@luke/features/agent-browser-tab-wire";
import { chordIsWindows } from "@luke/features/browser-acts";
import {
  BROWSER_LIVE_CLIENT,
  BROWSER_LIVE_CLOSE_REASON,
  BROWSER_LIVE_KEY_ACTION,
  BROWSER_LIVE_MODIFIER,
  BROWSER_LIVE_MOUSE_ACTION,
  BROWSER_LIVE_MOUSE_BUTTON,
} from "@luke/features/browser-live-wire";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { Duration } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { HandIcon, MousePointerClickIcon } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { appPlatform } from "../app-platform.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { SPINNER_SIZE, Spinner } from "../spinner.js";
import { Tooltip } from "../tooltip.js";
import { CloudBrowserCursor, cursorPlacement } from "./cloud-browser-cursor.js";
import {
  CLOUD_BROWSER_PHASE,
  type CloudBrowserFrame,
  type CloudBrowserView,
  type CloudBrowserViewport,
  cloudBrowserLive,
  type InputMessage,
  OPENING_VIEW,
} from "./cloud-browser-live.js";
import { CLOUD_BROWSER_AGENT_RECENT } from "./cloud-browser-tabs.js";

/**
 * cloud-browser-pane.tsx -- one Browser tab in an agent's cloud browser, in the side panel: a bar saying whose browser it is and who drives it, with Take over and Hand back, and the page drawn live on a canvas.
 *
 * The page runs in the agent's own sandbox and arrives as frames over the
 * live view (`cloud-browser-live.ts`), drawn on a canvas sized to the page's
 * shape inside the pane, which is the viewport every point the member sends
 * is in. The pane opens its view while it is shown, and again each time it
 * is shown again, or Watch again pressed, after the relay closed it; until
 * the page first paints, and while it reconnects, the window's spinner
 * stands over it, and a view closed as idle
 * offers Watch again. While the member drives the tab, the mouse, the
 * wheel, and the keys pressed on the canvas go to the page, and a paste goes
 * as text; a Command chord the window answers (`chordIsWindows`) stays the
 * window's, as over the Mac's Browser tab, and one the page edits text with
 * is sent as Control, since the page runs on Linux. What the page shows is
 * the agent's and its members', so the pane is left out of the screen
 * recording (`ph-no-capture`), whose canvas recording is off in any case,
 * and no frame, address, or title is kept past the drawn tab. The agent's
 * pointer is drawn over the canvas, never in its frame, while the agent has
 * the tab (`cloud-browser-cursor.tsx`).
 */

/** The most characters one text message carries; a longer paste goes in pieces. */
const TEXT_PIECE_CHARS = 4_096;

/** A wheel's line, in pixels, for a wheel that counts in lines. */
const WHEEL_LINE_PIXELS = 16;

/** The keys a Command chord edits text with on the page, sent there as Control. */
const PAGE_EDIT_KEYS: ReadonlySet<string> = new Set(["a", "c", "x", "z"]);

/** A view that never opens, for a pane not on screen. */
const RESTING = Atom.make<AsyncResult.AsyncResult<CloudBrowserView>>(AsyncResult.initial());

/** The mouse buttons, by a DOM event's `button`. */
const BUTTON_OF = [
  BROWSER_LIVE_MOUSE_BUTTON.LEFT,
  BROWSER_LIVE_MOUSE_BUTTON.MIDDLE,
  BROWSER_LIVE_MOUSE_BUTTON.RIGHT,
] as const;

/** The modifier bits an event holds, as the live view counts them. */
function modifiersOf(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (event.altKey ? BROWSER_LIVE_MODIFIER.ALT : 0) |
    (event.ctrlKey ? BROWSER_LIVE_MODIFIER.CONTROL : 0) |
    (event.metaKey ? BROWSER_LIVE_MODIFIER.META : 0) |
    (event.shiftKey ? BROWSER_LIVE_MODIFIER.SHIFT : 0)
  );
}

/** The largest box of the page's shape that fits the body, or the body itself before the shape is known. */
function fitted(body: CloudBrowserViewport, aspect: number | undefined): CloudBrowserViewport {
  if (aspect === undefined || body.width < 1 || body.height < 1) return body;
  const width = Math.min(body.width, body.height * aspect);
  return { width: Math.floor(width), height: Math.floor(width / aspect) };
}

/** What the bar says of who has the tab: the member, another member, its agent lately, or nothing. */
function standingOf(input: {
  view: CloudBrowserView;
  tab: AgentBrowserTab;
  owner: string;
  memberName: (userId: string) => string | undefined;
}): string | undefined {
  const { view, tab, owner, memberName } = input;
  const driver = view.driver?.driver ?? tab.driver;
  if (view.driver?.yours === true) return "You're driving";
  if (driver !== null) return `${memberName(driver.userId) ?? "A teammate"} is driving`;
  const lately = Date.now() - tab.lastActedAt < Duration.toMillis(CLOUD_BROWSER_AGENT_RECENT);
  return lately ? `${owner} is using this tab` : undefined;
}

/** What stands over the body while no page stands to drive: a wait, drawn as the window's spinner, or words. */
type Notice =
  | { readonly waiting: true; readonly label: string }
  | { readonly waiting: false; readonly words: string };

/** What stands over the body while no page stands to drive, or none once one does. */
function noticeOf(view: CloudBrowserView): Notice | undefined {
  if (view.phase === CLOUD_BROWSER_PHASE.ENDED) {
    const words =
      view.ended === BROWSER_LIVE_CLOSE_REASON.GONE
        ? "This tab has closed"
        : "Paused while no one watched";
    return { waiting: false, words };
  }
  if (view.phase === CLOUD_BROWSER_PHASE.RECONNECTING) {
    return { waiting: true, label: "Reconnecting" };
  }
  return view.painted ? undefined : { waiting: true, label: "Waiting for the page" };
}

/** Paints a decoded frame over the canvas, scaled to it whole. */
function paint(canvas: HTMLCanvasElement | null, image: HTMLImageElement | undefined): void {
  if (canvas === null || image === undefined) return;
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
}

/**
 * The relative luminance (WCAG 2, linear light) under which the page beneath
 * the agent's pointer reads as dark: about where its two greys, `--agent-pointer`
 * (#6b6f76) and `--agent-pointer-on-dark` (#ced1d6), stand apart from the page
 * equally, so the one that stands further apart is drawn.
 */
const DARK_PAGE_LUMA = 0.32;

/** One sRGB channel byte in linear light, as WCAG 2's relative luminance reads it. */
function linearOf(byte: number): number {
  const channel = byte / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** The side of the square of canvas pixels the page beneath the pointer is read across. */
const GROUND_SAMPLE = 8;

/** How far into the arrow's body from its tip the page beneath it is read, in CSS pixels. */
const GROUND_INSET = 4;

/**
 * Whether the drawn page is dark beneath the pointer's tip, given in CSS
 * pixels of the canvas; none where the canvas cannot be read. Only a few
 * pixels are read, and only to choose the pointer's grey: nothing read is
 * kept.
 */
function darkBeneath(
  canvas: HTMLCanvasElement | null,
  point: { readonly x: number; readonly y: number },
): boolean | undefined {
  const context = canvas?.getContext("2d");
  if (canvas === null || context === null || context === undefined) return undefined;
  const ratio = window.devicePixelRatio || 1;
  const side = Math.min(GROUND_SAMPLE, canvas.width, canvas.height);
  if (side < 1) return undefined;
  const at = (value: number, most: number) =>
    Math.max(0, Math.min(most - side, Math.round((value + GROUND_INSET) * ratio - side / 2)));
  const { data } = context.getImageData(
    at(point.x, canvas.width),
    at(point.y, canvas.height),
    side,
    side,
  );
  let luma = 0;
  for (let index = 0; index < data.length; index += 4) {
    luma +=
      0.2126 * linearOf(data[index] ?? 0) +
      0.7152 * linearOf(data[index + 1] ?? 0) +
      0.0722 * linearOf(data[index + 2] ?? 0);
  }
  return luma / (data.length / 4) < DARK_PAGE_LUMA;
}

/**
 * A cloud Browser tab: its bar, then the page live. `owner` names whose
 * browser it is in, the agent's name or Luke; `shown` is whether the panel
 * is on screen and staying, which the view stands open under alone.
 */
export function CloudBrowserPane({
  taskId,
  tab,
  owner,
  shown,
  memberName,
}: {
  taskId: string;
  tab: AgentBrowserTab;
  owner: string;
  shown: boolean;
  /** A member's name by their account's id; none for one not known. */
  memberName: (userId: string) => string | undefined;
}): React.JSX.Element {
  const body = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bodySize, setBodySize] = useState<CloudBrowserViewport>({ width: 0, height: 0 });
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  // Each new view of the tab: one more each time the pane is shown, or clicked once the relay closed it.
  const [generation, setGeneration] = useState(0);
  const size = fitted(bodySize, aspect);
  const viewport = useRef<CloudBrowserViewport | undefined>(undefined);
  viewport.current = size.width > 0 && size.height > 0 ? size : undefined;

  // Where the agent's pointer stands on the drawn page, and whether the page is dark beneath it.
  const placed = tab.cursor === undefined ? undefined : cursorPlacement(tab.cursor, size);
  const pointer = useRef(placed);
  pointer.current = placed;
  const [onDarkPage, setOnDarkPage] = useState(false);
  const readGround = useCallback(() => {
    const point = pointer.current;
    const dark = point === undefined ? undefined : darkBeneath(canvas.current, point);
    if (dark !== undefined) setOnDarkPage(dark);
  }, []);
  useEffect(() => {
    if (placed !== undefined) readGround();
  }, [readGround, placed?.x, placed?.y]);

  // The last frame drawn, kept only to paint it again once the canvas changes size, which clears it.
  const shownFrame = useRef<HTMLImageElement | undefined>(undefined);
  const onFrame = useCallback(
    (frame: CloudBrowserFrame) => {
      if (frame.pageWidth > 0 && frame.pageHeight > 0) {
        setAspect(frame.pageWidth / frame.pageHeight);
      }
      const image = new Image();
      image.onload = () => {
        shownFrame.current = image;
        paint(canvas.current, image);
        readGround();
      };
      image.src = `data:image/jpeg;base64,${frame.data}`;
    },
    [readGround],
  );
  const live = useMemo(
    () =>
      cloudBrowserLive({
        open: appPlatform().openBrowserLive,
        target: { taskId, tabId: tab.id },
        viewport: () => viewport.current,
        onFrame,
      }),
    [taskId, tab.id, onFrame, generation],
  );
  const views = useMemo(() => (shown ? rendererRuntime.atom(live.views) : RESTING), [live, shown]);
  const view = AsyncResult.getOrElse(useAtomValue(views), () => OPENING_VIEW);

  // A pane shown again opens a new view, since the one before may have closed as idle meanwhile.
  const wasShown = useRef(shown);
  useEffect(() => {
    if (shown && !wasShown.current) setGeneration((count) => count + 1);
    wasShown.current = shown;
  }, [shown]);
  useLayoutEffect(() => {
    const element = body.current;
    if (element === null) return;
    const measure = () => setBodySize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // The viewport goes again each time the canvas changes size, and the page is painted again on it.
  useLayoutEffect(() => {
    if (size.width < 1 || size.height < 1) return;
    paint(canvas.current, shownFrame.current);
    live.resized();
  }, [live, size.width, size.height]);

  const yours = view.driver?.yours === true;
  // A wheel over the page the member drives scrolls the page alone, never the panel around it;
  // React's own wheel listener is passive, so the default is refused on one of the canvas's own.
  const driving = useRef(yours);
  driving.current = yours;
  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    const refuse = (event: globalThis.WheelEvent) => {
      if (driving.current) event.preventDefault();
    };
    element.addEventListener("wheel", refuse, { passive: false });
    return () => element.removeEventListener("wheel", refuse);
  }, []);
  const at = (event: MouseEvent | WheelEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(size.width, event.clientX - box.left)),
      y: Math.max(0, Math.min(size.height, event.clientY - box.top)),
    };
  };
  const mouse =
    (action: (typeof BROWSER_LIVE_MOUSE_ACTION)[keyof typeof BROWSER_LIVE_MOUSE_ACTION]) =>
    (event: MouseEvent<HTMLCanvasElement>) => {
      if (!yours) return;
      if (action === BROWSER_LIVE_MOUSE_ACTION.DOWN) event.currentTarget.focus();
      const button =
        action === BROWSER_LIVE_MOUSE_ACTION.MOVE
          ? BROWSER_LIVE_MOUSE_BUTTON.NONE
          : (BUTTON_OF[event.button] ?? BROWSER_LIVE_MOUSE_BUTTON.NONE);
      live.input({
        type: BROWSER_LIVE_CLIENT.MOUSE,
        action,
        ...at(event),
        button,
        buttons: event.buttons & 31,
        clickCount: action === BROWSER_LIVE_MOUSE_ACTION.MOVE ? 0 : Math.min(3, event.detail || 1),
        modifiers: modifiersOf(event),
      });
    };
  const wheel = (event: WheelEvent<HTMLCanvasElement>) => {
    if (!yours) return;
    const scale = event.deltaMode === 0 ? 1 : WHEEL_LINE_PIXELS;
    const clamp = (delta: number) => Math.max(-10_000, Math.min(10_000, delta * scale));
    live.input({
      type: BROWSER_LIVE_CLIENT.WHEEL,
      ...at(event),
      deltaX: clamp(event.deltaX),
      deltaY: clamp(event.deltaY),
      modifiers: modifiersOf(event),
    });
  };
  const key =
    (action: (typeof BROWSER_LIVE_KEY_ACTION)[keyof typeof BROWSER_LIVE_KEY_ACTION]) =>
    (event: KeyboardEvent<HTMLCanvasElement>) => {
      if (!yours) return;
      const chord = {
        key: event.key,
        meta: event.metaKey,
        shift: event.shiftKey,
        alt: event.altKey,
        control: event.ctrlKey,
      };
      // A chord the window answers is left to it; ⌘V, or Control-V off a Mac, arrives as the paste it is.
      if (chordIsWindows(chord)) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "v")
        return;
      event.preventDefault();
      const edit = event.metaKey && PAGE_EDIT_KEYS.has(event.key.toLowerCase());
      const modifiers = edit
        ? (modifiersOf(event) & ~BROWSER_LIVE_MODIFIER.META) | BROWSER_LIVE_MODIFIER.CONTROL
        : modifiersOf(event);
      const message: InputMessage = {
        type: BROWSER_LIVE_CLIENT.KEY,
        action,
        key: event.key.slice(0, 64),
        code: event.code.slice(0, 64),
        keyCode: Math.max(0, Math.min(255, event.keyCode)),
        modifiers,
      };
      live.input(message);
    };
  const paste = (event: React.ClipboardEvent<HTMLCanvasElement>) => {
    if (!yours) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    for (let from = 0; from < text.length; from += TEXT_PIECE_CHARS) {
      live.input({
        type: BROWSER_LIVE_CLIENT.TEXT,
        text: text.slice(from, from + TEXT_PIECE_CHARS),
      });
    }
  };

  // A view the relay closed as idle opens again on a press; one whose tab closed does not.
  const resumable =
    view.phase === CLOUD_BROWSER_PHASE.ENDED && view.ended === BROWSER_LIVE_CLOSE_REASON.IDLE;
  const notice = noticeOf(view);
  const standing = standingOf({ view, tab, owner, memberName });
  const address = view.page?.address ?? tab.address;
  const driven = (view.driver?.driver ?? tab.driver) !== null;
  return (
    <section
      className="browser-view cloud-browser-view file-view ph-no-capture"
      aria-label="Browser"
    >
      <header className="file-view-bar browser-view-bar cloud-browser-bar">
        <div className="cloud-browser-where">
          <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN} truncate>
            {owner === "Luke" ? "Luke's browser" : `${owner}'s browser`}
          </Text>
          <Tooltip label={address}>
            <Text
              variant={TEXT_VARIANT.CAPTION}
              tone={TEXT_TONE.MUTED}
              font={TEXT_FONT.MONO}
              as={TEXT_ELEMENT.SPAN}
              truncate
            >
              {address}
            </Text>
          </Tooltip>
        </div>
        {standing === undefined ? null : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
            {standing}
          </Text>
        )}
        <div className="file-view-actions">
          {yours ? (
            <Button
              size={BUTTON_SIZE.COMPACT}
              variant={BUTTON_VARIANT.OUTLINE}
              icon={<HandIcon aria-hidden="true" />}
              onClick={live.handBack}
            >
              Hand back
            </Button>
          ) : (
            <Button
              size={BUTTON_SIZE.COMPACT}
              variant={BUTTON_VARIANT.OUTLINE}
              icon={<MousePointerClickIcon aria-hidden="true" />}
              disabled={view.phase !== CLOUD_BROWSER_PHASE.LIVE}
              onClick={live.takeOver}
            >
              Take over
            </Button>
          )}
        </div>
      </header>
      {view.takeoverRefused ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          Only whoever started this agent can take its tab over.
        </Text>
      ) : null}
      <div ref={body} className="browser-view-body cloud-browser-body">
        <div className="cloud-browser-stage" style={{ width: size.width, height: size.height }}>
          <canvas
            ref={canvas}
            className="cloud-browser-canvas"
            aria-label="The page"
            data-driving={yours ? "" : undefined}
            tabIndex={yours ? 0 : -1}
            width={Math.round(size.width * (window.devicePixelRatio || 1))}
            height={Math.round(size.height * (window.devicePixelRatio || 1))}
            style={{ width: size.width, height: size.height }}
            onMouseDown={mouse(BROWSER_LIVE_MOUSE_ACTION.DOWN)}
            onMouseUp={mouse(BROWSER_LIVE_MOUSE_ACTION.UP)}
            onMouseMove={mouse(BROWSER_LIVE_MOUSE_ACTION.MOVE)}
            onContextMenu={(event) => {
              if (yours) event.preventDefault();
            }}
            onWheel={wheel}
            onKeyDown={key(BROWSER_LIVE_KEY_ACTION.DOWN)}
            onKeyUp={key(BROWSER_LIVE_KEY_ACTION.UP)}
            onPaste={paste}
          />
          <CloudBrowserCursor
            cursor={tab.cursor}
            lastActedAt={tab.lastActedAt}
            frame={size}
            hidden={driven || notice !== undefined}
            onDarkPage={onDarkPage}
          />
        </div>
        {notice === undefined ? null : notice.waiting ? (
          <div className="cloud-browser-notice">
            <Spinner label={notice.label} size={SPINNER_SIZE.REGION} />
          </div>
        ) : (
          <div className="cloud-browser-notice" role="status">
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {notice.words}
            </Text>
            {resumable ? (
              <Button
                size={BUTTON_SIZE.COMPACT}
                variant={BUTTON_VARIANT.OUTLINE}
                onClick={() => setGeneration((count) => count + 1)}
              >
                Watch again
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
