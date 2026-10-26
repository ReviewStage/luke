/**
 * column-dock.ts -- how tall the dock at the foot of a column stands, said where what floats over that foot reads it: the folded sidebar's call card, the toasts, and the voice's notice line; and how tall a phone's card may stand under the column's bars.
 */

import { type RefObject, useLayoutEffect } from "react";

/** What docks at a column's foot: an agent's to-do list, pull request row, and composer, and a call's video, whichever stand. */
const DOCKED = ".agent-todos-dock, .agent-published-dock, .agent-composer, .agent-call-foot";

/** The length the dock's height is written in. */
const COLUMN_DOCK = "--luke-column-dock";

/** The card that floats over the column while the sidebar is folded. */
const FLOATING_CARD = '.call-card[data-surface="floating"]';

/** The length the floating card's own height is written in. */
const FLOATING_CARD_HEIGHT = "--floating-card";

/** The floating card's video tile (`@luke/ui`'s `CallVideoTile`). */
const CARD_TILE = ".luke-call-video-tile";

/** The tile's still, where it draws Luke's face and its words in the video's place (`@luke/ui`'s `AvatarStill`). */
const TILE_STILL = ".luke-call-video-still";

/** The tile's wait once the video's first frame is drawn (`@luke/ui`'s `AvatarWaiting`), which fades out but stays laid out. */
const TILE_GONE = '.luke-call-video-waiting[data-gone="true"]';

/** The length the card hands its tile's height in (`@luke/ui`'s placement hook). */
const CARD_TILE_HEIGHT = "--luke-call-video-height";

/** The bars of a pane, a tab's own and its tabs (`@luke/ui`'s `PaneBar`), which a phone's card never covers where it can clear them. */
const PANE_BAR = ".luke-pane-bar";

/** The token the card stands clear of what it rises above by. */
const CARD_GAP = "--luke-space-8";

/** The token the card's tile never stands shorter than: a control's height, so its Video off stays a press. */
const TILE_FLOOR = "--luke-control-height";

/** The tile's own aspect on a card, height over width (`CALL_VIDEO_FIT.CARD`). */
const TILE_ASPECT = 9 / 16;

/** What docks under the toasts besides a column's parts: a phone's places bar at the screen's foot (`mobile-bar.tsx`). */
const TOAST_DOCKED = ".mobile-bar";

/** The window's toasts, portalled out of the shell to the document's body (`@luke/ui`'s `ToastStack`). */
const TOAST_STACK = ".luke-toast-stack";

/** The length the dock under the toasts is written in, beside the work, where they stand in the window's corner rather than across a column. */
const TOAST_DOCK = "--luke-toast-dock";

/** The token the toasts' corner stands in from the window's by. */
const CORNER_STEP = "--luke-space-16";

/** Writes `length` on `element` as `value`, or takes it away where there is none, touching the style only when it changes. */
function writeLength(element: HTMLElement, length: string, value: string | undefined): void {
  const was = element.style.getPropertyValue(length);
  if (value === undefined) {
    if (was !== "") element.style.removeProperty(length);
    return;
  }
  if (was !== value) element.style.setProperty(length, value);
}

/** Whether two lists hold the same elements in the same order. */
function sameElements(a: readonly Element[], b: readonly Element[]): boolean {
  return a.length === b.length && a.every((element, index) => element === b[index]);
}

/**
 * Whether `element` is on screen at `box`: it draws a box, across `within`'s
 * own span where one is given, and stands in no inert subtree, as a pane or
 * a panel on its way out does. Note that a pane a narrow room hides draws no
 * box, and one sliding away stands inert or off its column, so neither docks
 * anything under what floats over the column it left.
 */
function seen(element: Element, box: DOMRect, within?: DOMRect): boolean {
  if (box.width === 0 && box.height === 0) return false;
  if (within !== undefined && (box.right <= within.left || box.left >= within.right)) return false;
  return element.closest("[inert]") === null;
}

