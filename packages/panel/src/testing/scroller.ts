/**
 * scroller.ts -- a scroller laid out as the browser would lay it, for a list drawing only the rows near the view (`VirtualRows`), since jsdom lays nothing out.
 *
 * A run brought to a row it does not draw scrolls its scroller there, which
 * TanStack Virtual holds within the scroller's reach, `scrollHeight` less
 * `clientHeight`; jsdom answers 0 for both, so nothing would move. The
 * scroller is given a view and a length to scroll, and a write to its scroll
 * is heard as a scroll, as the browser hears one.
 */

/** Lays `box` out as a scroller `view` pixels tall over `length` pixels of rows. */
export function layScrollerOut(box: HTMLElement, view: number, length: number): void {
  let top = 0;
  Object.defineProperty(box, "clientHeight", { configurable: true, get: () => view });
  Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => length });
  Object.defineProperty(box, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (to: number) => {
      top = to;
      box.dispatchEvent(new Event("scroll"));
    },
  });
  box.scrollTo = ((options: ScrollToOptions) => {
    box.scrollTop = options.top ?? top;
  }) as typeof box.scrollTo;
}
