import {
  type ReactNode,
  type Ref,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { isComposingKey } from "../../composing-key.js";
import { ShadcnInput } from "../../shadcn/input.js";
import { STATUS_TONE } from "../../status-tone.js";
import {
  DisclosureChevron,
  type DisclosureControl,
  DisclosureScope,
  useDisclosureFold,
} from "../disclosure/disclosure.js";
import { INLINE_EDIT_FIELD, INLINE_EDIT_LOOK } from "../inline-edit/inline-edit.js";
import { type ContextMenuProps, withContextMenu } from "../menu/menu.js";
import { NAV_COUNT_SHOWN, type NavCount } from "../nav-item/nav-item.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import { Tooltip } from "../tooltip/hint.js";

export const GROUP_HEADING = {
  H2: "h2",
  H3: "h3",
  H4: "h4",
  NONE: "div",
} as const;
export type GroupHeading = (typeof GROUP_HEADING)[keyof typeof GROUP_HEADING];

export const GROUP_ACTIONS = {
  ON_HOVER: "on-hover",
  AT_REST: "at-rest",
} as const;
export type GroupActions = (typeof GROUP_ACTIONS)[keyof typeof GROUP_ACTIONS];

export const GROUP_ACTION_STATE = {
  IDLE: "idle",
  ACTIVE: "active",
} as const;
export type GroupActionState = (typeof GROUP_ACTION_STATE)[keyof typeof GROUP_ACTION_STATE];

export const GROUP_SURFACE = {
  WIDE: "wide",
  NARROW: "narrow",
} as const;
export type GroupSurface = (typeof GROUP_SURFACE)[keyof typeof GROUP_SURFACE];

export const GROUP_HEAD = {
  SCROLLS: "scrolls",
  STICKS: "sticks",
} as const;
export type GroupHead = (typeof GROUP_HEAD)[keyof typeof GROUP_HEAD];

export const GROUP_ROWS = {
  STACKED: "stacked",
  SUBGRID: "subgrid",
} as const;
export type GroupRows = (typeof GROUP_ROWS)[keyof typeof GROUP_ROWS];

export type GroupFold = { readonly defaultOpen: boolean } | DisclosureControl;

const BROUGHT =
  "opacity-0 group-hover/head:opacity-100 group-focus-visible/lead:opacity-100 [@media(hover:none)]:opacity-100";

const GIVES_WAY =
  "group-hover/head:opacity-0 group-focus-visible/lead:opacity-0 [@media(hover:none)]:opacity-0";

const FADE = "transition-[opacity] duration-(--ui-duration-hover) ease-plain";

const PART = {
  HEADING: "ui-group-header-heading m-0 flex min-w-0 flex-auto [font:inherit]",
  LEAD: "ui-group-header-lead group/lead m-0 flex h-control min-w-0 flex-auto items-center gap-icon-gap rounded-control border-0 bg-transparent px-row-inset py-0 text-left font-ui text-muted-foreground",
  GLYPH:
    "ui-group-header-glyph grid min-h-control-icon min-w-control-icon flex-none place-items-center *:[grid-area:1/1]",
  ICON: `ui-group-header-icon grid place-items-center [&>svg]:size-control-icon ${FADE}`,
  CHEVRON: `ui-group-header-chevron grid place-items-center ${FADE}`,
  MARK: "ui-group-header-mark inline-flex flex-none text-muted-foreground [&>svg]:size-group-header-mark",
  COUNT: `ui-group-header-count flex-none text-caption-inline tabular-nums ${FADE}`,
  ACTIONS: "ui-group-header-actions flex flex-none items-center gap-ui-4",
} as const;

const EDITOR = {
  LEAD: "ui-group-header-editor-lead flex h-control min-w-0 flex-auto items-center gap-icon-gap px-row-inset text-group font-group text-foreground",
  GLYPH:
    "ui-group-header-editor-glyph grid min-h-control-icon min-w-control-icon flex-none place-items-center *:-m-ui-4",
  FIELD: `${INLINE_EDIT_FIELD} data-[look=well]:min-w-0 data-[look=well]:flex-auto`,
} as const;

const PRESSED_AS_ROW = {
  HEAD: "hover:bg-muted",
  LEAD: "cursor-press",
} as const;

const HEAD_BOX =
  "group/head flex min-w-0 items-center gap-ui-2 rounded-control pr-ui-4 transition-[background-color] duration-(--ui-duration-hover) ease-plain data-[menu-open=true]:shadow-menu-open-edge in-data-[ui-profile=desktop]:[-webkit-app-region:no-drag]";

const HEAD = `ui-group-header-head ${HEAD_BOX}`;

const STICKS = "sticky top-0 z-3 bg-ground";

const SUBGRID = {
  ROOT: "grid col-span-full grid-cols-subgrid gap-y-ui-2",
  HEAD: "col-span-full",
  BODY: "grid col-span-full grid-cols-subgrid gap-y-ui-2 *:col-span-full",
} as const;

function said(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

function Count({ count }: { count: NavCount }): React.JSX.Element {
  const shown = count.shown ?? NAV_COUNT_SHOWN.ALWAYS;
  const tone = count.tone ?? STATUS_TONE.NEUTRAL;
  const ink = tone === STATUS_TONE.NEUTRAL ? "text-muted-foreground" : "text-tone-ink";
  return (
    <span
      className={`${PART.COUNT} ${ink} ${shown === NAV_COUNT_SHOWN.ON_HOVER ? BROUGHT : ""}`}
      data-shown={shown}
      data-tone={tone}
    >
      {count.value}
      {count.noun === undefined ? null : <span className="ui-visually-hidden"> {count.noun}</span>}
    </span>
  );
}

function Lead({
  glyph,
  folds,
  label,
  mark,
  count,
}: {
  glyph: ReactNode;
  folds: boolean;
  label: ReactNode;
  mark: ReactNode;
  count: NavCount | undefined;
}): React.JSX.Element {
  const swaps = said(glyph) && folds;
  return (
    <>
      {said(glyph) || folds ? (
        <span className={PART.GLYPH} aria-hidden="true">
          {said(glyph) ? (
            <span className={`${PART.ICON} ${swaps ? GIVES_WAY : ""}`}>{glyph}</span>
          ) : null}
          {folds ? (
            <span className={`${PART.CHEVRON} ${swaps ? BROUGHT : ""}`}>
              <DisclosureChevron />
            </span>
          ) : null}
        </span>
      ) : null}
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.GROUP} truncate>
        {label}
      </Text>
      {said(mark) ? <span className={PART.MARK}>{mark}</span> : null}
      {count === undefined ? null : <Count count={count} />}
    </>
  );
}

export interface GroupHeaderEditEnd {
  readonly kept: boolean;
  readonly value: string;
  readonly byKey: boolean;
}

export interface GroupHeaderEditorHandle {
  leave: () => void;
}

export function GroupHeaderEditor({
  value,
  label,
  placeholder,
  maxLength,
  glyph,
  holding = false,
  onEnd,
  ref,
}: {
  value: string;
  label: string;
  placeholder?: string | undefined;
  maxLength?: number | undefined;
  glyph: ReactNode;
  holding?: boolean | undefined;
  onEnd: (end: GroupHeaderEditEnd) => void;
  ref?: Ref<GroupHeaderEditorHandle> | undefined;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const ended = useRef(false);
  const held = useRef(holding);
  held.current = holding;
  useLayoutEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  const end = (kept: boolean, byKey: boolean) => {
    if (ended.current) return;
    ended.current = true;
    onEnd({ kept, value: field.current?.value.trim() ?? "", byKey });
  };
  const inHead = (target: EventTarget | null) =>
    target instanceof Node && root.current?.contains(target) === true;
  useImperativeHandle(ref, () => ({
    leave: () => {
      if (!inHead(document.activeElement)) end(true, false);
    },
  }));
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the head takes nothing itself; it hears the focus leave its field, its glyph's control, and the layer that control hangs in a portal, which only React carries back up to it.
    <div
      ref={root}
      className={`ui-group-header-editor ${HEAD_BOX}`}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (held.current || inHead(next)) return;
        end(true, false);
      }}
    >
      <div className={EDITOR.LEAD}>
        <span className={EDITOR.GLYPH}>{glyph}</span>
        <ShadcnInput
          ref={field}
          type="text"
          className={EDITOR.FIELD}
          data-look={INLINE_EDIT_LOOK.WELL}
          aria-label={label}
          defaultValue={value}
          placeholder={placeholder}
          maxLength={maxLength}
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (!isComposingKey(event)) end(false, true);
            }
            if (event.key === "Enter" && !isComposingKey(event)) {
              event.preventDefault();
              end(true, true);
            }
          }}
        />
      </div>
    </div>
  );
}

