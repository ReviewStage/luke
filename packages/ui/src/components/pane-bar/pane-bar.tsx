import type { ReactNode } from "react";
import { EllipsisIcon } from "../../face/glyphs.js";
import { IconButton } from "../button/button.js";
import { Menu, type MenuEntry, useMenu } from "../menu/menu.js";
import { OneLine } from "../one-line/one-line.js";
import { Tooltip, wholeWordsHint } from "../tooltip/hint.js";

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
 *
 * The ⋯ is drawn from a menu's definition (`menu`), its label naming both
 * the button and the menu it drops, so a bar never wires its own trigger;
 * how its lines are drawn is a View settings button among the actions,
 * never an item of the ⋯.
 */

/** The bar's ⋯: what it and the menu it drops are called, and the menu's groups of items. */
export interface PaneBarMenu {
  /** Names the ⋯ and its menu: "File actions". */
  readonly label: string;
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
      <Tooltip label={menu.label}>
        <IconButton icon={<EllipsisIcon />} label={menu.label} {...drop.trigger()} />
      </Tooltip>
      {drop.drawn === undefined ? null : (
        <Menu label={menu.label} menu={drop.drawn} groups={menu.groups} onClose={drop.close} />
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
  const leads = said(mark) || said(title) || said(detail);
  const acts = said(actions) || menu !== undefined;
  return (
    <header className="luke-pane-bar">
      {leads ? (
        <div className="luke-pane-bar-lead">
          {said(mark) ? <span className="luke-pane-bar-mark">{mark}</span> : null}
          {title === undefined || title === "" ? null : (
            <OneLine className="luke-pane-bar-title" hint={wholeWordsHint(title)}>
              {title}
            </OneLine>
          )}
          {said(detail) ? <span className="luke-pane-bar-detail">{detail}</span> : null}
        </div>
      ) : null}
      {said(middle) ? <div className="luke-pane-bar-middle">{middle}</div> : null}
      {acts ? (
        <div className="luke-pane-bar-actions">
          {actions}
          {menu === undefined ? null : <BarMenu menu={menu} />}
        </div>
      ) : null}
    </header>
  );
}
