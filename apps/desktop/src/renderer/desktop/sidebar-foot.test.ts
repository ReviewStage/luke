// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { UPDATE_STATUS } from "#shared/messages/update";
import { onRegistry } from "#testing/copy-feedback";
import { SidebarFoot } from "./sidebar-foot";

/**
 * The sidebar's foot as the developer meets it: the account's menu holds
 * Settings, Send feedback, and Help, and no option of its own, since every
 * option's home is Settings.
 */

const roots: Root[] = [];

beforeEach(() => {
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

test("the account's menu holds Settings, Send feedback, and Help, and nothing else", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(SidebarFoot, {
          account: {
            status: ACCOUNT_STATUS.SIGNED_IN,
            email: "dev@example.com",
            name: "Dev",
            provider: "github",
          },
          updates: {
            update: {
              status: UPDATE_STATUS.IDLE,
              currentVersion: "1.0.0",
              installSupported: true,
              upToDate: true,
            },
            build: { packaged: false },
            onCheck: () => Promise.resolve(),
            onInstall: () => undefined,
            onOpenLatest: () => undefined,
          },
          shown: true,
          settingsOpen: false,
          onSettings: () => undefined,
        }),
      ),
    ),
  );
  const accountButton =
    container.querySelector<HTMLButtonElement>(".sidebar-account") ??
    assert.fail("the foot draws the account's button");

  act(() => accountButton.click());

  assert.deepEqual(
    [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].map(
      // A row's shortcut, such as Settings' ⌘,, follows its name.
      (item) => item.textContent?.replace(/⌘.*$/u, "").trim(),
    ),
    ["Settings", "Send feedback", "Help"],
  );
});