export function GroupAction({
  state = GROUP_ACTION_STATE.IDLE,
  children,
}: {
  state?: GroupActionState;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className="ui-group-header-action relative inline-flex" data-state={state}>
      {children}
    </span>
  );
}

export function GroupHeader({
  label,
  glyph,
  mark,
  count,
  actions,
  actionsShown = GROUP_ACTIONS.ON_HOVER,
  fold,
  standing,
  tooltip,
  card,
  surface = GROUP_SURFACE.WIDE,
  head = GROUP_HEAD.SCROLLS,
  rows: rowsStand = GROUP_ROWS.STACKED,
  heading = GROUP_HEADING.H2,
  menuOpen = false,
  contextMenu,
  editing,
  children,
}: {
  label: ReactNode;
  glyph?: ReactNode;
  mark?: ReactNode;
  count?: NavCount | undefined;
  actions?: ReactNode;
  actionsShown?: GroupActions;
  fold?: GroupFold | undefined;
  standing?: ReactNode;
  tooltip?: string | undefined;
  card?: ReactNode;
  surface?: GroupSurface;
  head?: GroupHead;
  rows?: GroupRows;
  heading?: GroupHeading;
  menuOpen?: boolean;
  contextMenu?: ContextMenuProps | undefined;
  editing?: ReactNode;
  children?: ReactNode;
}): React.JSX.Element {
  const rowsId = useId();
  const folds = fold !== undefined;
  const { state, details } = useDisclosureFold(
    fold !== undefined && "defaultOpen" in fold ? fold.defaultOpen : true,
    fold !== undefined && "open" in fold ? fold : undefined,
  );
  const rows = (!folds || state.drawn) && said(children);
  const Heading = heading;
  const counted =
    count === undefined
      ? undefined
      : {
          ...count,
          shown:
            count.shown ??
            (surface === GROUP_SURFACE.NARROW && state.open
              ? NAV_COUNT_SHOWN.ON_HOVER
              : NAV_COUNT_SHOWN.ALWAYS),
        };
  const lead = <Lead glyph={glyph} folds={folds} label={label} mark={mark} count={counted} />;
  const hint = tooltip ?? (card === undefined || typeof label !== "string" ? undefined : label);
  const control = folds ? (
    <button
      type="button"
      className={`${PART.LEAD} ${PRESSED_AS_ROW.LEAD}`}
      aria-expanded={state.open}
      aria-controls={rows ? rowsId : undefined}
      onClick={state.toggle}
    >
      {lead}
    </button>
  ) : (
    <span className={PART.LEAD}>{lead}</span>
  );
  const subgrid = rowsStand === GROUP_ROWS.SUBGRID;
  const named = (
    <Heading className={PART.HEADING}>
      {hint === undefined ? (
        control
      ) : (
        <Tooltip label={hint} card={card}>
          {control}
        </Tooltip>
      )}
    </Heading>
  );
  return (
    <DisclosureScope state={state}>
      <div
        className={`ui-group-header min-w-0 ${subgrid ? SUBGRID.ROOT : ""}`}
        data-folds={folds ? "true" : undefined}
        data-head={head === GROUP_HEAD.STICKS ? head : undefined}
        data-rows={subgrid ? rowsStand : undefined}
        data-disclosure={folds ? details["data-disclosure"] : undefined}
      >
        {said(editing) ? (
          editing
        ) : (
          <div
            className={[
              HEAD,
              folds ? PRESSED_AS_ROW.HEAD : "",
              head === GROUP_HEAD.STICKS ? STICKS : "",
              subgrid ? SUBGRID.HEAD : "",
            ].join(" ")}
            data-menu-open={menuOpen ? "true" : undefined}
            {...withContextMenu<HTMLDivElement>(contextMenu, {})}
          >
            {named}
            {said(actions) ? (
              <span className={PART.ACTIONS} data-shown={actionsShown}>
                {actions}
              </span>
            ) : null}
          </div>
        )}
        {rows ? (
          <div
            ref={folds ? state.body : undefined}
            id={rowsId}
            className={`ui-disclosure-body ${subgrid ? SUBGRID.BODY : ""}`}
            data-inset="none"
            inert={folds && state.leaving}
          >
            {children}
          </div>
        ) : null}
        {folds && !state.drawn && said(standing) ? standing : null}
      </div>
    </DisclosureScope>
  );
}
