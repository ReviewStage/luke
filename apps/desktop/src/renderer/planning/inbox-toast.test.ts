// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { MOTION_DURATION_MS } from "@sidecar/surface";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";
import type { AppInboxPlan } from "#shared/messages/app-state";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { ToastHost } from "../toast";
import { useInboxToasts } from "./inbox-toast";

/** An opened item as main hands it to the panels. */
interface InboxItemOpened {
  planId: string;
  itemId: string;
  words: string;
  detail: string;
}

/** What the window stands on: main's word on what waits, and the plan whose Inbox is on screen. */
interface Standing {
  waiting: readonly AppInboxPlan[];
  version: number;
  shownInbox: string | null;
}

const roots: Root[] = [];

/**
 * The window over a bridge that hands it opened items, beside its toasts,
 * what main says waits, and every View pressed, by the plan it opened.
 */
function mount(registry: AtomRegistry) {
  let listener: ((opened: InboxItemOpened) => void) | undefined;
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      onInboxItemOpened: (next: (opened: InboxItemOpened) => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    },
  });
  const viewed: string[] = [];
  function Probe({ waiting, version, shownInbox }: Standing) {
    useInboxToasts((planId) => viewed.push(planId), waiting, version, shownInbox);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const stand = (standing: Standing) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(Fragment, null, createElement(Probe, standing), createElement(ToastHost)),
        ),
      ),
    );
  stand({ waiting: [], version: 0, shownInbox: null });
  return {
    viewed,
    open: (opened: InboxItemOpened) => {
      assert.ok(listener, "the window listens for opened items");
      act(() => listener?.(opened));
    },
    stand,
  };
}

/** Lets what fell due land and redraw. */
const landed = Effect.promise(() =>
  act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  }),
);

/** What each standing toast says, its words alone. */
function said(): (string | null | undefined)[] {
  return [...document.querySelectorAll<HTMLElement>(".toast")].map(
    (toast) => toast.querySelector(".toast-words")?.textContent,
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

it.effect(
  "an item main hands the window is said in an ask's toast under the plan's name, with a View that opens the plan's Inbox, and it stands until dismissed",
  () =>
    Effect.gen(function* () {
      const panel = mount(yield* registryOnTestClock);
      panel.open({
        planId: "plan-1",
        itemId: "item-1",
        words: "Fix invitations: Push to the release branch?",
        detail: "Team invites",
      });
      yield* landed;
      const toast = document.querySelector<HTMLElement>(".toast");
      assert.equal(
        toast?.textContent,
        "Fix invitations: Push to the release branch?Team invitesView",
      );
      assert.equal(toast?.getAttribute("data-tone"), "ask");
      yield* TestClock.adjust(Duration.minutes(10));
      yield* landed;
      assert.equal(said().length, 1, "still standing");

      const view = toast?.querySelector("button");
      assert.ok(view);
      act(() => view.click());
      assert.deepEqual(panel.viewed, ["plan-1"]);
    }),
);

it.effect(
  "an item's toast goes once what waits, as main next says it, no longer holds it, or once its plan's Inbox comes on screen, and stands while the item still waits elsewhere",
  () =>
    Effect.gen(function* () {
      const panel = mount(yield* registryOnTestClock);
      panel.open({ planId: "plan-1", itemId: "item-1", words: "Answered elsewhere", detail: "A" });
      panel.open({ planId: "plan-2", itemId: "item-2", words: "Its Inbox shown", detail: "B" });
      panel.open({ planId: "plan-3", itemId: "item-3", words: "Still asking", detail: "C" });
      yield* landed;
      assert.equal(said().length, 3);

      // Main's next word: item-1 was answered before it reached the window.
      panel.stand({
        waiting: [
          { planId: "plan-2", items: ["item-2"] },
          { planId: "plan-3", items: ["item-3"] },
        ],
        version: 1,
        shownInbox: null,
      });
      panel.stand({
        waiting: [
          { planId: "plan-2", items: ["item-2"] },
          { planId: "plan-3", items: ["item-3"] },
        ],
        version: 1,
        shownInbox: "plan-2",
      });
      yield* TestClock.adjust(Duration.millis(MOTION_DURATION_MS.EXIT));
      yield* landed;
      assert.deepEqual(said(), ["Still asking"]);
    }),
);