/** The first of the columns `selector` finds under `host` that is on screen, or none. */
function shownColumn(host: Element, selector: string): Element | null {
  for (const column of host.querySelectorAll(selector))
    if (seen(column, column.getBoundingClientRect())) return column;
  return null;
}

/** From the column's foot to the top of its highest docked part on screen, or nothing where none stands. */
function dockHeight(column: Element, docked: string): number {
  const span = column.getBoundingClientRect();
  const foot = span.bottom;
  let top = foot;
  for (const part of column.querySelectorAll(docked)) {
    const box = part.getBoundingClientRect();
    if (!seen(part, box, span)) continue;
    top = Math.min(top, box.top);
  }
  return Math.max(0, foot - top);
}

/** A length token read off the document's root, or none where it is unset. */
function rootLength(root: HTMLElement, token: string): number {
  const length = Number.parseFloat(getComputedStyle(root).getPropertyValue(token));
  return Number.isNaN(length) ? 0 : length;
}

/**
 * The feet of the bars on screen in `column` that end above `rest`, the
 * card's foot. Note that a bar is kept by where it ends rather than by where
 * in the column it stands, because a pull request's header grows with its
 * title and can push its tabs past the column's middle, while a bar docked
 * at the column's foot ends under the card's own foot and is one no height
 * of the card's could clear.
 */
function barFeet(column: Element, rest: number): number[] {
  const span = column.getBoundingClientRect();
  const feet: number[] = [];
  for (const bar of column.querySelectorAll(PANE_BAR)) {
    const box = bar.getBoundingClientRect();
    if (seen(bar, box, span) && box.bottom < rest) feet.push(box.bottom);
  }
  return feet;
}

/**
 * What the tile's still needs where it draws words in the video's place
 * (Video ended, why, and Restart video; or the wait while it connects):
 * from its first line shown to its last, its padding, and the tile's border;
 * or nothing over a picture. Note that the lines are read where they lay
 * out, so a tile already shortened still answers what they need whole; and
 * that a wait gone from over the video's first frame (`TILE_GONE`) needs
 * nothing, since it stays laid out while it fades and then stands unseen.
 */
function stillNeeds(tile: HTMLElement): number {
  const still = [...tile.querySelectorAll<HTMLElement>(TILE_STILL)].find(
    (each) => each.closest(TILE_GONE) === null,
  );
  if (still === undefined) return 0;
  const lines = [...still.children].filter(
    (line): line is HTMLElement => line instanceof HTMLElement && line.offsetHeight > 0,
  );
  if (lines.length === 0) return 0;
  const top = Math.min(...lines.map((line) => line.offsetTop));
  const bottom = Math.max(...lines.map((line) => line.offsetTop + line.offsetHeight));
  const padding = getComputedStyle(still);
  const inset = Number.parseFloat(padding.paddingTop) + Number.parseFloat(padding.paddingBottom);
  return bottom - top + (Number.isNaN(inset) ? 0 : inset) + tile.offsetHeight - tile.clientHeight;
}

/**
 * The height a phone's card hands its video tile, or none where the tile
 * stands at its own 16:9: where the card at rest would reach over a bar
 * above its foot (`barFeet`), the tile gives up what it must for the card
 * to stand the gap clear of the lowest bar it can clear at its least, which
 * is `floor`, or what its still's words need (`stillNeeds`) where that is
 * more. Where it can clear none, it stands at its least and covers them
 * rather than lose the video or cut Restart video off; and a bar under one
 * it clears, which it could not clear too (a Chapters view's own head under
 * the pull request's tabs), costs the tile nothing. It never stands taller
 * than its own 16:9. Note that the card is read where it is laid out, its
 * `offsetTop`, not where its rise or its lift over a dock (`lift`) has
 * moved it, since neither the end of a rise nor the end of the lift's glide
 * reaches an observer; and that the card stands on its foot, so handing the
 * tile a height moves the card's top and leaves the room it is read from as
 * it was.
 */
