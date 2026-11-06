import { useAtomValue } from "@effect/atom-react";
import type { AgentBrowserTab, BrowserTabsPlace } from "@repo/features/agent-browser-tab-wire";
import { browserAddressOf, chordIsWindows } from "@repo/features/browser-acts";
import {
  BROWSER_LIVE_CLIENT,
  BROWSER_LIVE_CLOSE_REASON,
  BROWSER_LIVE_HISTORY,
  BROWSER_LIVE_KEY_ACTION,
  BROWSER_LIVE_MODIFIER,
  BROWSER_LIVE_MOUSE_ACTION,
  BROWSER_LIVE_MOUSE_BUTTON,
  type BrowserLiveHistory,
} from "@repo/features/browser-live-wire";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { BROWSER_TAB_OPEN_FAILURE, type BrowserTabOpenFailure } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { surfaceKeepsPress } from "@repo/settings/shortcuts";
import {
  AddressField,
  ANNOUNCE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  FailureNote,
  FILL_ELEMENT,
  Fill,
  IconButton,
  PaneBar,
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
  Tooltip,
  useAnnounce,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useMutation } from "@tanstack/react-query";
import { Clock, Duration, Effect, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  HandIcon,
  MousePointerClickIcon,
  RotateCwIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { actMutation } from "../act-mutations.js";
import { appPlatform } from "../app-platform.js";
import { useCopyToast } from "../copy-feedback.js";
import { useTabActions } from "../desktop/strip-tabs.js";
import { failureShown } from "../failure-report.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { usePhoneRoom } from "../stage-room.js";
import { useAnnounceShown } from "../use-announce-shown.js";
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
import { FILE_VIEW_HISTORY_CLASS } from "./file-view.js";

const STANDING_CLASS =
  "cloud-browser-standing flex min-w-0 flex-none items-center justify-between gap-control-gap border-b border-border px-column-inset py-tight-gap";

const BODY_CLASS = "browser-view-body cloud-browser-body items-center justify-center bg-well";

const NOTICE_CLASS =
  "cloud-browser-notice pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-control-gap *:pointer-events-auto";

const TEXT_PIECE_CHARS = 4_096;

const PAGE_EDIT_KEYS: ReadonlySet<string> = new Set(["a", "c", "x", "z"]);

const RESTING = Atom.make<AsyncResult.AsyncResult<CloudBrowserView>>(AsyncResult.initial());

const BUTTON_OF = [
  BROWSER_LIVE_MOUSE_BUTTON.LEFT,
  BROWSER_LIVE_MOUSE_BUTTON.MIDDLE,
  BROWSER_LIVE_MOUSE_BUTTON.RIGHT,
] as const;

const MOUSE_ACTION = {
  [REMOTE_POINTER_ACTION.DOWN]: BROWSER_LIVE_MOUSE_ACTION.DOWN,
  [REMOTE_POINTER_ACTION.UP]: BROWSER_LIVE_MOUSE_ACTION.UP,
  [REMOTE_POINTER_ACTION.MOVE]: BROWSER_LIVE_MOUSE_ACTION.MOVE,
} as const;

const KEY_ACTION = {
  [REMOTE_KEY_ACTION.DOWN]: BROWSER_LIVE_KEY_ACTION.DOWN,
  [REMOTE_KEY_ACTION.UP]: BROWSER_LIVE_KEY_ACTION.UP,
} as const;

function modifiersOf(held: RemoteModifiers): number {
  return (
    (held.alt ? BROWSER_LIVE_MODIFIER.ALT : 0) |
    (held.control ? BROWSER_LIVE_MODIFIER.CONTROL : 0) |
    (held.meta ? BROWSER_LIVE_MODIFIER.META : 0) |
    (held.shift ? BROWSER_LIVE_MODIFIER.SHIFT : 0)
  );
}

function onVisibilityChange(changed: () => void): () => void {
  document.addEventListener("visibilitychange", changed);
  return () => document.removeEventListener("visibilitychange", changed);
}

function usePageVisible(): boolean {
  return useSyncExternalStore(onVisibilityChange, () => document.visibilityState !== "hidden");
}

function fitted(body: CloudBrowserViewport, aspect: number | undefined): CloudBrowserViewport {
  if (aspect === undefined || body.width < 1 || body.height < 1) return body;
  const width = Math.min(body.width, body.height * aspect);
  return { width: Math.floor(width), height: Math.floor(width / aspect) };
}

export interface CloudBrowserOwner {
  readonly name: string;
  readonly icon: React.JSX.Element;
}

export function browserOf(name: string): string {
  return name.endsWith("s") ? `${name}' browser` : `${name}'s browser`;
}

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
      return `${browserOf(agent)} could not be reached. Try again in a moment.`;
    case BROWSER_TAB_OPEN_FAILURE.UNANSWERED:
      return "The tab could not be opened. Try again.";
  }
}

