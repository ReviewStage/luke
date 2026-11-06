import { createPanelRouter, PanelRouterProvider } from "@repo/panel/panel-router";
import { queryClient } from "@repo/panel/query-client";
import { createMemoryHistory } from "@tanstack/react-router";
import { mountWindow } from "./window-root";

const WINDOW_START_ADDRESS = "/app";

const router = createPanelRouter(
  createMemoryHistory({ initialEntries: [WINDOW_START_ADDRESS] }),
  queryClient,
);

mountWindow(<PanelRouterProvider router={router} />, { timesStart: true });
