import { useCallback, useRef } from "react";

const LINK_ADDRESSES = new WeakMap<Element, { readonly current: string | undefined }>();

export function linkAddressOf(element: Element): string | undefined {
  return LINK_ADDRESSES.get(element)?.current;
}

export function useLinkAddress(href: string | undefined): (element: Element | null) => void {
  const latest = useRef(href);
  latest.current = href;
  return useCallback((element: Element | null) => {
    if (element !== null) LINK_ADDRESSES.set(element, latest);
  }, []);
}
