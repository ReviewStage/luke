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
