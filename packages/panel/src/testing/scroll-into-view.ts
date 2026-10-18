/**
 * scroll-into-view.ts -- jsdom lays nothing out, so it has no `scrollIntoView`; a menu that brings its highlighted row into view needs one that does nothing.
 */
export function installScrollIntoView(): void {
  Element.prototype.scrollIntoView = () => undefined;
}