function CloudBrowserBar({
  address,
  onStep,
  whyOff,
  onOpen,
  onEscape,
  holdTyped = false,
  autoFocus = false,
  disabled = false,
  children,
}: {
  address: string;
  onStep: ((step: BrowserLiveHistory) => void) | undefined;
  whyOff: string;
  onOpen: (address: string) => void;
  onEscape?: (() => void) | undefined;
  holdTyped?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null);
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
  const leave = () => {
    if (onEscape === undefined) {
      setTyped(undefined);
      field.current?.blur();
      return;
    }
    if ((typed ?? address) === "") onEscape();
    else setTyped("");
  };
  const hintOf = (name: string) => (onStep === undefined ? `${name}: ${whyOff}` : name);
  const phone = usePhoneRoom();
  const copyWithToast = useCopyToast();
  useTabActions(
    phone
      ? [
          [
            {
              label: "Back",
              icon: <ArrowLeftIcon aria-hidden="true" />,
              detail: onStep === undefined ? whyOff : undefined,
              disabled: onStep === undefined,
              onSelect: () => onStep?.(BROWSER_LIVE_HISTORY.BACK),
            },
            {
              label: "Forward",
              icon: <ArrowRightIcon aria-hidden="true" />,
              detail: onStep === undefined ? whyOff : undefined,
              disabled: onStep === undefined,
              onSelect: () => onStep?.(BROWSER_LIVE_HISTORY.FORWARD),
            },
            {
              label: "Reload",
              icon: <RotateCwIcon aria-hidden="true" />,
              detail: onStep === undefined ? whyOff : undefined,
              disabled: onStep === undefined,
              onSelect: () => onStep?.(BROWSER_LIVE_HISTORY.RELOAD),
            },
          ],
          address === ""
            ? []
            : [
                {
                  label: "Copy address",
                  icon: <GLYPH.COPY />,
                  onSelect: () => copyWithToast(address, "Address copied"),
                },
                {
                  label: "Open in browser",
                  icon: <GLYPH.OPEN_EXTERNALLY />,
                  onSelect: () => appPlatform().openWeb(address),
                },
              ],
        ].filter((group) => group.length > 0)
      : undefined,
  );
  return (
    <PaneBar
      middle={
        <>
          {phone ? null : (
            <div className={FILE_VIEW_HISTORY_CLASS}>
              <Tooltip label={hintOf("Back")}>
                <IconButton
                  icon={<ArrowLeftIcon aria-hidden="true" />}
                  label="Back"
                  disabled={onStep === undefined}
                  focusableWhenDisabled
                  onClick={() => onStep?.(BROWSER_LIVE_HISTORY.BACK)}
                />
              </Tooltip>
              <Tooltip label={hintOf("Forward")}>
                <IconButton
                  icon={<ArrowRightIcon aria-hidden="true" />}
                  label="Forward"
                  disabled={onStep === undefined}
                  focusableWhenDisabled
                  onClick={() => onStep?.(BROWSER_LIVE_HISTORY.FORWARD)}
                />
              </Tooltip>
              <Tooltip label={hintOf("Reload")}>
                <IconButton
                  icon={<RotateCwIcon aria-hidden="true" />}
                  label="Reload"
                  turns
                  disabled={onStep === undefined}
                  focusableWhenDisabled
                  onClick={() => onStep?.(BROWSER_LIVE_HISTORY.RELOAD)}
                />
              </Tooltip>
            </div>
          )}
          <AddressField
            ref={field}
            value={typed ?? address}
            autoFocus={autoFocus}
            disabled={disabled}
            onChange={setTyped}
            onOpen={go}
            onBlur={holdTyped ? undefined : () => setTyped(undefined)}
            onEscape={leave}
          />
        </>
      }
      actions={children}
    />
  );
}

