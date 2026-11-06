export function replayMotion(
  element: HTMLElement,
  attribute: string,
  mover: Element = element,
  value = "true",
): void {
  element.removeAttribute(attribute);
  void element.offsetWidth;
  element.setAttribute(attribute, value);
  const ended = (event: Event) => {
    if (event.target !== mover) return;
    element.removeAttribute(attribute);
    element.removeEventListener("animationend", ended);
  };
  element.addEventListener("animationend", ended);
}
