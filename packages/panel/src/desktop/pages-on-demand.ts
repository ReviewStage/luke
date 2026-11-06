import { lazyRoute } from "../lazy-route.js";

/**
 * pages-on-demand.ts -- the window's pages split off the bundle every window parses, each a chunk of its own read the first time it is drawn or hinted at.
 *
 * The Automations pages are split off where they are drawn
 * (`desktop-shell.tsx`), and Settings and Admin are the router's lazy routes
 * (`panel-router.tsx`); these are split here instead because a hover
 * elsewhere in the window reads them early (`lazy-route.ts`): the sidebar's
 * Tasks row, a plan's Version history item, a person's card, and a Pull request tab's card. Each is drawn under a `Suspense` whose fallback
 * is its own frame, which offers the page's way out as the page would.
 */

/** The Tasks page, its List and its Board, in the task's place (`tasks-page.tsx`); read too once the signed-in window is idle, so its first open finds it landed. */
export const TASKS_ROUTE = lazyRoute(() =>
  import("./tasks-page.js").then((loaded) => loaded.TasksPage),
);

/** The open description's version history, over the whole window (`desktop-version-history.tsx`). */
export const VERSION_HISTORY = lazyRoute(() =>
  import("./desktop-version-history.js").then((loaded) => loaded.TaskVersionHistory),
);

/** A person's page, in the task's place (`person-page.tsx`). */
export const PERSON_PAGE = lazyRoute(() =>
  import("./person-page.js").then((loaded) => loaded.PersonPage),
);

/** An agent's Pull request tab in a side panel, its Files changed and its merge box among it (`agent-pull-request-tab.tsx`). */
export const PULL_REQUEST_TAB = lazyRoute(() =>
  import("../tasks/agent-pull-request-tab.js").then((loaded) => loaded.AgentPullRequestTab),
);