function agentLately(lastActedAt: number): Stream.Stream<boolean> {
  const span = Duration.toMillis(CLOUD_BROWSER_AGENT_RECENT);
  return Stream.fromEffect(Clock.currentTimeMillis).pipe(
    Stream.flatMap((now) => {
      const left = lastActedAt + span - now;
      if (left <= 0) return Stream.make(false);
      return Stream.make(true).pipe(
        Stream.concat(Stream.fromEffect(Effect.as(Effect.sleep(Duration.millis(left)), false))),
      );
    }),
  );
}

function useAgentLately(lastActedAt: number): boolean {
  const atom = useMemo(() => rendererRuntime.atom(agentLately(lastActedAt)), [lastActedAt]);
  return AsyncResult.getOrElse(
    useAtomValue(atom),
    () => Date.now() - lastActedAt < Duration.toMillis(CLOUD_BROWSER_AGENT_RECENT),
  );
}

function standingOf(input: {
  view: CloudBrowserView;
  tab: AgentBrowserTab;
  owner: CloudBrowserOwner;
  memberName: (userId: string) => string | undefined;
  lately: boolean;
}): string | undefined {
  const { view, tab, owner, memberName, lately } = input;
  const driver = view.driver?.driver ?? tab.driver;
  if (view.driver?.yours === true) return "You're driving";
  if (driver !== null) return `${memberName(driver.userId) ?? "A teammate"} is driving`;
  return lately ? `${owner.name} is using this tab` : undefined;
}

type Notice =
  | { readonly waiting: true; readonly label: string }
  | { readonly waiting: false; readonly words: string };

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

function stepsOffOf(view: CloudBrowserView): string {
  if (view.phase === CLOUD_BROWSER_PHASE.ENDED) {
    return view.ended === BROWSER_LIVE_CLOSE_REASON.GONE
      ? "this tab has closed"
      : "watch again to use it";
  }
  if (view.phase === CLOUD_BROWSER_PHASE.RECONNECTING) return "reconnecting";
  return "the browser is not live yet";
}

function paint(canvas: HTMLCanvasElement | null, image: HTMLImageElement | undefined): void {
  if (canvas === null || image === undefined) return;
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
}

const DARK_PAGE_LUMA = 0.32;

