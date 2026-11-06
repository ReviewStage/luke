export function installScrollIntoView(): void {
  Element.prototype.scrollIntoView = () => undefined;
}
