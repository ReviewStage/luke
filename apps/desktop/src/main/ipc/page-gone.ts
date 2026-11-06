type PageEvents = Pick<NodeJS.EventEmitter, "on" | "off">;

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
