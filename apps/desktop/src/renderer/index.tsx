/**
 * index.tsx -- the panel window's entry: `App`.
 *
 * Loaded by `index.html` alone. `App` is where session replay starts, and
 * this is the window whose start is timed.
 */

import { App } from "@luke/panel/app";
import { installWindowHistory } from "@luke/panel/navigation-history";
import { memoryHistory } from "@luke/ui/history-adapter";
import { mountWindow } from "./window-root";

// The panel's back and forward live in memory for as long as the window is open.
installWindowHistory(memoryHistory());

// The panel is the window a person waits on, so it alone times its start.
mountWindow(<App />, { timesStart: true });
