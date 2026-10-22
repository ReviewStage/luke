import { lazyRoute } from "../lazy-route.js";

/**
 * pages-on-demand.ts -- the window's pages most launches never open, each a chunk of its own read the first time it is drawn or hinted at.
 *
 * Settings, the Automations pages, and the Board are split off where they
 * are drawn (`desktop-shell.tsx`); these are split here instead because a
 * hover elsewhere in the window reads them early (`lazy-route.ts`): the
 * sidebar's Admin row, a plan's Version history item, a person's card, and a Pull request tab's card. The Admin place's chunk
 * carries its charts, so an account that is no admin never reads it. Each is drawn under a `Suspense` whose fallback
 * is its own frame, which offers the page's way out as the page would.
 */

/** The Admin place, an admin's alone, over the whole window as Settings is (`desktop-admin.tsx`). */
export const ADMIN_PLACE = lazyRoute(() =>
  import("./desktop-admin.js").then((loaded) => loaded.DesktopAdmin),
);

/** The open plan's version history, over the whole window (`desktop-version-history.tsx`). */
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
