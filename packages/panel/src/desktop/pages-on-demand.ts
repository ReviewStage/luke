import { lazyRoute } from "../lazy-route.js";

/**
 * pages-on-demand.ts -- the window's pages split off the bundle every window parses, each a chunk of its own read the first time it is drawn or hinted at.
 *
 * The Automations pages are split off where they are drawn
 * (`desktop-shell.tsx`), and Settings, Admin, the Board, and a person's page
 * are the router's lazy routes (`panel-router.tsx`); these are split here
 * instead because a hover elsewhere in the window reads them early
 * (`lazy-route.ts`): a plan's Version history item and a Pull request tab's
 * card. Each is drawn under a `Suspense` whose fallback is its own frame,
 * which offers the page's way out as the page would.
 */

/** The open plan's version history, over the whole window (`desktop-version-history.tsx`). */
export const VERSION_HISTORY = lazyRoute(() =>
  import("./desktop-version-history.js").then((loaded) => loaded.TaskVersionHistory),
);

/** An agent's Pull request tab in a side panel, its Files changed and its merge box among it (`agent-pull-request-tab.tsx`). */
export const PULL_REQUEST_TAB = lazyRoute(() =>
  import("../tasks/agent-pull-request-tab.js").then((loaded) => loaded.AgentPullRequestTab),
);
