import { onRegistry } from "@repo/panel/testing/copy-feedback";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createElement, type ReactElement } from "react";
import { expect, vi } from "vitest";
import { WebAdminDoors } from "../../src/admin/web-admin-doors";

export function underWebAdminDoors(element: ReactElement): ReactElement {
  return onRegistry(
    AtomRegistry.make(),
    createElement(WebAdminDoors, null, createElement("main", null, element)),
  );
}

export async function readLanded(page: HTMLElement): Promise<void> {
  await vi.waitFor(() =>
    expect(page.querySelector('[role="status"][aria-busy="true"]')).toBeNull(),
  );
}
