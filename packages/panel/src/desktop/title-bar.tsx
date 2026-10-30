/**
 * title-bar.tsx -- the window's one title bar, across a wide desktop window over every pane, which names the place the main column shows: each page draws its head there rather than in its own top row.
 *
 * The desktop's wide window stands one title bar over its panes, as an
 * editor stands one over its workspace: the traffic lights, the sidebar's
 * toggle, and New task while the sidebar is folded at its start; then the
 * place the main column shows, named by the page itself (a task's
 * `FrameHead`, any other place's `FramePlace`); and the side panel's toggle
 * at its end. Every pane stands under it with its own top row, the main
 * column's tabs level with the side panel's, and those rows are ordinary
 * bars, no longer the window's handle.
 *
 * The shell draws the bar and hands its room down (`TitleBarRoom`); a page
 * draws its head into it through a portal (`TitleBarPlace`), so the head
 * is the page's own, reading the page's state and pressing the page's acts,
 * and leaves with the page. A page whose bar names it (`PlaceToolbar`)
 * moves the name up and keeps the rest of its bar where it stood. Where no title bar stands (a phone's room, the
 * web's tab, whose window is the browser's, a page drawn alone in a test,
 * the side panel, and the Inbox kept hidden between visits), `useTitleBar`
 * says so, and a page names itself in its own top row as it always has.
 */

import { FramePlace, Toolbar, type ToolbarProps } from "@luke/ui";
import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

/** The window's title bar a page names its place in, where one stands over it. */
const TitleBarSlot = createContext<HTMLElement | null>(null);

/** Hands what it holds the window's title bar to name its place in, or none, where its head is to stand in its own top row. */
export function TitleBarRoom({
  bar,
  children,
}: {
  bar: HTMLElement | null;
  children: ReactNode;
}): React.JSX.Element {
  return <TitleBarSlot value={bar}>{children}</TitleBarSlot>;
}

/** The window's title bar over the page, where one stands; none where the page names itself in its own top row. */
export function useTitleBar(): HTMLElement | null {
  return useContext(TitleBarSlot);
}

/**
 * The page's head, drawn in the window's title bar where one stands; and
 * elsewhere nothing, where the page names itself in its own top row, or,
 * `inline`, the head where it is drawn, as a task's head stands under its
 * column's tabs.
 */
export function TitleBarPlace({
  inline = false,
  children,
}: {
  inline?: boolean;
  children: ReactNode;
}): ReactNode {
  const bar = useTitleBar();
  if (bar !== null) return createPortal(children, bar);
  return inline ? children : null;
}

/**
 * The bar of a page it names: up in the window's title bar where one stands,
 * the name the bar would draw (`FramePlace`), a name picked up from the page's
 * header said there whether or not the header has scrolled away, and under
 * it the bar with all else it holds; the whole bar where none stands.
 */
export function PlaceToolbar({
  title,
  trail,
  pickUp,
  detail,
  ...bar
}: ToolbarProps): React.JSX.Element {
  const up = useTitleBar() !== null;
  if (!up) return <Toolbar title={title} trail={trail} pickUp={pickUp} detail={detail} {...bar} />;
  return (
    <>
      <TitleBarPlace>
        <FramePlace
          title={title}
          trail={trail}
          pickUp={pickUp === undefined ? undefined : { name: pickUp.name, shown: true }}
          detail={detail}
        />
      </TitleBarPlace>
      <Toolbar {...bar} />
    </>
  );
}
