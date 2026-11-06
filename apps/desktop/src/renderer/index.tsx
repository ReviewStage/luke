/**
 * index.tsx -- the panel window's entry: `App`, under the window's own router.
 *
 * Loaded by `index.html` alone. `App` is where session replay starts, and
 * this is the window whose start is timed.
 */

import { createPanelRouter } from "@repo/panel/panel-router";
import { queryClient } from "@repo/panel/query-client";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { mountWindow } from "./window-root";

/** The address a window opens at: the panel's own, which names no place, as a step with no link is held at. */
const WINDOW_START_ADDRESS = "/app";

// Note that the router keeps its history in memory, because the window is loaded from a file or a dev server rather than at an address of ours;
// the panel's back and forward live there for as long as the window is open.
const router = createPanelRouter(
  createMemoryHistory({ initialEntries: [WINDOW_START_ADDRESS] }),
  queryClient,
);

// The panel is the window a person waits on, so it alone times its start.
mountWindow(<RouterProvider router={router} />, { timesStart: true });
