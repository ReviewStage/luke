/**
 * link-address.ts -- the address a control that opens one opens, kept beside its element for the window's link menu rather than on it.
 *
 * A right-click on an `<a href>` is a right-click on a link, and so is one
 * on a chip, a row, or a button that opens a page: the window answers both
 * with the link's own menu (Open link, Copy link). An anchor names its
 * address; a control hands it here by its ref (`useLinkAddress`), and the
 * menu reads it back from the element clicked (`linkAddressOf`). Note that
 * it is kept here rather than on an attribute, because the window's
 * recording masks only the attributes that carry words
 * (`@luke/panel`'s `session-replay.ts`), and an address may carry a token.
 */

import { useCallback, useRef } from "react";

/** The address each control opens, by its element, read as it stands now. */
const LINK_ADDRESSES = new WeakMap<Element, { readonly current: string | undefined }>();

/** The address `element` opens, where a control handed one; nothing otherwise. */
export function linkAddressOf(element: Element): string | undefined {
  return LINK_ADDRESSES.get(element)?.current;
}

/** The ref of a control that opens `href`, which hands the address to the link menu; nothing is handed for none. */
export function useLinkAddress(href: string | undefined): (element: Element | null) => void {
  const latest = useRef(href);
  latest.current = href;
  return useCallback((element: Element | null) => {
    if (element !== null) LINK_ADDRESSES.set(element, latest);
  }, []);
}
