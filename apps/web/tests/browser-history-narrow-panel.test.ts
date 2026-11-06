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

const PHONE_WIDTH = 390;

async function panelPushed(): Promise<boolean> {
  await act(async () => undefined);
  return document.querySelector("aside.side-panel") !== null;
}

function pullRequestCard(): HTMLElement {
  const found = document.querySelector<HTMLElement>(".agent-published .ui-list-row-main");
  assert.ok(found, "the agent's pull request stands over its composer");
  return found;
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
  "on a phone's width the way back and the browser's Back each shut a tab of the side panel pushed over the agent, as Escape does, without a step of their own, and Forward opens it again",
  () =>
    Effect.gen(function* () {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, PHONE_WIDTH, 800),
      );
      openAt("/app");
      installPanelDoors(RUN_PROFILE.AGENT_PULL_REQUEST);
      yield* appStateFirstRead;
      yield* Effect.promise(async () => {
        await drawPanel();
        assert.equal(await panelPushed(), true);
        await act(async () => back().click());
        await settle();
        assert.equal(await panelPushed(), false, "the agent's screen stands");
        const column = addressBar();
        await act(async () => pullRequestCard().click());
        await settle();
        assert.equal(await panelPushed(), true);
        assert.equal(back().getAttribute("aria-label"), "Back to Add teammate invitations");
        const shown = addressBar();
        const entries = window.history.length;

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

        await travel(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
        assert.equal(await panelPushed(), false, "Escape shuts the side panel");
        assert.equal(addressBar(), column);
        assert.equal(window.history.length, entries, "and pushes nothing");
      });
    }),
);