function tileHeight(
  card: HTMLElement,
  tile: HTMLElement,
  column: Element,
  lift: number,
  gap: number,
  floor: number,
): number | undefined {
  const rest = card.offsetTop + card.offsetHeight - lift;
  const feet = barFeet(column, rest);
  if (feet.length === 0) return undefined;
  const chrome = card.offsetHeight - tile.offsetHeight;
  const least = Math.max(floor, stillNeeds(tile));
  const under = (foot: number) => rest - foot - gap - chrome;
  const cleared = feet.filter((foot) => under(foot) >= least);
  const height = cleared.length === 0 ? least : under(Math.max(...cleared));
  return height >= tile.offsetWidth * TILE_ASPECT ? undefined : Math.floor(height);
}

/**
 * Hands the floating card's video tile the height `tileHeight` answers for
 * the bars of `column`, the column a phone's card stands over, or takes it
 * back where none is given or none answers, so the tile stands at its own
 * 16:9 again.
 */
function fitTile(
  card: Element | null,
  column: Element | null,
  dock: number,
  root: HTMLElement,
): void {
  const tile = card?.querySelector(CARD_TILE);
  if (!(card instanceof HTMLElement) || !(tile instanceof HTMLElement)) return;
  const gap = rootLength(root, CARD_GAP);
  // As far as the card's own rule lifts it over the dock (`call.css`).
  const lift = Math.max(0, dock + gap - cornerStep(root));
  const height =
    column === null
      ? undefined
      : tileHeight(card, tile, column, lift, gap, rootLength(root, TILE_FLOOR));
  writeLength(card, CARD_TILE_HEIGHT, height === undefined ? undefined : `${height}px`);
}

/** The toasts' step in from the window's corner, read from its token on the document's root, or none where it is unset. */
function cornerStep(root: HTMLElement): number {
  const step = Number.parseFloat(getComputedStyle(root).getPropertyValue(CORNER_STEP));
  return Number.isNaN(step) ? 0 : step;
}

/**
 * From the window's foot to the top of the highest docked part on screen
 * under the toasts' corner, or nothing where none stands there. A part
 * counts only once one under the corner reaches into where the toasts rest
 * (their height and the corner's step up from the window's foot): a draft
 * reply that flows at a short thread's end, well above the foot, leaves
 * them in their corner, over the empty room below it, and one at a long
 * thread's end lifts them by as much of it as shows.
 */
function toastDockHeight(shell: Element, docked: string, stack: DOMRect, step: number): number {
  const foot = shell.getBoundingClientRect().bottom;
  const resting = foot - step - stack.height;
  let top = foot;
  let reached = false;
  for (const part of shell.querySelectorAll(docked)) {
    const box = part.getBoundingClientRect();
    if (!seen(part, box)) continue;
    if (box.left >= stack.right || box.right <= stack.left) continue;
    reached ||= box.bottom > resting;
    top = Math.min(top, box.top);
  }
  return reached ? Math.max(0, foot - top) : 0;
}

/**
 * Keeps two lengths for the folded sidebar's call card: the dock of the
 * column it stands over (`--luke-column-dock`), which it stands just above, and
 * its own height (`--floating-card`), which the transcript under it keeps
 * clear. The dock is written on the document's root, because the toasts,
 * which a phone stands above it too, are portalled out of the shell; the
 * card's height on the shell. The column is the task's, or an agent's page
 * standing in its place, or the side panel while it fills the window; of
 * those found, the first on screen, and of its docked
 * parts, those on screen, so a pane or a panel on its way out lifts nothing.
 * On a phone, where a short screen leaves the card no room under the
 * column's bars at the card's full height, the card's video tile is handed
 * the height that does fit (`tileHeight`), so the card never covers a tab.
 *
 * The toasts stand in the window's corner, over whichever column reaches
 * it, so they read a dock of their own too (`--luke-toast-dock`): the
 * docked parts on screen under their corner, whatever column holds them, a
 * phone's places bar among them. Note that nothing else is written for
 * the toasts: they are an overlay, so a page or a log under them keeps its
 * end and its scroll whether one stands or not.
 *
 * One ResizeObserver follows the column, the docked parts, the card, and
 * the toasts; a scroll anywhere under the shell re-reads, since it moves a
 * part that flows with what it scrolls; a MutationObserver re-reads when the column or a part arrives
 * or goes, a task's column once it has loaded, a to-do list appearing over
 * the composer. `key` names what the shell is drawing,
 * so a page or a panel coming and going finds its column afresh. A shell
 * with no such column (Settings, a version history) says no dock at all.
 *
 * Note that every change under the shell (a transcript's message landing, a
 * hover card) wakes the MutationObserver, and each measure lays out the whole
 * window, so the changes of one frame are read once, at that frame, the
 * column and its parts followed afresh only where they are others than were
 * followed; and that a length is written only when it changes, since a
 * length on the document's root restyles every element under it.
 */
