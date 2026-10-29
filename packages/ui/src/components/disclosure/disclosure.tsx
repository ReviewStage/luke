import {
  type ComponentPropsWithoutRef,
  createContext,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../../cn.js";
import { FoldChevronIcon } from "../../face/glyphs.js";
import { PRESS_PULSE, type PressPulse, pulsePress } from "../../press-pulse.js";
import { type DisclosureMotion, disclosureMotion, useDisclosure } from "../../use-disclosure.js";

/**
 * disclosure.tsx -- a fold: a `details` whose open state is React's, so a closed body is not drawn at all.
 *
 * The platform's own `details` lands at once and opens and closes from the
 * keyboard. The state is held here rather than left to the element, for one
 * reason: a transcript holds hundreds of folds, and a body drawn only once
 * its line is opened keeps the closed ones out of the layout entirely. The
 * summary takes the click itself and stops the element's own toggle, so the
 * two cannot disagree, and says whether it is open in `aria-expanded`.
 *
 * A fold whose open state outlives it, as a tab keeps which of its cards it
 * folded, is controlled: it is handed `open` and hears `onOpenChange`, a
 * press and a find's toggle alike, and is open as its holder says.
 *
 * A press moves the fold, and nothing else does. The layout lands at once
 * either way; a press that opens marks the element `data-disclosure` as
 * opening, which unrolls the body as it fades in (disclosure.css), and a
 * press that closes holds the body drawn through its fade
 * (`use-disclosure.ts`). For the moment it moves, the body's height is
 * published on the element as `--disclosure-rise`, which is how a fold
 * whose line travels as it opens tells its stylesheet how far. A fold drawn
 * open from the start, or drawn again, replays nothing.
 *
 * While an app's find looks through what holds the fold (`DisclosureFind`),
 * a closed body is drawn after all, still hidden inside its closed `details`
 * as the platform hides one, so the find covers what the fold holds; a find
 * that shows a match there opens the element, and the fold follows the
 * element's own toggle, so its state is the element's again at once.
 *
 * `Disclosure` draws the quiet summary row: a chevron, then the caller's
 * glyph and words, muted until the pointer is over it. Drawn as a card
 * (`DISCLOSURE_LOOK.CARD`), as what a transcript opens on is, it stands on
 * the hover's wash inside a hairline, its head the one line a closed card
 * shows (`DISCLOSURE_SUMMARY.HEAD`) and its body under a hairline
 * (`DISCLOSURE_BODY.CARD`). A surface that skins its fold its own way
 * builds on `useDisclosureFold` and `DisclosureScope` instead, so the state
 * and the motion live here once.
 *
 * No control stands inside a summary, because a summary is the button that
 * opens its fold, and what it holds is that button's name: a ⋯ inside it
 * would be read as part of the row's name and pressed as part of the row. A
 * fold's head that holds controls of its own, a row's ⋯ or a file's path
 * that copies itself, stands them beside its summary instead: `Disclosure`'s
 * `lead` and `actions`, or `DisclosureFrame` around a fold skinned its own
 * way, which lays them in the summary's row outside the `details`.
 */

/** Where an open body stands: under the summary's words, past its chevron, flush with the row, inset under a card's head and the hairline below it, or wherever the caller's own skin inside it sets it. */
export const DISCLOSURE_BODY = {
  INDENTED: "indented",
  FLUSH: "flush",
  CARD: "card",
  NONE: "none",
} as const;
export type DisclosureBodyInset = (typeof DISCLOSURE_BODY)[keyof typeof DISCLOSURE_BODY];

/** A fold's state, as its summary, chevron, and body read it. */
export interface DisclosureState {
  /** Whether it is open, as its line says. */
  readonly open: boolean;
  /** Whether its body is drawn: open, or closed and still fading. */
  readonly drawn: boolean;
  /** Whether its body is fading out, out of reach of the keys and the pointer. */
  readonly leaving: boolean;
  readonly toggle: () => void;
  /** The ref for the body, whose fade the fold waits on. */
  readonly body: (element: HTMLElement | null) => void;
}

/** What `useDisclosureFold` hands the `details` element it is drawn on. */
export interface DisclosureDetailsProps {
  readonly ref: (element: HTMLDetailsElement | null) => void;
  readonly open: boolean;
  readonly "data-disclosure": DisclosureMotion | undefined;
  readonly onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => void;
}

/** A fold whose open state its holder keeps: open as it says, and told of every press and toggle. */
export interface DisclosureControl {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** A fold's state, and the props for the `details` it is drawn on. */
export interface DisclosureFold {
  readonly state: DisclosureState;
  readonly details: DisclosureDetailsProps;
}

const FindContext = createContext(false);

/** The cells a frame stands beside the fold it holds: which of its ends hold controls. */
interface FrameCells {
  readonly lead: boolean;
  readonly actions: boolean;
}

/**
 * The frame around the fold a scope opens, read by that fold's own summary.
 * Note that a scope hands it on to its own parts alone and none to the folds
 * nested in its body, as the sheet's `frame > details > summary` reached only
 * the summary of the fold the frame lays out.
 */
const FrameContext = createContext<FrameCells | undefined>(undefined);
const ScopeFrameContext = createContext<FrameCells | undefined>(undefined);

/** What a controlled fold whose holder hears nothing does with a press. */
const NO_CHANGE = (): void => undefined;
const StateContext = createContext<DisclosureState | undefined>(undefined);

/** The fold around the caller. */
export function useDisclosureState(): DisclosureState {
  const state = useContext(StateContext);
  if (state === undefined) throw new Error("A disclosure's parts must be drawn inside one");
  return state;
}

/**
 * Whether the fold around the caller draws its body: open, on its way out,
 * or a find looking through it. Note that a summary previewing its body asks
 * this rather than whether the fold is open, because the body a find draws
 * hidden says the same words, and a find counting both would open the fold
 * onto a match in the preview that opening it takes away.
 */
export function useDisclosureBodyDrawn(): boolean {
  const { drawn } = useDisclosureState();
  const finding = useContext(FindContext);
  return drawn || finding;
}

/**
 * Whether a summary's preview of its body shows: always where the body does
 * not say it, as a command's description, and otherwise only while the body
 * is not drawn (`useDisclosureBodyDrawn`), so an opened fold never says the
 * same words twice. Note that the preview lands and leaves at once, because
 * words that faded would move the line's cut while the body opens under it.
 */
export function useDisclosurePreviewShown(inBody: boolean): boolean {
  const drawn = useDisclosureBodyDrawn();
  return !(inBody && drawn);
}

/**
 * A fold's state and the props for the `details` it is drawn on, for a
 * surface that draws its own summary and body inside `DisclosureScope`;
 * open as `control` says where its holder keeps it.
 */
export function useDisclosureFold(
  defaultOpen: boolean,
  control?: DisclosureControl | undefined,
): DisclosureFold {
  const [kept, setKept] = useState(defaultOpen);
  const open = control === undefined ? kept : control.open;
  const setOpen = (next: boolean) => {
    if (control === undefined) setKept(next);
    else control.onOpenChange(next);
  };
  // Whether the open state is a press's, which alone plays the opening.
  const [pressed, setPressed] = useState(false);
  const shown = useDisclosure(open);
  const root = useRef<HTMLDetailsElement | null>(null);
  const held = useRef<HTMLElement | null>(null);
  const shownRef = shown.ref;
  const body = useCallback(
    (element: HTMLElement | null) => {
      held.current = element;
      shownRef(element);
    },
    [shownRef],
  );
  const details = useCallback((element: HTMLDetailsElement | null) => {
    root.current = element;
  }, []);
  // Note that no motion plays while a find looks through, because a body
  // held open through its fade would be closed over the match a find showed
  // there, which opens only a `details` that is closed.
  const finding = useContext(FindContext);
  const motion = finding ? undefined : disclosureMotion(open && pressed, shown.leaving);
  // Note that this runs before the frame the press is drawn on, so the rise
  // is there for the first frame of any motion that reads it.
  useLayoutEffect(() => {
    if (motion === undefined || held.current === null) return;
    root.current?.style.setProperty("--disclosure-rise", `${held.current.offsetHeight}px`);
  }, [motion]);
  return {
    state: {
      open,
      drawn: shown.mounted,
      leaving: shown.leaving,
      toggle: () => {
        setPressed(true);
        setOpen(!open);
      },
      body,
    },
    details: {
      ref: details,
      open: shown.mounted,
      "data-disclosure": motion,
      onToggle: (event) => {
        // Note that the element's own toggle, a find's among them, lands at once.
        if (event.currentTarget.open === shown.mounted) return;
        setPressed(false);
        setOpen(event.currentTarget.open);
      },
    },
  };
}

/** Hands the fold's state to the summary, chevron, and body drawn inside it. */
export function DisclosureScope({
  state,
  children,
}: {
  state: DisclosureState;
  children: ReactNode;
}): React.JSX.Element {
  const frame = useContext(FrameContext);
  return (
    <StateContext.Provider value={state}>
      <ScopeFrameContext.Provider value={frame}>
        <FrameContext.Provider value={undefined}>{children}</FrameContext.Provider>
      </ScopeFrameContext.Provider>
    </StateContext.Provider>
  );
}

/**
 * Says whether an app's find looks through what it holds: every fold inside
 * draws its closed body, hidden, while `finding`, so the find covers it.
 */
export function DisclosureFind({
  finding,
  children,
}: {
  finding: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return <FindContext.Provider value={finding}>{children}</FindContext.Provider>;
}

/** Whether an app's find looks through what holds the caller. */
export function useDisclosureFinding(): boolean {
  return useContext(FindContext);
}

/**
 * The summary's click, routed to the fold's state, answered with `pulse`.
 * Note that the element's own toggle is stopped, because the open state is
 * React's.
 */
export function useDisclosureSummaryClick(
  pulse: PressPulse = PRESS_PULSE.QUIET,
): (event: MouseEvent<HTMLElement>) => void {
  const { toggle } = useDisclosureState();
  return (event) => {
    event.preventDefault();
    pulsePress(event.currentTarget, pulse);
    toggle();
  };
}

/**
 * Note that a fold meant to start open says `defaultOpen`, and one whose
 * holder keeps its state says `open` and hears `onOpenChange`, because the
 * element's own `open` is drawn from the fold's state rather than set.
 */
/** How a fold stands: bare among its lines, or as a card, on the hover's wash inside a hairline, clipped at its corner. */
export const DISCLOSURE_LOOK = {
  PLAIN: "plain",
  CARD: "card",
} as const;
export type DisclosureLook = (typeof DISCLOSURE_LOOK)[keyof typeof DISCLOSURE_LOOK];

type DisclosureProps = {
  look?: DisclosureLook;
  defaultOpen?: boolean;
  /** Whether it is open, where its holder keeps that; `onOpenChange` hears each press and toggle. */
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** Controls standing before its summary, beside it rather than in it (`DisclosureFrame`). */
  lead?: ReactNode;
  /** Controls standing after its summary, beside it rather than in it, such as a row's ⋯. */
  actions?: ReactNode;
  /** Which part of a head with controls takes the room its row leaves. */
  fill?: DisclosureFill;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"details">, "open" | "className" | "style" | "children">;

/** A fold drawn as the quiet summary row and its body, and the controls its head holds beside its summary. */
export function Disclosure({
  look = DISCLOSURE_LOOK.PLAIN,
  defaultOpen = false,
  open,
  onOpenChange,
  lead,
  actions,
  fill,
  onToggle,
  children,
  ...props
}: DisclosureProps): React.JSX.Element {
  const { state, details } = useDisclosureFold(
    defaultOpen,
    open === undefined ? undefined : { open, onOpenChange: onOpenChange ?? NO_CHANGE },
  );
  const skin = look === DISCLOSURE_LOOK.PLAIN ? undefined : look;
  const framed = lead !== undefined || actions !== undefined;
  const fold = (
    <DisclosureScope state={state}>
      <details
        {...props}
        {...details}
        className="luke-disclosure min-w-0"
        data-look={framed ? undefined : skin}
        onToggle={(event) => {
          details.onToggle(event);
          onToggle?.(event);
        }}
      >
        {children}
      </details>
    </DisclosureScope>
  );
  if (!framed) return fold;
  // Note that a card's hairline and wash go round the frame, so the controls beside its head stand inside the card.
  return (
    <Frame look={skin} lead={lead} actions={actions} fill={fill}>
      {fold}
    </Frame>
  );
}

/**
 * How a summary is drawn: the quiet row with its chevron; the file row, whose
 * own controls stand in it and which a rule closes under while the fold is
 * open; a chip at the end of its row, on the surface inside a hairline,
 * saying in its glyphs and a count what it folds (a line's review threads);
 * a card's head, the one line a closed card shows, in its holder's ink,
 * finger-tall on a coarse pointer; or a transcript's line, bare of all of
 * these, which the skin the fold holding it wears lays out and draws (a
 * review note's head, a pull request's section heading).
 */
export const DISCLOSURE_SUMMARY = {
  QUIET: "quiet",
  ROW: "row",
  CHIP: "chip",
  HEAD: "head",
  TRANSCRIPT: "transcript",
} as const;
export type DisclosureSummaryLook = (typeof DISCLOSURE_SUMMARY)[keyof typeof DISCLOSURE_SUMMARY];

/**
 * The quiet row every summary but a transcript's is drawn from: a control
 * tall, its chevron, glyph, and words a glyph's gap apart in the caption's
 * type, muted until the pointer is over it, its words wrapping rather than
 * running past a narrow pane, an unbroken name among them, pressed as a
 * Mac's list is on the desktop, without the web's pointing hand. Note that
 * the fill answers `:hover` itself, as the row did, rather than Tailwind's
 * `hover:`, which only a fine pointer reaches.
 */
const SUMMARY_ROW =
  "flex min-h-control cursor-press list-none items-center gap-icon-gap rounded-control ps-luke-4 pe-luke-4 font-sans text-caption text-muted-foreground transition-[background-color,color] duration-(--luke-duration-hover) ease-plain select-none [&::-webkit-details-marker]:hidden [&:hover]:bg-fill-strong [&:hover]:text-foreground [&>:not(svg,.luke-disclosure-turn)]:min-w-0 [&>:not(svg,.luke-disclosure-turn)]:[overflow-wrap:anywhere] [&>svg]:size-control-icon [&>svg]:flex-none";

/** Each look's classes over the quiet row's, a transcript's in place of them. */
const SUMMARY_LOOK = {
  [DISCLOSURE_SUMMARY.QUIET]: SUMMARY_ROW,
  // The file row: the text's own ink, a fixed height, and a rule under it while its fold is open.
  [DISCLOSURE_SUMMARY.ROW]: cn(
    SUMMARY_ROW,
    "box-border h-disclosure-row min-h-disclosure-row gap-luke-8 rounded-none pe-luke-12 whitespace-nowrap text-foreground",
  ),
  // A chip at the end of its row, as wide as what it says, on the surface inside a hairline.
  [DISCLOSURE_SUMMARY.CHIP]: cn(
    SUMMARY_ROW,
    "ms-auto w-fit min-h-0 border border-border bg-surface py-luke-2 ps-luke-6 pe-luke-6 [&:hover]:bg-surface [&>svg]:size-luke-12",
  ),
  // A card's head: a 32px line in the card's own ink, inset as its body is, its corners the card's clip; a finger's press is 44px tall.
  [DISCLOSURE_SUMMARY.HEAD]: cn(
    SUMMARY_ROW,
    "h-luke-32 min-h-0 rounded-none ps-luke-12 pe-luke-12 text-inherit pointer-coarse:h-auto pointer-coarse:min-h-touch",
  ),
  // A transcript's line: only what makes it a summary pressed as a row is, no marker, no list's bullet, no selection, the platform's arrow; the rest is its fold's skin.
  [DISCLOSURE_SUMMARY.TRANSCRIPT]:
    "cursor-default list-none select-none [&::-webkit-details-marker]:hidden [&>svg]:size-control-icon [&>svg]:flex-none",
} as const satisfies Record<DisclosureSummaryLook, string>;

/**
 * A summary's classes, trimmed where a frame lays it out: the row's inset at
 * an end goes to the cell standing there, the frame wears the row's fill
 * under the pointer (`disclosure.css`), and the rule under an open file row
 * is the frame's too.
 */
function summaryClass(
  look: DisclosureSummaryLook,
  frame: FrameCells | undefined,
  open: boolean,
): string {
  const own = SUMMARY_LOOK[look];
  const ruled = look === DISCLOSURE_SUMMARY.ROW && open && frame === undefined;
  if (frame === undefined || look === DISCLOSURE_SUMMARY.TRANSCRIPT) {
    return cn("luke-disclosure-summary", own, ruled && "border-b border-border");
  }
  return cn(
    "luke-disclosure-summary",
    own,
    "[&:hover]:bg-transparent",
    frame.lead && "ps-0",
    frame.actions && "pe-0",
  );
}

type DisclosureSummaryProps = {
  /** `ROW` draws no chevron of its own, since the row holds its fold control; it also stays out of the tab order, since that control is the keyboard's. `CHIP` draws none either, its glyphs saying what it folds, and `HEAD` and `TRANSCRIPT` leave their `DisclosureChevron` to the caller, wherever its line holds it. */
  look?: DisclosureSummaryLook;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"summary">, "className" | "style" | "children" | "aria-expanded">;

/** The one line a closed fold shows, which opens and closes it: the chevron, then the caller's glyph and words; a press is heard by the caller, a hint's, before it folds. */
export function DisclosureSummary({
  look = DISCLOSURE_SUMMARY.QUIET,
  onClick,
  children,
  ...props
}: DisclosureSummaryProps): React.JSX.Element {
  const { open } = useDisclosureState();
  const frame = useContext(ScopeFrameContext);
  // Note that a card's head and a file row meet the frame around them, so
  // their press moves what they hold and leaves their fill standing.
  const toggle = useDisclosureSummaryClick(
    look === DISCLOSURE_SUMMARY.HEAD || look === DISCLOSURE_SUMMARY.ROW
      ? PRESS_PULSE.FLUSH
      : PRESS_PULSE.QUIET,
  );
  const click = (event: MouseEvent<HTMLElement>) => {
    onClick?.(event);
    toggle(event);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a summary is the platform's own disclosure control, focusable and opened by Enter and Space; the click it already takes is routed to React's state.
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: a summary is exposed as its details' disclosure button, which takes aria-expanded; the rule's table gives the element no role.
    <summary
      {...props}
      className={summaryClass(look, frame, open)}
      data-look={look === DISCLOSURE_SUMMARY.QUIET ? undefined : look}
      tabIndex={look === DISCLOSURE_SUMMARY.ROW ? -1 : props.tabIndex}
      aria-expanded={open}
      onClick={click}
    >
      {look === DISCLOSURE_SUMMARY.QUIET ? <DisclosureChevron /> : null}
      {children}
    </summary>
  );
}

/**
 * Which part of a head with controls takes the room its row leaves: the
 * summary, its controls standing at the row's ends; or the controls after
 * it, the summary as wide as what it says, as a file's row runs its path
 * and counts on past its letter.
 */
export const DISCLOSURE_FILL = {
  SUMMARY: "summary",
  ACTIONS: "actions",
} as const;
export type DisclosureFill = (typeof DISCLOSURE_FILL)[keyof typeof DISCLOSURE_FILL];

/** What a press already does for itself: a link, a button, a field, a label, or anything that takes the focus. */
const OWN_PRESS =
  'a[href], area[href], button, input, label, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [tabindex]';

/**
 * A press on a frame's cell, which folds the fold where it lands on the
 * cell's bare ground, the row's room beside its controls, as a press on the
 * summary does, and is the control's alone where it lands on one. Note that
 * a press inside a menu a control drew elsewhere still bubbles here through
 * React's tree, so only a press inside the cell's own box folds.
 */
function groundPress(event: MouseEvent<HTMLElement>): void {
  const cell = event.currentTarget;
  const target = event.target;
  if (!(target instanceof Element) || !cell.contains(target)) return;
  const own = target.closest(OWN_PRESS);
  if (own !== null && cell.contains(own)) return;
  cell.parentElement?.querySelector<HTMLElement>(":scope > details > summary")?.click();
}

function Frame({
  look,
  lead,
  actions,
  fill = DISCLOSURE_FILL.SUMMARY,
  onPointerDown,
  children,
}: {
  look?: DisclosureLook | undefined;
  lead?: ReactNode;
  actions?: ReactNode;
  fill?: DisclosureFill | undefined;
  onPointerDown?: ((event: PointerEvent<HTMLElement>) => void) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const cells = { lead: lead !== undefined, actions: actions !== undefined };
  return (
    <div
      className="luke-disclosure-frame"
      data-look={look}
      data-fill={fill === DISCLOSURE_FILL.SUMMARY ? undefined : fill}
      onPointerDown={onPointerDown}
    >
      {lead === undefined ? null : (
        // biome-ignore lint/a11y/noStaticElementInteractions: the cell's bare ground folds as the summary beside it does, for the pointer alone; the summary is the keyboard's.
        // biome-ignore lint/a11y/useKeyWithClickEvents: a key on a control inside reaches it as a click, which the cell leaves to the control.
        <div className="luke-disclosure-lead" onClick={groundPress}>
          {lead}
        </div>
      )}
      <FrameContext.Provider value={cells}>{children}</FrameContext.Provider>
      {actions === undefined ? null : (
        // biome-ignore lint/a11y/noStaticElementInteractions: the cell's bare ground folds as the summary beside it does, for the pointer alone; the summary is the keyboard's.
        // biome-ignore lint/a11y/useKeyWithClickEvents: a key on a control inside reaches it as a click, which the cell leaves to the control.
        <div className="luke-disclosure-actions" onClick={groundPress}>
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * A fold's head with controls of its own, around a fold a surface skins
 * its own way (`useDisclosureFold`): the controls before its summary
 * (`lead`) and after it (`actions`) stand in the summary's row, each in a
 * cell of its own beside the summary rather than inside it, so a control's
 * words never join the summary's name and a press on one never folds. A
 * press on a cell's bare ground folds as the summary does. Note that the
 * cells stand outside the `details`, because a closed one draws nothing but
 * its summary, and that the `details` is laid into the frame's row by
 * subgrid (disclosure.css), its body under all three. `onPointerDown` hears
 * a press land anywhere in the frame, a control's among them.
 */
export function DisclosureFrame({
  lead,
  actions,
  fill,
  onPointerDown,
  children,
}: {
  lead?: ReactNode;
  actions?: ReactNode;
  fill?: DisclosureFill;
  onPointerDown?: ((event: PointerEvent<HTMLElement>) => void) | undefined;
  /** The fold: its `details`, drawn by `Disclosure` or a skin of its own. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Frame lead={lead} actions={actions} fill={fill} onPointerDown={onPointerDown}>
      {children}
    </Frame>
  );
}

/**
 * The chevron, turned down while its own fold is open. Note that it reads its
 * fold's state rather than the `details` element's through a selector,
 * because folds nest, and an ancestor's open would turn every chevron inside it.
 */
export function DisclosureChevron(): React.JSX.Element {
  const { open } = useDisclosureState();
  return (
    <span className="luke-disclosure-turn" data-open={open}>
      <FoldChevronIcon />
    </span>
  );
}

/**
 * Where each inset stands an open body: past the chevron, at the
 * transcript's own indent, a row's own glyph and inset carrying its words the
 * rest of the way under the summary's; flush with the row; or under a card's
 * head, past the hairline under it, at the head's inset. Its landing and
 * leaving stay in `disclosure.css`, keyframes being what a utility cannot say.
 */
const BODY_INSET = {
  [DISCLOSURE_BODY.INDENTED]: "flex flex-col gap-luke-4 pt-luke-4 ml-luke-24",
  [DISCLOSURE_BODY.FLUSH]: "flex flex-col gap-luke-4 p-luke-4",
  [DISCLOSURE_BODY.CARD]: "border-t border-border px-list-inset py-row-inset",
  [DISCLOSURE_BODY.NONE]: undefined,
} as const satisfies Record<DisclosureBodyInset, string | undefined>;

/** What the fold holds, drawn only while it is open, on its way out, or a find is looking through it. */
export function DisclosureBody({
  inset = DISCLOSURE_BODY.INDENTED,
  children,
}: {
  inset?: DisclosureBodyInset;
  children: ReactNode;
}): React.JSX.Element | null {
  const { body, leaving } = useDisclosureState();
  const drawn = useDisclosureBodyDrawn();
  if (!drawn) return null;
  return (
    <div
      ref={body}
      className={cn("luke-disclosure-body", BODY_INSET[inset])}
      data-inset={inset}
      inert={leaving}
    >
      {children}
    </div>
  );
}