function linearOf(byte: number): number {
  const channel = byte / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

const GROUND_SAMPLE = 8;

const GROUND_INSET = 4;

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

export function CloudBrowserPane({
  tab,
  owner,
  shown,
  memberName,
}: {
  tab: AgentBrowserTab;
  owner: CloudBrowserOwner;
  shown: boolean;
  memberName: (userId: string) => string | undefined;
}): React.JSX.Element {
  const body = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bodySize, setBodySize] = useState<CloudBrowserViewport>({ width: 0, height: 0 });
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  const size = fitted(bodySize, aspect);
  const viewport = useRef<CloudBrowserViewport | undefined>(undefined);
  viewport.current = size.width > 0 && size.height > 0 ? size : undefined;

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

  const visible = usePageVisible();
  const watched = shown && visible;
  const live = useMemo(
    () =>
      cloudBrowserLive({
        open: appPlatform().openBrowserLive,
        target: { agentId: tab.agentId, tabId: tab.id },
        viewport: () => viewport.current,
        onFrame,
      }),
    [tab.agentId, tab.id, onFrame, generation, watched],
  );
  const views = useMemo(
    () => (watched ? rendererRuntime.atom(live.views) : RESTING),
    [live, watched],
  );
  const view = AsyncResult.getOrElse(useAtomValue(views), () => OPENING_VIEW);
  useLayoutEffect(() => {
    const element = body.current;
    if (element === null) return;
    const measure = () => setBodySize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
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
    const keptHere = surfaceKeepsPress({ ctrlKey: held.control, metaKey: held.meta });
    if (!keptHere && chordIsWindows(chord)) return false;
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

  const resumable =
    view.phase === CLOUD_BROWSER_PHASE.ENDED && view.ended === BROWSER_LIVE_CLOSE_REASON.IDLE;
  const notice = noticeOf(view);
  const lately = useAgentLately(tab.lastActedAt);
  const standing = standingOf({ view, tab, owner, memberName, lately });
  const address = view.page?.address ?? tab.address;
  const driver = view.driver?.driver ?? tab.driver;
  const driven = driver !== null;
  const refusal = view.takeoverRefused
    ? "Only whoever started this agent can drive its tab."
    : view.stepRefused
      ? `${(driver === null ? undefined : memberName(driver.userId)) ?? "A teammate"} is driving this tab. Wait until they hand it back.`
      : undefined;
  const said = refusal ?? standing;
  useAnnounce(ANNOUNCE.POLITE, refusal === undefined ? (standing ?? "") : "");
  useAnnounceShown(ANNOUNCE.ALERT, refusal ?? "");
  useAnnounceShown(ANNOUNCE.POLITE, notice?.waiting === false ? notice.words : "");
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
        whyOff={stepsOffOf(view)}
        onOpen={live.navigate}
        disabled={!isLive}
      />
      <div className={STANDING_CLASS}>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} truncate>
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
      <Fill clip ref={body} className={BODY_CLASS}>
        <div className="relative flex-none" style={{ width: size.width, height: size.height }}>
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
          <div className={NOTICE_CLASS}>
            <Spinner delay label={notice.label} size={SPINNER_SIZE.REGION} />
          </div>
        ) : (
          <div className={NOTICE_CLASS}>
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

export function CloudBrowserDraftPane({
  place,
  draft,
  owner,
  onOpened,
  onDiscard,
}: {
  place: BrowserTabsPlace;
  draft: CloudBrowserDraft;
  owner: CloudBrowserOwner;
  onOpened: (tab: AgentBrowserTab) => void;
  onDiscard: () => void;
}): React.JSX.Element {
  const opened = useMutation({
    ...actMutation(ACT_KIND.TASKS_BROWSER_TAB_OPEN),
    onSuccess: (answer) => {
      if (!("tab" in answer)) return;
      noteOpenedCloudTab(place, answer.tab);
      onOpened(answer.tab);
    },
  });
  const answer = opened.data;
  const opening = opened.isPending || (answer !== undefined && "tab" in answer);
  const refused = opened.isError
    ? openFailureWords(BROWSER_TAB_OPEN_FAILURE.UNANSWERED, owner.name)
    : answer !== undefined && "failure" in answer
      ? openFailureWords(answer.failure, owner.name)
      : undefined;
  const open = (address: string) => {
    if (opening) return;
    opened.mutate({ agentId: draft.agentId, address });
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
        whyOff="no page is open yet"
        onOpen={open}
        onEscape={onDiscard}
        holdTyped
        autoFocus
        disabled={opening}
      />
      {refused === undefined ? null : (
        <div className={STANDING_CLASS}>
          <FailureNote
            failure={failureShown({
              surface: FAILURE_SURFACE.BROWSER_OPEN,
              cause: FAILURE_CONDITION.REFUSED,
              refused: true,
            })}
          >
            {refused}
          </FailureNote>
        </div>
      )}
      <Fill clip className={BODY_CLASS}>
        {opening ? (
          <div className={NOTICE_CLASS}>
            <Spinner label={`Opening in ${browserOf(owner.name)}`} size={SPINNER_SIZE.REGION} />
          </div>
        ) : (
          <div className={NOTICE_CLASS}>
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
