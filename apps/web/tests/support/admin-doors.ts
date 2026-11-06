import { onRegistry } from "@repo/panel/testing/copy-feedback";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createElement, type ReactElement } from "react";
import { WebAdminDoors } from "../../src/admin/web-admin-doors";

/** An admin screen under the standalone page's own doors, in its `main` region, as `/admin` mounts it, on the test's own Query client. */
export function underWebAdminDoors(element: ReactElement): ReactElement {
  return onRegistry(
    AtomRegistry.make(),
    createElement(WebAdminDoors, null, createElement("main", null, element)),
  );
}
