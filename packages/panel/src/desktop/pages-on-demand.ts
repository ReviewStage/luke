import { lazyRoute } from "../lazy-route.js";

/**
 * pages-on-demand.ts -- the window's pages split off the bundle every window parses, each a chunk of its own read the first time it is drawn or hinted at.
 *
 * Settings, Admin, the Board, a person's page, the Automations pages, and a
 * version history are the router's lazy routes (`panel-router.tsx`); this is
 * split here instead because a hover elsewhere in the window reads it early
 * (`lazy-route.ts`): a Pull request tab's card. It is drawn under a
 * `Suspense` whose fallback is its own frame, which offers the page's way
 * out as the page would.
 */

/** An agent's Pull request tab in a side panel, its Files changed and its merge box among it (`agent-pull-request-tab.tsx`). */
export const PULL_REQUEST_TAB = lazyRoute(() =>
  import("../tasks/agent-pull-request-tab.js").then((loaded) => loaded.AgentPullRequestTab),
);
