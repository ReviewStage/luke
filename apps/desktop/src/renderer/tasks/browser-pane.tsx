import {
  BROWSER_STEP,
  type BrowserBounds,
  type BrowserKey,
  type BrowserPage,
  browserAddressOf,
} from "@luke/features/browser-acts";
import { ACT_KIND } from "@luke/host/acts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  GlobeIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import {
  type FormEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAct } from "../act";
import { EmptyState } from "../empty-state";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { Tooltip } from "../tooltip";
import type { OpenBrowser } from "./use-side-panel";

/**
 * browser-pane.tsx -- one Browser tab in the side panel: a bar to type an address and step the page, and the page itself, a view main lays over the tab's body.
 *
 * The page is any site on the web, so it is drawn in a view main owns
 * (`main/window/browser-views.ts`), never in this window's page, and this
 * pane only says where its body stands. A native view is drawn over the
 * whole window and no DOM can stand over it, so the view is laid over the
 * body only while the body is at rest and uncovered: the panel not sliding,
 * growing, or being dragged wider, and no menu, dialog, card, toast, or
 * tooltip over it, whether drawn over the document's body or from inside
 * the window's root (`coveredAt`). Otherwise a still of the page is caught first and drawn
 * in its place, then the view is put out of sight, so the change cannot be
 * seen and the layer over it reads as standing over the page
 * (`docs/proposals/browser-tab.md` §2). The pane watches for that once a
 * frame while it is drawn, since a pane's motion is played on transforms
 * that no observer hears.
 *
 * What the page shows is the developer's, so the pane, the still among it,
 * is left out of the screen recording (`ph-no-capture`); the recording
 * could not see into the view in any case. A Command chord pressed over the
 * page comes back from main and is pressed on this window, so the window's
 * own chords answer over the page as over any tab, and ⌘L and ⌘R are the
 * pane's: the address, and a reload.
 */

/**
 * The layers drawn from inside the window's root that may stand over the
 * body, by their role or their kind: a menu, a list it offers, a dialog, a
 * tooltip, a popover, and the floating call card. Their boxes are read
 * whole, so a thin one crossing the body's edge is found as surely as a
 * large one.
 */
const IN_ROOT_LAYERS = [
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="tooltip"]',
  ".anchored-popover",
  '.call-card[data-surface="floating"]',
].join(", ");

/** How many points a side the body is hit-tested at each frame, for any other layer drawn over it from inside the window's root. */
const PROBES = 8;

/** Less than this, in square CSS pixels, covers nothing: a visually hidden region's one pixel. */
const NO_AREA = 4;

/** How many frames running the body must stand still and uncovered before the view is laid over it, so a pass of motion is not chased. */
const SETTLED_FRAMES = 2;

/** How each Browser tab's page stands, as main last told this window, kept while the window stands. */
let pages: ReadonlyMap<string, BrowserPage> = new Map();
const listeners = new Set<() => void>();
let unhear: (() => void) | undefined;

/** Keeps how a page stands, and tells every reader. */
function notePage(page: BrowserPage): void {
  pages = new Map(pages).set(page.browserId, page);
  for (const listener of listeners) listener();
}

/** Hears main's word on this window's pages while anything reads them: a Browser tab's pane, or the strip naming its tabs. */
function hearPages(listener: () => void): () => void {
  if (listeners.size === 0) unhear = window.luke.onBrowserState(notePage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    unhear?.();
    unhear = undefined;
  };
}

/** Hears nothing, for a reader with no Browser tab to draw. */
function hearNothing(): () => void {
  return () => undefined;
}

/**
 * How each of this window's Browser tabs' pages stands, by tab, which the
 * strip names its tabs by and the pane draws its bar from; main is heard only
 * while `hearing`, the Browser tab experiment on.
 */
export function useBrowserPages(hearing = true): ReadonlyMap<string, BrowserPage> {
  const read = () => pages;
  // Note that a server render, as a test draws one, reads the pages as they stand too.
  return useSyncExternalStore(hearing ? hearPages : hearNothing, read, read);
}

/** What a Browser tab is called: its page's title, its address's host until it has one, and none before a page is opened. */
export function browserTitleOf(page: BrowserPage | undefined): string | undefined {
  if (page === undefined) return undefined;
  if (page.title.length > 0) return page.title;
  return URL.canParse(page.address) ? new URL(page.address).host || undefined : undefined;
}

/** Whether two boxes share any of their area. */
function overlaps(layer: DOMRect, body: DOMRect): boolean {
  if (layer.width * layer.height < NO_AREA) return false;
  return (
    layer.left < body.right &&
    layer.right > body.left &&
    layer.top < body.bottom &&
    layer.bottom > body.top
  );
}

/**
 * Whether any layer stands over the body: a portal drawn over
 * `document.body`, or a menu, dialog, tooltip, popover, or floating card
 * drawn from inside the window's root (`IN_ROOT_LAYERS`), wherever its box
 * meets the body's, since some take no pointer; or, at any of a grid of
 * points over the body, anything else drawn above it, which the hit test
 * finds topmost there.
 */
