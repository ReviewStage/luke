import { HOST_NODE_OPEN_KIND, type HostNodeOpenKind } from "@sidecar/host";

export interface NodeOpenDependencies {
  /** Hands the address to the operating system; a throw is an open that did not land. */
  openExternal: (url: string) => Promise<void>;
  /** A fixture run drives the panel itself, so nothing here moves it. */
  fixtureMode: boolean;
  /** Every expanded panel back to its capsule, the way a row press stands its own down. */
  standPanelsDown: () => void;
}

/**
 * The node's open capability: the address to the operating system, then what
 * this client's own windows owe the open. A session opened at an ask of Luke
 * had no row press to stand a panel down, so the panel is still up over the
 * very chat coming forward, and the client stands it down here — only once
 * the open has landed, because a panel dismissed for an address that never
 * opened would read as though something had. Every other address leaves the
 * windows where they are: the desktop's own opens never cross this node, and
 * a row's press has already stood its panel down.
 */
export function createNodeOpen(
  dependencies: NodeOpenDependencies,
): (url: string, kind: HostNodeOpenKind) => Promise<void> {
  return async (url, kind) => {
    await dependencies.openExternal(url);
    if (kind !== HOST_NODE_OPEN_KIND.ASKED_SESSION || dependencies.fixtureMode) return;
    dependencies.standPanelsDown();
  };
}
