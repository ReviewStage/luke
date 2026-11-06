import { createElement, type ReactElement } from "react";
import { WebAdminDoors } from "../../src/admin/web-admin-doors";
import { onQueryClient } from "./query-client";

/** An admin screen under the standalone page's own doors, in its `main` region, on a Query client, as `/admin` mounts it. */
export function underWebAdminDoors(element: ReactElement): ReactElement {
  return onQueryClient(createElement(WebAdminDoors, null, createElement("main", null, element)));
}
