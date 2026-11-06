import { dropBelowStart, linkAddressOf, MENU_ALIGN, type MenuPlacement, useMenu } from "@repo/ui";
import { ExternalLinkIcon, LinkIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LINK_COPY, useCopyToast } from "./copy-feedback.js";
import { ActionMenu } from "./desktop/action-menu.js";
import { linkedPageInBrowserItem } from "./open-in-browser-item.js";
import { opensAsLink, useOpenLink } from "./tasks/use-open-link.js";

interface HeardLink {
  readonly href: string;
  readonly element: HTMLElement;
}

const LINK_MENU_LABEL = "Link";

const OPEN_LINK_LABEL = "Open link";

function inEditedWords(element: Element): boolean {
  const said = element.closest("[contenteditable]");
  return said !== null && said.getAttribute("contenteditable") !== "false";
}

const EDITED_LINK_OPENERS = new WeakMap<Element, (href: string) => void>();

function editedLinkOpenerOf(element: Element): ((href: string) => void) | undefined {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    const open = EDITED_LINK_OPENERS.get(at);
    if (open !== undefined) return open;
  }
  return undefined;
}

function addressOf(element: Element): string | undefined {
  if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) return element.href;
  return linkAddressOf(element);
}

function linkAt(target: EventTarget | null): HeardLink | undefined {
  for (let at = target instanceof Element ? target : null; at !== null; at = at.parentElement) {
    const href = addressOf(at);
    if (href === undefined || !(at instanceof HTMLElement)) continue;
    return opensAsLink(href) ? { href, element: at } : undefined;
  }
  return undefined;
}

function placementOf(event: MouseEvent, element: HTMLElement): MenuPlacement {
  if (event.clientX === 0 && event.clientY === 0) return dropBelowStart(element);
  return { x: event.clientX, y: event.clientY, align: MENU_ALIGN.START };
}

export function LinkMenu(): React.JSX.Element | null {
  const { drawn, show, close } = useMenu(true);
  const [link, setLink] = useState<HeardLink | undefined>(undefined);
  const openLink = useOpenLink();
  const copy = useCopyToast();

  useEffect(() => {
    const heard = (event: MouseEvent) => {
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
  const inBrowser = linkedPageInBrowserItem(href);
  return (
    <ActionMenu
      label={LINK_MENU_LABEL}
      menu={drawn}
      replayUnmasked
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
          ...(inBrowser === undefined ? [] : [inBrowser]),
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

export function useEditedLinksHost(): (element: Element | null) => void {
  const openLink = useOpenLink();
  const latest = useRef(openLink);
  latest.current = openLink;
  return useCallback((element: Element | null) => {
    if (element !== null) EDITED_LINK_OPENERS.set(element, (href) => latest.current(href));
  }, []);
}
