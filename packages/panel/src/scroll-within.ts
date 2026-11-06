export function centerWithin(lines: HTMLElement, target: HTMLElement): void {
  const box = lines.getBoundingClientRect();
  const line = target.getBoundingClientRect();
  lines.scrollTop += line.top + line.height / 2 - (box.top + box.height / 2);
}

export function revealWithin(lines: HTMLElement, target: HTMLElement): void {
  const box = lines.getBoundingClientRect();
  const line = target.getBoundingClientRect();
  if (line.top < box.top) lines.scrollTop -= box.top - line.top;
  else if (line.bottom > box.bottom) lines.scrollTop += line.bottom - box.bottom;
}

export function scrollerOf(element: HTMLElement): HTMLElement | undefined {
  for (let box = element.parentElement; box !== null; box = box.parentElement) {
    const { overflowY } = window.getComputedStyle(box);
    if ((overflowY === "auto" || overflowY === "scroll") && box.scrollHeight > box.clientHeight) {
      return box;
    }
  }
  return undefined;
}
