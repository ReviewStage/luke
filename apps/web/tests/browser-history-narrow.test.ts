// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { RUN_PROFILE } from "@repo/host/app-state";
import { appStateFirstRead } from "@repo/panel/use-app-state";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, vi } from "vitest";
import { drawPanel, installPanelDoors, openAt, unmountPanels } from "./support/web-panel";

const PHONE_WIDTH = 390;

async function panelPushed(): Promise<boolean> {
  await act(async () => undefined);
  return document.querySelector("aside.side-panel") !== null;
}

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
      yield* appStateFirstRead;
      yield* Effect.promise(async () => {
        await drawPanel();
        assert.equal(await panelPushed(), false);
        assert.equal(back().textContent, "Home");
      });
    }),
);
