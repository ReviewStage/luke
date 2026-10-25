import { type ReactNode, useRef } from "react";
import { Menu, type MenuEntry, useMenu } from "../menu/menu.js";
import { MoreButton, moreLabel } from "../more-button/more-button.js";
import { OneLine } from "../one-line/one-line.js";
import { wholeWordsHint } from "../tooltip/hint.js";
import { type TitleSeat, useWrapWhenCut } from "../../use-wrap-when-cut.js";

/**
 * pane-bar.tsx -- the bar across the top of a tab or a dock: what leads it (a mark and a title, fading where cut), its middle (tabs or crumbs), its actions, and its ⋯ at the end.
 *
 * Every tab's bar is this one (File, Changes, Page, Terminal, Browser, Pull
 * request) and a dock's head beside them, so a tab reads down from the strip
 * above it on one height (`--luke-pane-bar-height`): a control's, a tight
 * gap over and under it, and the hairline it stands on, whether it holds
 * words alone, buttons, or nothing yet. Its words are in the caption's type.
 *
 * The slots stand in one order, each drawn only where it says something.
 * The lead names what the tab shows: a mark (the thing's glyph, or a chip
 * naming it), its title on one line that fades out where the bar cuts it
 * rather than wrapping, the hint reading it whole while it is cut, and a
 * quiet detail after it (where a connection stands). The lead starts at a
 * row's inset, where a tab's glyph does, since it holds words; the middle,
 * where nothing leads it, starts at the bar's own edge, since it holds
 * controls (Back and Forward before a path's crumbs, an address, tabs). The
 * actions stand at the bar's end, the glyphs in them close, and the ⋯ last.
 * A bar that would cut its title under the readable floor on one row
 * (`use-wrap-when-cut.ts`) stands it on a row of its own under the rest,
 * at the lead's inset, rather than cutting it to a few letters.
 *
 * The ⋯ is a `MoreButton`, drawn from a menu's definition (`menu`), its
 * thing naming both the button and the menu it drops ("File" makes "File
 * actions"), so a bar never wires its own trigger;
 * how its lines are drawn is a View settings button among the actions,
 * never an item of the ⋯.
 */

/**
 * The bar: one height whatever it holds, its words in the caption's type, its
 * groups a control's gap apart, on the hover's wash over a hairline. Each
 * part keeps its `luke-pane-bar-*` class, which the panel's sheets and tests
 * find it by.
 */
const BAR =
  "luke-pane-bar box-border flex min-h-pane-bar min-w-0 flex-none items-center gap-control-gap border-b border-border bg-muted px-list-inset py-tight-gap font-sans text-caption text-muted-foreground";
/** Words leading the bar start where a tab's glyph does, a row's inset in. */
const LEAD =
  "luke-pane-bar-lead flex min-w-0 flex-initial items-center gap-item-gap pl-row-inset whitespace-nowrap";
const MARK = "luke-pane-bar-mark flex flex-none items-center [&>svg]:size-control-icon";
const MIDDLE = "luke-pane-bar-middle flex min-w-0 flex-auto items-center gap-control-gap";
/** The actions at the end, their glyphs close. */
const ACTIONS = "luke-pane-bar-actions ml-auto flex flex-none items-center gap-luke-2";
/** A bar whose title has a row of its own lays its parts on two rows, the title's last. */
const WRAPPED = "flex-wrap gap-y-0";
/** The title's own row: the bar wide, a control high, its words where the lead's start. */
const TITLE_ROW =
  "luke-pane-bar-title-row order-last flex min-h-control min-w-0 basis-full items-center pl-row-inset";
/** Where the bar's title stands on one row: in its lead. */
const TITLE_SEAT: TitleSeat = { room: ".luke-pane-bar-lead", words: ".luke-pane-bar-title" };

/** The bar's ⋯: what it and the menu it drops are called, and the menu's groups of items. */
export interface PaneBarMenu {
  /** What the tab shows, as a sentence opens with it: "File" names the ⋯ and its menu "File actions". */
  readonly thing: string;
  readonly groups: readonly (readonly MenuEntry[])[];
}

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/** The ⋯ at the bar's end, which drops its menu under itself. */
function BarMenu({ menu }: { menu: PaneBarMenu }): React.JSX.Element {
  const drop = useMenu(true);
  return (
    <>
      <MoreButton thing={menu.thing} {...drop.trigger()} />
      {drop.drawn === undefined ? null : (
        <Menu
          label={moreLabel(menu.thing)}
          menu={drop.drawn}
          groups={menu.groups}
          onClose={drop.close}
        />
      )}
    </>
  );
}

/** The bar over a tab or a dock: its lead, middle, and actions in that order, and its ⋯ last. */
export function PaneBar({
  mark,
  title,
  detail,
  middle,
  actions,
  menu,
}: {
  /** What leads the title: the thing's glyph, or a chip naming it. */
  mark?: ReactNode;
  /** What the tab shows, on one line that fades where the bar cuts it. */
  title?: string | undefined;
  /** Quiet words after the title: where a connection stands, which version is shown. */
  detail?: ReactNode;
  /** Between the lead and the actions, taking the room left: tabs, crumbs, an address. */
  middle?: ReactNode;
  /** The bar's buttons, at its end. */
  actions?: ReactNode;
  /** The bar's ⋯, drawn last; none draws no ⋯. */
  menu?: PaneBarMenu | undefined;
}): React.JSX.Element {
  const frame = useRef<HTMLElement>(null);
  const titled = title !== undefined && title !== "";
  const wrapped = useWrapWhenCut(frame, TITLE_SEAT, titled);
  const leads = said(mark) || (titled && !wrapped) || said(detail);
  const acts = said(actions) || menu !== undefined;
  const words = titled ? (
    <OneLine
      className="luke-pane-bar-title flex-initial text-foreground"
      hint={wholeWordsHint(title)}
    >
      {title}
    </OneLine>
  ) : null;
  return (
    <header
      ref={frame}
      className={wrapped ? `${BAR} ${WRAPPED}` : BAR}
      data-wrapped={wrapped ? "true" : undefined}
    >
      {leads ? (
        <div className={LEAD}>
          {said(mark) ? <span className={MARK}>{mark}</span> : null}
          {wrapped ? null : words}
          {said(detail) ? <span className="luke-pane-bar-detail flex-none">{detail}</span> : null}
        </div>
      ) : null}
      {wrapped ? <div className={TITLE_ROW}>{words}</div> : null}
      {said(middle) ? <div className={MIDDLE}>{middle}</div> : null}
      {acts ? (
        <div className={ACTIONS}>
          {actions}
          {menu === undefined ? null : <BarMenu menu={menu} />}
        </div>
      ) : null}
    </header>
  );
}
