import { lazyRoute } from "../lazy-route.js";

export const VERSION_HISTORY = lazyRoute(() =>
  import("./desktop-version-history.js").then((loaded) => loaded.TaskVersionHistory),
);

export const PULL_REQUEST_TAB = lazyRoute(() =>
  import("../tasks/agent-pull-request-tab.js").then((loaded) => loaded.AgentPullRequestTab),
);