function coveredAt(element: Element, body: DOMRect): boolean {
  const root = document.getElementById("root");
  const portals = [...document.body.children].filter(
    (each) => each !== root && each.tagName !== "SCRIPT",
  );
  const layers = [...document.querySelectorAll(IN_ROOT_LAYERS)].filter(
    (each) => !element.contains(each),
  );
  const boxes = [...portals, ...layers].map((each) => each.getBoundingClientRect());
  if (boxes.some((box) => overlaps(box, body))) return true;
  for (let row = 0; row < PROBES; row += 1) {
    for (let column = 0; column < PROBES; column += 1) {
      const x = body.left + ((column + 0.5) * body.width) / PROBES;
      const y = body.top + ((row + 0.5) * body.height) / PROBES;
      const topmost = document.elementFromPoint(x, y);
      if (topmost !== null && !element.contains(topmost)) return true;
    }
  }
  return false;
}

/** Whether two boxes stand in the same place at the same size, to the pixel. */
function sameBox(a: DOMRect | undefined, b: DOMRect): boolean {
  return (
    a !== undefined &&
    Math.round(a.x) === Math.round(b.x) &&
    Math.round(a.y) === Math.round(b.y) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height)
  );
}

/** A box on the window as main places a view, in whole CSS pixels. */
function boundsOf(box: DOMRect): BrowserBounds {
  return {
    x: Math.max(0, Math.round(box.x)),
    y: Math.max(0, Math.round(box.y)),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

/**
 * Lays the tab's view over `body` while it may stand there, and draws a
 * still in its place otherwise, as the pane's design says; answers the
 * still, none while the view stands. `wanted` is whether the view may stand
 * at all: a page opened that has not failed, its panel on screen.
 */
function useViewPlacing(
  browserId: string,
  body: RefObject<HTMLDivElement | null>,
  wanted: boolean,
): string | undefined {
  const { act, tell } = useAct();
  const [still, setStill] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!wanted) return;
    let frame = 0;
    // The frame the view goes out of sight on, once its still is painted.
    let hiding = 0;
    // Note that a capture answering after the effect ended changes nothing,
    // because a newer effect may have laid the same view over its body since.
    let ended = false;
    let last: DOMRect | undefined;
    let settled = 0;
    let live = false;
    let leaving = false;
    const step = () => {
      frame = requestAnimationFrame(step);
      const element = body.current;
      if (element === null || leaving) return;
      const box = element.getBoundingClientRect();
      const moving =
        !sameBox(last, box) || (element.closest(".side-panel")?.getAnimations().length ?? 0) > 0;
      last = box;
      const free = !moving && box.width > 0 && box.height > 0 && !coveredAt(element, box);
      settled = free ? settled + 1 : 0;
      if (settled === SETTLED_FRAMES && !live) {
        live = true;
        tell(ACT_KIND.BROWSER_PLACE, { browserId, bounds: boundsOf(box) });
        return;
      }
      if (free || !live) return;
      // The still is drawn under the view first, then the view goes, a frame after it is painted.
      live = false;
      leaving = true;
      void act(ACT_KIND.BROWSER_CAPTURE, { browserId })
        .catch(() => null)
        .then((caught) => {
          if (ended) return;
          if (caught !== null) setStill(caught);
          hiding = requestAnimationFrame(() => {
            hiding = requestAnimationFrame(() => {
              tell(ACT_KIND.BROWSER_PLACE, { browserId, bounds: null });
              leaving = false;
              settled = 0;
            });
          });
        });
    };
    frame = requestAnimationFrame(step);
    return () => {
      ended = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(hiding);
      tell(ACT_KIND.BROWSER_PLACE, { browserId, bounds: null });
    };
  }, [browserId, body, wanted, act, tell]);
  return still;
}

/** Presses on this window a Command chord pressed over the tab's page, so its keymap answers it as over any tab. */
function pressHere(key: BrowserKey): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: key.key,
      code: key.code,
      metaKey: true,
      shiftKey: key.shift,
      altKey: key.alt,
      ctrlKey: key.control,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** One of the bar's steps: a press of its glyph, which says what it does. */
