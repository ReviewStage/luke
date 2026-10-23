import { useAtomValue } from "@effect/atom-react";
import type { AgentBrowserTab } from "@luke/features/agent-browser-tab-wire";
import { browserAddressOf, chordIsWindows } from "@luke/features/browser-acts";
import {
  BROWSER_LIVE_CLIENT,
  BROWSER_LIVE_CLOSE_REASON,
  BROWSER_LIVE_HISTORY,
  BROWSER_LIVE_KEY_ACTION,
  BROWSER_LIVE_MODIFIER,
  BROWSER_LIVE_MOUSE_ACTION,
  BROWSER_LIVE_MOUSE_BUTTON,
  type BrowserLiveHistory,
} from "@luke/features/browser-live-wire";
import { BROWSER_TAB_OPEN_FAILURE, type BrowserTabOpenFailure } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import {
  AddressField,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  FILL_ELEMENT,
  Fill,
  REMOTE_KEY_ACTION,
  REMOTE_POINTER_ACTION,
  type RemoteKey,
  type RemoteModifiers,
  type RemotePointer,
  RemoteSurface,
  type RemoteWheel,
  SPINNER_SIZE,
  Spinner,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { Duration } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  HandIcon,
  MousePointerClickIcon,
  RotateCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { BarStep } from "./browser-pane.js";
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
import {
  CLOUD_BROWSER_AGENT_RECENT,
  type CloudBrowserDraft,
  noteOpenedCloudTab,
} from "./cloud-browser-tabs.js";

/**
 * cloud-browser-pane.tsx -- one Browser tab in an agent's cloud browser, in the side panel: a bar with back, forward, reload, and the address, as the Mac's Browser tab has, then Take over and Hand back, and the page drawn live on a canvas; or a draft of one, which opens nothing until its bar opens an address.
 *
 * Whose browser the tab lives in, which it never leaves, its strip tab
 * says with the agent's glyph and its card in words (`side-panel.tsx`), and
 * a draft's body says too. The bar's steps and its address steer the page over the live view whoever drives it: the
 * relay takes a tab nobody drives over for the member first, and refuses a
 * step while another member holds it, which the line under the bar says.
 * A draft (`cloud-browser-tabs.ts`'s `startCloudDraft`) draws the same bar
 * with its address focused: Enter opens the tab through the service, which
 * resumes the agent's sandbox where it stopped and takes the tab over for
 * the member, and the panel lands on it; Escape discards the draft.
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

/** The live view's mouse action, by the surface's. */
const MOUSE_ACTION = {
  [REMOTE_POINTER_ACTION.DOWN]: BROWSER_LIVE_MOUSE_ACTION.DOWN,
  [REMOTE_POINTER_ACTION.UP]: BROWSER_LIVE_MOUSE_ACTION.UP,
  [REMOTE_POINTER_ACTION.MOVE]: BROWSER_LIVE_MOUSE_ACTION.MOVE,
} as const;

/** The live view's key action, by the surface's. */
const KEY_ACTION = {
  [REMOTE_KEY_ACTION.DOWN]: BROWSER_LIVE_KEY_ACTION.DOWN,
  [REMOTE_KEY_ACTION.UP]: BROWSER_LIVE_KEY_ACTION.UP,
} as const;

/** The modifier bits held, as the live view counts them. */
function modifiersOf(held: RemoteModifiers): number {
  return (
    (held.alt ? BROWSER_LIVE_MODIFIER.ALT : 0) |
    (held.control ? BROWSER_LIVE_MODIFIER.CONTROL : 0) |
    (held.meta ? BROWSER_LIVE_MODIFIER.META : 0) |
    (held.shift ? BROWSER_LIVE_MODIFIER.SHIFT : 0)
  );
}

/** The largest box of the page's shape that fits the body, or the body itself before the shape is known. */
function fitted(body: CloudBrowserViewport, aspect: number | undefined): CloudBrowserViewport {
  if (aspect === undefined || body.width < 1 || body.height < 1) return body;
  const width = Math.min(body.width, body.height * aspect);
  return { width: Math.floor(width), height: Math.floor(width / aspect) };
}

/** Whose browser a cloud Browser tab lives in: its agent's name, or Luke's, and the glyph its strip tab and its card wear. */
export interface CloudBrowserOwner {
  readonly name: string;
  readonly icon: React.JSX.Element;
}

/** What a browser is called by whose it is: "Invite expiry's browser", and "Invite emails' browser" for a name that ends in an s. */
export function browserOf(name: string): string {
  return name.endsWith("s") ? `${name}' browser` : `${name}'s browser`;
}

/** Why a draft did not open, in words, naming the agent where the reason is its. */
function openFailureWords(failure: BrowserTabOpenFailure, agent: string): string {
  switch (failure) {
    case BROWSER_TAB_OPEN_FAILURE.INVALID_ADDRESS:
      return "Only http and https addresses open in an agent's browser.";
    case BROWSER_TAB_OPEN_FAILURE.NOT_PERMITTED:
      return `Only whoever started ${agent} can open a tab in its browser.`;
    case BROWSER_TAB_OPEN_FAILURE.NOT_FOUND:
      return `${agent} is no longer on this task.`;
    case BROWSER_TAB_OPEN_FAILURE.NOT_READY:
      return `${agent} hasn't opened its sandbox yet. Try again once it has started working.`;
    case BROWSER_TAB_OPEN_FAILURE.RETIRED:
      return `${agent} is archived, so its browser is gone.`;
    case BROWSER_TAB_OPEN_FAILURE.UNREACHABLE:
      return `${browserOf(agent)} couldn't be reached. Try again in a moment.`;
    case BROWSER_TAB_OPEN_FAILURE.UNANSWERED:
      return "The tab couldn't be opened. Try again.";
  }
}

/**
 * A cloud Browser tab's bar: back, forward, and reload where `onStep` takes
 * them, and the address,
 * which opens what is typed as the Mac's Browser tab's bar reads it, then
 * whatever the caller hands it. What is typed is put back on a blur, unless
 * `holdTyped`; Escape answers `onEscape` where given, and leaves the bar
 * otherwise.
 */
function CloudBrowserBar({
  address,
  onStep,
  onOpen,
  onEscape,
  holdTyped = false,
  autoFocus = false,
  disabled = false,
  children,
}: {
  address: string;
  onStep: ((step: BrowserLiveHistory) => void) | undefined;
  onOpen: (address: string) => void;
  onEscape?: (() => void) | undefined;
  holdTyped?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  // What the bar holds while it is being typed into, none while it shows the page's address.
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const go = () => {
    const opened = browserAddressOf(typed ?? "");
    if (opened === undefined) return;
    if (!holdTyped) {
      setTyped(undefined);
      field.current?.blur();
    }
    onOpen(opened);
  };
  return (
    <header className="file-view-bar browser-view-bar cloud-browser-bar">
      <div className="file-view-history">
        <BarStep
          label="Back"
          icon={<ArrowLeftIcon aria-hidden="true" />}
          disabled={onStep === undefined}
          onPress={() => onStep?.(BROWSER_LIVE_HISTORY.BACK)}
        />
        <BarStep
          label="Forward"
          icon={<ArrowRightIcon aria-hidden="true" />}
          disabled={onStep === undefined}
          onPress={() => onStep?.(BROWSER_LIVE_HISTORY.FORWARD)}
        />
        <BarStep
          label="Reload"
          icon={<RotateCwIcon aria-hidden="true" />}
          disabled={onStep === undefined}
          onPress={() => onStep?.(BROWSER_LIVE_HISTORY.RELOAD)}
        />
      </div>
      <AddressField
        ref={field}
        value={typed ?? address}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={setTyped}
        onOpen={go}
        onBlur={holdTyped ? undefined : () => setTyped(undefined)}
        onEscape={
          onEscape ??
          (() => {
            setTyped(undefined);
            field.current?.blur();
          })
        }
      />
      {children}
    </header>
  );
}

/** What the bar says of who has the tab: the member, another member, its agent lately, or nothing. */
function standingOf(input: {
  view: CloudBrowserView;
  tab: AgentBrowserTab;
  owner: CloudBrowserOwner;
  memberName: (userId: string) => string | undefined;
}): string | undefined {
  const { view, tab, owner, memberName } = input;
  const driver = view.driver?.driver ?? tab.driver;
  if (view.driver?.yours === true) return "You're driving";
  if (driver !== null) return `${memberName(driver.userId) ?? "A teammate"} is driving`;
  const lately = Date.now() - tab.lastActedAt < Duration.toMillis(CLOUD_BROWSER_AGENT_RECENT);
  return lately ? `${owner.name} is using this tab` : undefined;
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
  owner: CloudBrowserOwner;
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
  const pointerInput = (input: RemotePointer) => {
    live.input({
      type: BROWSER_LIVE_CLIENT.MOUSE,
      action: MOUSE_ACTION[input.action],
      x: input.x,
      y: input.y,
      button:
        input.button === undefined
          ? BROWSER_LIVE_MOUSE_BUTTON.NONE
          : (BUTTON_OF[input.button] ?? BROWSER_LIVE_MOUSE_BUTTON.NONE),
      buttons: input.buttons & 31,
      clickCount: input.clickCount,
      modifiers: modifiersOf(input.modifiers),
    });
  };
  const wheelInput = (input: RemoteWheel) => {
    const clamp = (delta: number) => Math.max(-10_000, Math.min(10_000, delta));
    live.input({
      type: BROWSER_LIVE_CLIENT.WHEEL,
      x: input.x,
      y: input.y,
      deltaX: clamp(input.deltaX),
      deltaY: clamp(input.deltaY),
      modifiers: modifiersOf(input.modifiers),
    });
  };
  const keyInput = (input: RemoteKey): boolean => {
    const { key, modifiers: held } = input;
    const chord = { key, meta: held.meta, shift: held.shift, alt: held.alt, control: held.control };
    // A chord the window answers is left to it; ⌘V, or Control-V off a Mac, arrives as the paste it is.
    if (chordIsWindows(chord)) return false;
    if ((held.meta || held.control) && !held.alt && key.toLowerCase() === "v") return false;
    const edit = held.meta && PAGE_EDIT_KEYS.has(key.toLowerCase());
    const modifiers = edit
      ? (modifiersOf(held) & ~BROWSER_LIVE_MODIFIER.META) | BROWSER_LIVE_MODIFIER.CONTROL
      : modifiersOf(held);
    const message: InputMessage = {
      type: BROWSER_LIVE_CLIENT.KEY,
      action: KEY_ACTION[input.action],
      key: key.slice(0, 64),
      code: input.code.slice(0, 64),
      keyCode: Math.max(0, Math.min(255, input.keyCode)),
      modifiers,
    };
    live.input(message);
    return true;
  };
  const pasteInput = (text: string) => {
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
  const driver = view.driver?.driver ?? tab.driver;
  const driven = driver !== null;
  // A refusal says why first, then who has the tab.
  const said = view.takeoverRefused
    ? "Only whoever started this agent can drive its tab."
    : view.stepRefused
      ? `${(driver === null ? undefined : memberName(driver.userId)) ?? "A teammate"} is driving this tab. Wait until they hand it back.`
      : standing;
  const isLive = view.phase === CLOUD_BROWSER_PHASE.LIVE;
  return (
    <Fill
      as={FILL_ELEMENT.SECTION}
      className="browser-view cloud-browser-view file-view ph-no-capture"
      aria-label="Browser"
    >
      <CloudBrowserBar
        address={address}
        onStep={isLive ? live.step : undefined}
        onOpen={live.navigate}
        disabled={!isLive}
      />
      <div className="cloud-browser-standing">
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} role="status" truncate>
          {said ?? ""}
        </Text>
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
            disabled={!isLive}
            onClick={live.takeOver}
          >
            Take over
          </Button>
        )}
      </div>
      <Fill clip ref={body} className="browser-view-body cloud-browser-body">
        <div className="cloud-browser-stage" style={{ width: size.width, height: size.height }}>
          <RemoteSurface
            ref={canvas}
            label="The page"
            width={size.width}
            height={size.height}
            driving={yours}
            onPointer={pointerInput}
            onWheel={wheelInput}
            onKey={keyInput}
            onPaste={pasteInput}
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
            <Spinner delay label={notice.label} size={SPINNER_SIZE.REGION} />
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
      </Fill>
    </Fill>
  );
}

