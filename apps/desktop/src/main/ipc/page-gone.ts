/**
 * page-gone.ts -- when the page a window's contents hold is gone, which ends every port main posted to it: the Terminal tab's, a cloud Browser tab's, and a run on this Mac's.
 */

/** The events of a window's contents that end the page a port was posted to. */
type PageEvents = Pick<NodeJS.EventEmitter, "on" | "off">;

/**
 * Calls `then` once the page behind a window's contents is gone: the
 * contents destroyed, its renderer gone, or the window navigated to a new
 * document, which a reload is. The contents outlive a reload, and the ports
 * posted to the page before it do not, so a reload is as much an end as a
 * close. A navigation within the same document, or of a frame inside it,
 * keeps the page.
 */
export function whenPageGone(contents: PageEvents, then: () => void): void {
  const navigated = (details: {
    readonly isMainFrame: boolean;
    readonly isSameDocument: boolean;
  }) => {
    if (details.isMainFrame && !details.isSameDocument) gone();
  };
  const gone = () => {
    contents.off("did-start-navigation", navigated);
    contents.off("render-process-gone", gone);
    contents.off("destroyed", gone);
    then();
  };
  contents.on("did-start-navigation", navigated);
  contents.on("render-process-gone", gone);
  contents.on("destroyed", gone);
}
