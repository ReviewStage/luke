/**
 * link-menu.tsx -- a right-click on any link in the window: Open link and Copy link, hung at the pointer.
 *
 * A link is an `<a href>`, or a control that opens an address and handed it
 * by its ref (`@luke/ui`'s `useLinkAddress`): a mention's chip, a pull
 * request's row, a check's row. The window hears every right-click once, at the document, after
 * whatever was clicked heard it, so a row or a tab that hangs a menu of its
 * own keeps it; a right-click that lands on a link and nothing else's menu
 * hangs the link's. Open link is the link's own press, so it opens where a
 * click would, in the panel beside an Inbox item or a task's pull request
 * tab as much as in the browser. A link in words being edited opens through
 * the opener of the place the words stand in (`useEditedLinksHost`), as a
 * press on the same link drawn there would, because a press in the editor
 * only places the caret; the window's own where no place said one. Copy
 * link copies the address as written and says Link copied, as every menu's
 * copy does.
 */

import { dropBelowStart, linkAddressOf, MENU_ALIGN, type MenuPlacement, useMenu } from "@luke/ui";
import { ExternalLinkIcon, LinkIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LINK_COPY, useCopyToast } from "./copy-feedback.js";
import { ActionMenu } from "./desktop/action-menu.js";
import { opensAsLink, useOpenLink } from "./tasks/use-open-link.js";

/** What a right-click on a link is on: the address, and the link Open link presses. */
interface HeardLink {
  readonly href: string;
  readonly element: HTMLElement;
}

/** The words the menu is announced by. */
const LINK_MENU_LABEL = "Link";

/** What the menu's opening item is called. */
const OPEN_LINK_LABEL = "Open link";

/**
 * Whether `element` stands in words being edited: the nearest element that
 * says whether it is editable says it is. Note that a node the editor holds
 * fixed, a mention's chip in a plan being edited, says it is not, so the
 * chip's own press opens it, as a click would.
 */
function inEditedWords(element: Element): boolean {
  const said = element.closest("[contenteditable]");
  return said !== null && said.getAttribute("contenteditable") !== "false";
}

/** The opener of each place holding words being edited, by the element that holds them (`useEditedLinksHost`). */
const EDITED_LINK_OPENERS = new WeakMap<Element, (href: string) => void>();

/** The opener of the nearest place around `element` that holds words being edited and said one; none where none did. */
function editedLinkOpenerOf(element: Element): ((href: string) => void) | undefined {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    const open = EDITED_LINK_OPENERS.get(at);
    if (open !== undefined) return open;
  }
  return undefined;
}

/** The address `element` is a link to: an anchor's, read resolved as a click would follow it, or the one a control handed; nothing for any other. */
function addressOf(element: Element): string | undefined {
  if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) return element.href;
  return linkAddressOf(element);
}

/** The nearest link a right-click landed on or in, where its address is one the window opens; nothing otherwise. */
function linkAt(target: EventTarget | null): HeardLink | undefined {
  for (let at = target instanceof Element ? target : null; at !== null; at = at.parentElement) {
    const href = addressOf(at);
    if (href === undefined || !(at instanceof HTMLElement)) continue;
    return opensAsLink(href) ? { href, element: at } : undefined;
  }
  return undefined;
}

/** Where the menu hangs: at the pointer, or under the link for the menu key, which says no point. */
function placementOf(event: MouseEvent, element: HTMLElement): MenuPlacement {
  if (event.clientX === 0 && event.clientY === 0) return dropBelowStart(element);
  return { x: event.clientX, y: event.clientY, align: MENU_ALIGN.START };
}

/**
 * The window's one link menu, drawn wherever a right-click on a link hangs
 * it. It is mounted once, at the window's root, under the window's opener
 * for a place in Luke and its toast.
 */
export function LinkMenu(): React.JSX.Element | null {
  const { drawn, show, close } = useMenu(true);
  const [link, setLink] = useState<HeardLink | undefined>(undefined);
  const openLink = useOpenLink();
  const copy = useCopyToast();

  useEffect(() => {
    const heard = (event: MouseEvent) => {
      // A menu of the clicked thing's own, a row's or a tab's, already answered it.
      if (event.defaultPrevented) return;
      const found = linkAt(event.target);
      if (found === undefined) return;
      event.preventDefault();
      setLink(found);
      show(placementOf(event, found.element), found.element);
    };
    document.addEventListener("contextmenu", heard);
    return () => document.removeEventListener("contextmenu", heard);
  }, [show]);

  if (drawn === undefined || link === undefined) return null;
  const { href, element } = link;
  return (
    <ActionMenu
      label={LINK_MENU_LABEL}
      menu={drawn}
      onClose={close}
      groups={[
        [
          {
            label: OPEN_LINK_LABEL,
            icon: <ExternalLinkIcon aria-hidden="true" />,
            onSelect: () => {
              if (!inEditedWords(element)) element.click();
              else (editedLinkOpenerOf(element) ?? openLink)(href);
            },
          },
          {
            label: LINK_COPY.LABEL,
            icon: <LinkIcon aria-hidden="true" />,
            onSelect: () => copy(href, LINK_COPY.COPIED),
          },
        ],
      ]}
    />
  );
}

/**
 * The ref of an element holding words being edited, a plan's body or a
 * composer's field: a link in them that the link menu opens opens through
 * the opener where the element stands, the place's own around it
 * (`OpenHereProvider`) included, as a press on the link drawn there would.
 */
export function useEditedLinksHost(): (element: Element | null) => void {
  const openLink = useOpenLink();
  const latest = useRef(openLink);
  latest.current = openLink;
  return useCallback((element: Element | null) => {
    if (element !== null) EDITED_LINK_OPENERS.set(element, (href) => latest.current(href));
  }, []);
}