/**
 * A draft of a tab in a coding agent's browser: the bar, its address
 * focused and its steps idle, over a line saying where the tab will open.
 * Enter opens it through the service, which may first wake the agent's
 * sandbox, and hands the tab, taken over by the member, to `onOpened`; a
 * refusal stays, said under the bar. Escape discards the draft.
 */
export function CloudBrowserDraftPane({
  taskId,
  draft,
  owner,
  onOpened,
  onDiscard,
}: {
  taskId: string;
  draft: CloudBrowserDraft;
  owner: CloudBrowserOwner;
  onOpened: (tab: AgentBrowserTab) => void;
  onDiscard: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [opening, setOpening] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const open = (address: string) => {
    if (opening) return;
    setOpening(true);
    setRefused(undefined);
    act(ACT_KIND.TASKS_BROWSER_TAB_OPEN, { taskId, agentId: draft.agentId, address }).then(
      (answer) => {
        if ("tab" in answer) {
          noteOpenedCloudTab(taskId, answer.tab);
          onOpened(answer.tab);
          return;
        }
        setOpening(false);
        setRefused(openFailureWords(answer.failure, owner.name));
      },
      () => {
        setOpening(false);
        setRefused(openFailureWords(BROWSER_TAB_OPEN_FAILURE.UNANSWERED, owner.name));
      },
    );
  };
  return (
    <Fill
      as={FILL_ELEMENT.SECTION}
      className="browser-view cloud-browser-view file-view ph-no-capture"
      aria-label="Browser"
    >
      <CloudBrowserBar
        address=""
        onStep={undefined}
        onOpen={open}
        onEscape={onDiscard}
        holdTyped
        autoFocus
        disabled={opening}
      />
      {refused === undefined ? null : (
        <div className="cloud-browser-standing" role="alert">
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {refused}
          </Text>
        </div>
      )}
      <Fill clip className="browser-view-body cloud-browser-body">
        {opening ? (
          <div className="cloud-browser-notice">
            <Spinner label={`Opening in ${browserOf(owner.name)}`} size={SPINNER_SIZE.REGION} />
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              A sandbox that stopped can take a minute to wake.
            </Text>
          </div>
        ) : (
          <div className="cloud-browser-notice">
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              Type an address to open it in {browserOf(owner.name)}. You drive it until you hand it
              back.
            </Text>
          </div>
        )}
      </Fill>
    </Fill>
  );
}
