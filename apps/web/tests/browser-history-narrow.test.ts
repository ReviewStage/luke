// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { RUN_PROFILE } from "@repo/host/app-state";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, vi } from "vitest";
import { drawPanel, installPanelDoors, openAt, unmountPanels } from "./support/web-panel";

/**
 * On a phone's width the task's header leads with the way back to the page
 * it was opened from, Home where the tab opened on the task
 * (`browser-history-narrow-panel.test.ts` holds a tab of the side panel
 * pushed over it). Its own file, because the panel's state lives as long as the page does, as a tab's
 * does.
 */

/** A phone's width, narrower than the panel stands two panes side by side at. */
const PHONE_WIDTH = 390;

/** Whether a tab of the side panel stands pushed over the task's column, as it does once the panel opens on a phone. */
async function panelPushed(): Promise<boolean> {
  await act(async () => undefined);
  return document.querySelector("aside.side-panel") !== null;
}

/** The way back leading the phone's task's header. */
function back(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(".task-head .ui-toolbar-lead button");
  assert.ok(found, "the task's header leads with its way back");
  return found;
}

afterEach(() => {
  unmountPanels();
  vi.restoreAllMocks();
});

it.effect(
  "on a phone's width a task the tab opened on, with no page behind it, leads with the way to Home",
  () =>
    Effect.gen(function* () {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, PHONE_WIDTH, 800),
      );
      openAt("/app");
      installPanelDoors(RUN_PROFILE.TASKS);
      yield* Effect.promise(async () => {
        await drawPanel();
        assert.equal(await panelPushed(), false);
        // Note that the press is not taken here, because a fixture run keeps its task open (`use-tasks-tab.ts`'s `leaveTask`); `use-tasks-tab.test.ts` leaves it.
        assert.equal(back().textContent, "Home");
      });
    }),
);
