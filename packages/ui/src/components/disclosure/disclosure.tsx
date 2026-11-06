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
import { type DisclosureMotion, disclosureMotion, useDisclosure } from "../../use-disclosure.js";
import { useListMotionReplay } from "../list-motion/list-motion.js";

export const DISCLOSURE_BODY = {
  INDENTED: "indented",
  FLUSH: "flush",
  CARD: "card",
  NONE: "none",
} as const;
export type DisclosureBodyInset = (typeof DISCLOSURE_BODY)[keyof typeof DISCLOSURE_BODY];

export interface DisclosureState {
  readonly open: boolean;
  readonly drawn: boolean;
  readonly leaving: boolean;
  readonly toggle: () => void;
  readonly body: (element: HTMLElement | null) => void;
}

export interface DisclosureDetailsProps {
  readonly ref: (element: HTMLDetailsElement | null) => void;
  readonly open: boolean;
  readonly "data-disclosure": DisclosureMotion | undefined;
  readonly onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => void;
}

export interface DisclosureControl {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export interface DisclosureFold {
  readonly state: DisclosureState;
  readonly details: DisclosureDetailsProps;
}

const FindContext = createContext(false);

interface FrameCells {
  readonly lead: boolean;
  readonly actions: boolean;
}

const FrameContext = createContext<FrameCells | undefined>(undefined);
const ScopeFrameContext = createContext<FrameCells | undefined>(undefined);

const NO_CHANGE = (): void => undefined;
const StateContext = createContext<DisclosureState | undefined>(undefined);

export function useDisclosureState(): DisclosureState {
  const state = useContext(StateContext);
  if (state === undefined) throw new Error("A disclosure's parts must be drawn inside one");
  return state;
}

export function useDisclosureBodyDrawn(): boolean {
  const { drawn } = useDisclosureState();
  const finding = useContext(FindContext);
  return drawn || finding;
}

export function useDisclosurePreviewShown(inBody: boolean): boolean {
  const drawn = useDisclosureBodyDrawn();
  return !(inBody && drawn);
}

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
  const [pressed, setPressed] = useState(false);
  const replay = useListMotionReplay();
  const shown = useDisclosure(open, replay);
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
  const finding = useContext(FindContext);
  const motion = finding ? undefined : disclosureMotion(open && pressed, shown.leaving);
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
        if (!open) replay();
      },
      body,
    },
    details: {
      ref: details,
      open: shown.mounted,
      "data-disclosure": motion,
      onToggle: (event) => {
        if (event.currentTarget.open === shown.mounted) return;
        setPressed(false);
        setOpen(event.currentTarget.open);
      },
    },
  };
}

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

