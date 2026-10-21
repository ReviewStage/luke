import { createElement, type ReactElement } from "react";
import { WebAdminDoors } from "../../src/admin/web-admin-doors";

/** An admin screen under the standalone page's own doors, as `/admin` mounts it. */
export function underWebAdminDoors(element: ReactElement): ReactElement {
  return createElement(WebAdminDoors, null, element);
}