function BarStep({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: React.JSX.Element;
  disabled?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        disabled={disabled}
        onClick={onPress}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

/**
 * A Browser tab: its bar, then its page, or what stands in its place: a
 * line asking for an address before one is opened, and why the page failed
 * with a retry once it has. `shown` is whether the panel is on screen and
 * staying, which the view stands over the body under alone.
 */
export function BrowserPane({
  open,
  shown,
  onOpened,
}: {
  open: OpenBrowser;
  shown: boolean;
  /** Says the tab's page was opened at the address, which the tab opens its view on again when it is drawn again. */
  onOpened: (address: string) => void;
}): React.JSX.Element {
  const { act, tell } = useAct();
  const browserId = open.tab.browser;
  const page = useBrowserPages().get(browserId);
  const body = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // What the bar holds while it is being typed into, none while it shows the page's address.
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const [opened, setOpened] = useState(false);
  const [refused, setRefused] = useState(false);
  const failed = page?.failure !== undefined && !page.loading;
  const still = useViewPlacing(browserId, body, opened && shown && !failed);

  /** Opens the tab's view on the address, or answers how a view opened already stands. */
  const openAt = useCallback(
    (address: string) => {
      setRefused(false);
      act(ACT_KIND.BROWSER_OPEN, { browserId, address }).then(
        (answer) => {
          notePage(answer);
          setOpened(true);
        },
        () => setRefused(true),
      );
    },
    [act, browserId],
  );
  // A tab drawn again opens its view where it stood, which main answers as it stands.
  useEffect(() => {
    if (open.address === undefined) field.current?.focus();
    else openAt(open.address);
  }, [open.address, openAt]);
  // ⌘L and ⌘R pressed here, or over the page and handed back, are the pane's.
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === "l") {
        event.preventDefault();
        field.current?.focus();
        field.current?.select();
      } else if (key === "r" && opened) {
        event.preventDefault();
        tell(ACT_KIND.BROWSER_STEP, { browserId, step: BROWSER_STEP.RELOAD });
      }
    };
    window.addEventListener("keydown", keys);
    const unhear = window.luke.onBrowserKey((key) => {
      if (key.browserId === browserId) pressHere(key);
    });
    return () => {
      window.removeEventListener("keydown", keys);
      unhear();
    };
  }, [browserId, opened, tell]);

  const go = (event: FormEvent) => {
    event.preventDefault();
    const address = browserAddressOf(typed ?? "");
    if (address === undefined) return;
    setTyped(undefined);
    field.current?.blur();
    if (!opened) {
      openAt(address);
      onOpened(address);
      return;
    }
    tell(ACT_KIND.BROWSER_NAVIGATE, { browserId, address });
  };
  const stepTo = (step: (typeof BROWSER_STEP)[keyof typeof BROWSER_STEP]) =>
    tell(ACT_KIND.BROWSER_STEP, { browserId, step });
  const address = page?.address ?? open.address ?? "";
  const loading = page?.loading === true;
  return (
    <section className="browser-view file-view ph-no-capture" aria-label="Browser">
      <header className="file-view-bar browser-view-bar">
        <div className="file-view-history">
          <BarStep
            label="Back"
            icon={<ArrowLeftIcon aria-hidden="true" />}
            disabled={page?.back !== true}
            onPress={() => stepTo(BROWSER_STEP.BACK)}
          />
          <BarStep
            label="Forward"
            icon={<ArrowRightIcon aria-hidden="true" />}
            disabled={page?.forward !== true}
            onPress={() => stepTo(BROWSER_STEP.FORWARD)}
          />
          <BarStep
            label={loading ? "Stop" : "Reload"}
            icon={loading ? <XIcon aria-hidden="true" /> : <RotateCwIcon aria-hidden="true" />}
            disabled={!opened}
            onPress={() => stepTo(loading ? BROWSER_STEP.STOP : BROWSER_STEP.RELOAD)}
          />
        </div>
        <form className="browser-view-address" onSubmit={go}>
          <input
            ref={field}
            type="text"
            aria-label="Address"
            placeholder="Search or type an address, like localhost:3000"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={typed ?? address}
            onChange={(event) => setTyped(event.target.value)}
            onFocus={(event) => event.target.select()}
            onBlur={() => setTyped(undefined)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              setTyped(undefined);
              event.currentTarget.blur();
            }}
          />
        </form>
        <div className="file-view-actions">
          <BarStep
            label="Open in your browser"
            icon={<ExternalLinkIcon aria-hidden="true" />}
            disabled={!opened || address.length === 0}
            onPress={() => tell(ACT_KIND.WEB_OPEN, { url: address })}
          />
        </div>
      </header>
      <div ref={body} className="browser-view-body">
        {!opened && !refused ? (
          <EmptyState icon={<GlobeIcon />}>
            Type an address above. Your own dev server works too, like localhost:3000.
          </EmptyState>
        ) : refused ? (
          <div className="side-panel-empty">
            <ReadFailure
              line="The page could not be opened."
              onRetry={() => openAt(browserAddressOf(address) ?? address)}
              place={READ_FAILURE_PLACE.CENTRED}
            />
          </div>
        ) : failed ? (
          <div className="side-panel-empty">
            <ReadFailure
              line={`The page could not be shown: ${page?.failure ?? ""}`}
              onRetry={() => stepTo(BROWSER_STEP.RELOAD)}
              place={READ_FAILURE_PLACE.CENTRED}
            />
          </div>
        ) : still === undefined ? null : (
          <img className="browser-view-still" src={still} alt="" />
        )}
      </div>
    </section>
  );
}
