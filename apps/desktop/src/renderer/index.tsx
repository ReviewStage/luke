/**
 * index.tsx -- the panel window's entry: `App`.
 *
 * Loaded by `index.html` alone. `App` is where session replay starts, and
 * this is the window whose page Sentry watches for freezes.
 */

import { App } from "@luke/panel/app";
import { installWindowHistory } from "@luke/panel/navigation-history";
import { memoryHistory } from "@luke/ui/history-adapter";
import { mountWindow } from "./window-root";

// The panel's back and forward live in memory for as long as the window is open.
installWindowHistory(memoryHistory());

mountWindow(
  <App />,
  // The panel is the window a person waits on, so it alone reports a freeze
  // and times its start.
  { reportsFreezes: true },
  { timesStart: true },
);
