// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { RUN_PROFILE } from "@repo/host/app-state";
import { appStateFirstRead } from "@repo/panel/use-app-state";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, vi } from "vitest";
import {
  addressBar,
  drawPanel,
  installPanelDoors,
  openAt,
  settle,
  travel,
  unmountPanels,
} from "./support/web-panel";

/**
 * On a phone's width a tab of the side panel pushed over the task's column,
 * as the agent's pull request card pushes its Pull request tab, is a step of
 * the tab's own history, shut by the task's header's way back, which the
 * browser's Back shuts and its Forward opens again, without a step of
 * either's own. Its own file, because the panel's state lives as long as the
 * page does, as a tab's does.
 */

/** A phone's width, narrower than the panel stands two panes side by side at. */
const PHONE_WIDTH = 390;

/** Whether a tab of the side panel stands pushed over the task's column, as it does once the panel opens on a phone. */
async function panelPushed(): Promise<boolean> {
  await act(async () => undefined);
  return document.querySelector("aside.side-panel") !== null;
}

/** The pull request's card over the agent's composer, whose press pushes its Pull request tab. */
function pullRequestCard(): HTMLElement {
  const found = document.querySelector<HTMLElement>(".agent-published .ui-list-row-main");
  assert.ok(found, "the agent's pull request stands over its composer");
  return found;
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
  "on a phone's width the way back and the browser's Back each shut a tab of the side panel pushed over the agent, as Escape does, without a step of their own, and Forward opens it again",
  () =>
    Effect.gen(function* () {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, PHONE_WIDTH, 800),
      );
      openAt("/app");
      // The profile opens the fixture's task on its agent, its Pull request tab pushed over it.
      installPanelDoors(RUN_PROFILE.AGENT_PULL_REQUEST);
      yield* appStateFirstRead;
      yield* Effect.promise(async () => {
        await drawPanel();
        // The profile opens its Pull request tab over the agent, which the way back shuts.
        assert.equal(await panelPushed(), true);
        await act(async () => back().click());
        await settle();
        assert.equal(await panelPushed(), false, "the agent's screen stands");
        const column = addressBar();
        // The pull request's card pushes its tab over the agent, which the header's way back names.
        await act(async () => pullRequestCard().click());
        await settle();
        assert.equal(await panelPushed(), true);
        assert.equal(back().getAttribute("aria-label"), "Back to Add teammate invitations");
        const shown = addressBar();
        const entries = window.history.length;

        // The way back steps back to the column as Back does, its traversal awaited so no later travel hears it.
        await travel(() => back().click());
        assert.equal(await panelPushed(), false, "the way back shuts the side panel");
        assert.equal(addressBar(), column);
        assert.equal(window.history.length, entries, "and pushes nothing");
        await travel(() => window.history.forward());
        assert.equal(addressBar(), shown, "Forward opens it again");

        await travel(() => window.history.back());
        assert.equal(await panelPushed(), false, "Back shuts the side panel");
        assert.equal(addressBar(), column);
        assert.equal(window.history.length, entries, "and pushes nothing");

        await travel(() => window.history.forward());
        assert.equal(await panelPushed(), true, "Forward opens it again");
        assert.equal(addressBar(), shown);

        // Escape is one more way out, which steps back the same way.
        await travel(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
        assert.equal(await panelPushed(), false, "Escape shuts the side panel");
        assert.equal(addressBar(), column);
        assert.equal(window.history.length, entries, "and pushes nothing");
      });
    }),
);