export function useColumnDock(
  shell: RefObject<HTMLElement | null>,
  panelFull: boolean,
  narrow: boolean,
  key: string,
): void {
  useLayoutEffect(() => {
    const host = shell.current;
    if (host === null) return;
    const root = host.ownerDocument.documentElement;
    // Found afresh on every change under the shell, because a task still
    // loading draws its column only once its document lands.
    const columnSelector = panelFull ? ".side-panel" : ".desktop-task-main, .agent-page";
    const toastDocked = `${DOCKED}, ${TOAST_DOCKED}`;
    let column = shownColumn(host, columnSelector);
    // What the observer follows, so a change that leaves them standing follows nothing anew.
    let followed: readonly Element[] = [];
    const sized = new ResizeObserver(() => write());
    function write(): void {
      if (host === null) return;
      const card = host.querySelector(FLOATING_CARD);
      const dock = column === null ? undefined : dockHeight(column, DOCKED);
      writeLength(root, COLUMN_DOCK, dock === undefined ? undefined : `${dock}px`);
      writeLength(
        host,
        FLOATING_CARD_HEIGHT,
        card === null ? undefined : `${card.getBoundingClientRect().height}px`,
      );
      fitTile(card, narrow ? column : null, dock ?? 0, root);
      const stack = root.querySelector(TOAST_STACK);
      const toastDock =
        stack === null
          ? undefined
          : toastDockHeight(host, toastDocked, stack.getBoundingClientRect(), cornerStep(root));
      writeLength(root, TOAST_DOCK, toastDock === undefined ? undefined : `${toastDock}px`);
    }
    function follow(): void {
      if (host === null) return;
      const card = host.querySelector(FLOATING_CARD);
      const stack = root.querySelector(TOAST_STACK);
      // The toasts read docked parts in any column, so each is followed.
      const elsewhere = [...host.querySelectorAll(toastDocked)].filter(
        (part) => !column?.contains(part),
      );
      const standing = [
        ...(column === null ? [] : [column, ...column.querySelectorAll(DOCKED)]),
        ...elsewhere,
        ...(card === null ? [] : [card]),
        ...(stack === null ? [] : [stack]),
      ];
      if (sameElements(standing, followed)) return;
      followed = standing;
      sized.disconnect();
      for (const element of standing) sized.observe(element);
    }
    let frame: number | undefined;
    function measure(): void {
      if (host === null || frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        column = shownColumn(host, columnSelector);
        follow();
        write();
      });
    }
    const arrived = new MutationObserver(measure);
    // Note that the card's wait goes from over the video's first frame by an attribute alone, which frees the room it held (`stillNeeds`).
    arrived.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-gone"],
    });
    // Note that a scroll moves a part that flows with what it scrolls, an Inbox reply box, under the toasts, and neither observer sees it.
    host.addEventListener("scroll", measure, { capture: true, passive: true });
    follow();
    write();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      sized.disconnect();
      arrived.disconnect();
      host.removeEventListener("scroll", measure, { capture: true });
      root.style.removeProperty(COLUMN_DOCK);
      root.style.removeProperty(TOAST_DOCK);
      host.style.removeProperty(FLOATING_CARD_HEIGHT);
      host.querySelector<HTMLElement>(FLOATING_CARD)?.style.removeProperty(CARD_TILE_HEIGHT);
    };
  }, [shell, panelFull, narrow, key]);
}