export function DisclosureFind({
  finding,
  children,
}: {
  finding: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return <FindContext.Provider value={finding}>{children}</FindContext.Provider>;
}

export function useDisclosureFinding(): boolean {
  return useContext(FindContext);
}

export function useDisclosureSummaryClick(): (event: MouseEvent<HTMLElement>) => void {
  const { toggle } = useDisclosureState();
  return (event) => {
    event.preventDefault();
    toggle();
  };
}

export const DISCLOSURE_LOOK = {
  PLAIN: "plain",
  CARD: "card",
  DOCK: "dock",
} as const;
export type DisclosureLook = (typeof DISCLOSURE_LOOK)[keyof typeof DISCLOSURE_LOOK];

type DisclosureProps = {
  look?: DisclosureLook;
  defaultOpen?: boolean;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  lead?: ReactNode;
  actions?: ReactNode;
  fill?: DisclosureFill;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"details">, "open" | "className" | "style" | "children">;

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
        className="ui-disclosure min-w-0"
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
  return (
    <Frame look={skin} lead={lead} actions={actions} fill={fill}>
      {fold}
    </Frame>
  );
}

export const DISCLOSURE_SUMMARY = {
  QUIET: "quiet",
  ROW: "row",
  CHIP: "chip",
  HEAD: "head",
  TRANSCRIPT: "transcript",
} as const;
export type DisclosureSummaryLook = (typeof DISCLOSURE_SUMMARY)[keyof typeof DISCLOSURE_SUMMARY];

const SUMMARY_ROW =
  "flex min-h-control cursor-press list-none items-center gap-icon-gap rounded-control ps-ui-4 pe-ui-4 font-sans text-caption text-muted-foreground transition-[background-color,color] duration-(--ui-duration-hover) ease-plain select-none [&::-webkit-details-marker]:hidden hover:bg-fill-strong hover:text-foreground active:bg-fill-pressed [&>:not(svg,.ui-disclosure-turn)]:min-w-0 [&>:not(svg,.ui-disclosure-turn)]:[overflow-wrap:anywhere] [&>svg]:size-control-icon [&>svg]:flex-none";

const SUMMARY_LOOK = {
  [DISCLOSURE_SUMMARY.QUIET]: SUMMARY_ROW,
  [DISCLOSURE_SUMMARY.ROW]: cn(
    SUMMARY_ROW,
    "box-border h-disclosure-row min-h-disclosure-row gap-ui-8 rounded-none pe-ui-12 whitespace-nowrap text-foreground",
  ),
  [DISCLOSURE_SUMMARY.CHIP]: cn(
    SUMMARY_ROW,
    "ms-auto w-fit min-h-0 border border-border bg-surface py-ui-2 ps-ui-6 pe-ui-6 hover:bg-surface [&>svg]:size-ui-12",
  ),
  [DISCLOSURE_SUMMARY.HEAD]: cn(
    SUMMARY_ROW,
    "h-ui-32 min-h-0 rounded-none ps-ui-12 pe-ui-12 text-inherit pointer-coarse:h-auto pointer-coarse:min-h-touch",
  ),
  [DISCLOSURE_SUMMARY.TRANSCRIPT]:
    "cursor-default list-none select-none [&::-webkit-details-marker]:hidden [&>svg]:size-control-icon [&>svg]:flex-none",
} as const satisfies Record<DisclosureSummaryLook, string>;

function summaryClass(
  look: DisclosureSummaryLook,
  frame: FrameCells | undefined,
  open: boolean,
): string {
  const own = SUMMARY_LOOK[look];
  const ruled = look === DISCLOSURE_SUMMARY.ROW && open && frame === undefined;
  if (frame === undefined || look === DISCLOSURE_SUMMARY.TRANSCRIPT) {
    return cn("ui-disclosure-summary", own, ruled && "border-b border-border");
  }
  return cn(
    "ui-disclosure-summary",
    own,
    "hover:bg-transparent active:bg-transparent",
    frame.lead && "ps-0",
    frame.actions && "pe-0",
  );
}

type DisclosureSummaryProps = {
  look?: DisclosureSummaryLook;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"summary">, "className" | "style" | "children" | "aria-expanded">;

export function DisclosureSummary({
  look = DISCLOSURE_SUMMARY.QUIET,
  onClick,
  children,
  ...props
}: DisclosureSummaryProps): React.JSX.Element {
  const { open } = useDisclosureState();
  const frame = useContext(ScopeFrameContext);
  const toggle = useDisclosureSummaryClick();
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

export const DISCLOSURE_FILL = {
  SUMMARY: "summary",
  ACTIONS: "actions",
} as const;
export type DisclosureFill = (typeof DISCLOSURE_FILL)[keyof typeof DISCLOSURE_FILL];

const OWN_PRESS =
  'a[href], area[href], button, input, label, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [tabindex]';

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
      className="ui-disclosure-frame"
      data-look={look}
      data-fill={fill === DISCLOSURE_FILL.SUMMARY ? undefined : fill}
      onPointerDown={onPointerDown}
    >
      {lead === undefined ? null : (
        // biome-ignore lint/a11y/noStaticElementInteractions: the cell's bare ground folds as the summary beside it does, for the pointer alone; the summary is the keyboard's.
        // biome-ignore lint/a11y/useKeyWithClickEvents: a key on a control inside reaches it as a click, which the cell leaves to the control.
        <div className="ui-disclosure-lead" onClick={groundPress}>
          {lead}
        </div>
      )}
      <FrameContext.Provider value={cells}>{children}</FrameContext.Provider>
      {actions === undefined ? null : (
        // biome-ignore lint/a11y/noStaticElementInteractions: the cell's bare ground folds as the summary beside it does, for the pointer alone; the summary is the keyboard's.
        // biome-ignore lint/a11y/useKeyWithClickEvents: a key on a control inside reaches it as a click, which the cell leaves to the control.
        <div className="ui-disclosure-actions" onClick={groundPress}>
          {actions}
        </div>
      )}
    </div>
  );
}

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
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Frame lead={lead} actions={actions} fill={fill} onPointerDown={onPointerDown}>
      {children}
    </Frame>
  );
}

export function DisclosureChevron({ open: handed }: { open?: boolean }): React.JSX.Element {
  const scoped = useContext(StateContext);
  const open = handed ?? scoped?.open;
  if (open === undefined) throw new Error("A disclosure's chevron must be drawn inside one");
  return (
    <span className="ui-disclosure-turn" data-open={open}>
      <FoldChevronIcon />
    </span>
  );
}

const BODY_INSET = {
  [DISCLOSURE_BODY.INDENTED]: "flex flex-col gap-ui-4 pt-ui-4 ml-ui-24",
  [DISCLOSURE_BODY.FLUSH]: "flex flex-col gap-ui-4 p-ui-4",
  [DISCLOSURE_BODY.CARD]: "border-t border-border px-list-inset py-row-inset",
  [DISCLOSURE_BODY.NONE]: undefined,
} as const satisfies Record<DisclosureBodyInset, string | undefined>;

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
      className={cn("ui-disclosure-body", BODY_INSET[inset])}
      data-inset={inset}
      inert={leaving}
    >
      {children}
    </div>
  );
}
