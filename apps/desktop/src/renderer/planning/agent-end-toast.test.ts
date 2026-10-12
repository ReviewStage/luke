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
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { ToastHost } from "../toast";
import { useAgentEndToasts } from "./agent-end-toast";

/** An end as main hands it to the panels. */
interface AgentEnded {
  planId: string;
  agentId: string;
  words: string;
  detail: string;
  failed: boolean;
}

const roots: Root[] = [];

/**
 * The window over a bridge that hands it agent ends, beside its toasts, the
 * agents it is told ended unseen, and every View pressed, by the plan and
 * agent it opened.
 */
function mount(registry: AtomRegistry) {
  let listener: ((ended: AgentEnded) => void) | undefined;
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      onAgentEnded: (next: (ended: AgentEnded) => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    },
  });
  const viewed: [string, string][] = [];
  function Probe({ unseen }: { unseen: readonly string[] }) {
    useAgentEndToasts((planId, agentId) => viewed.push([planId, agentId]), unseen);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (unseen: readonly string[]) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(Fragment, null, createElement(Probe, { unseen }), createElement(ToastHost)),
        ),
      ),
    );
  draw([]);
  return {
    viewed,
    end: (ended: AgentEnded) => {
      assert.ok(listener, "the window listens for agent ends");
      act(() => listener?.(ended));
    },
    unseen: draw,
  };
}

/** Lets what fell due land and redraw. */
const landed = Effect.promise(() =>
  act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  }),
);

function toasts(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".toast")];
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

it.effect(
  "an agent's end main hands the window is said in a toast under the plan's name, with a View that opens the plan on that agent's tab, a failure in the failed tone, and it stands until dismissed",
  () =>
    Effect.gen(function* () {
      const panel = mount(yield* registryOnTestClock);
      panel.end({
        planId: "plan-1",
        agentId: "agent-1",
        words: "Claude Opus 5.5 opened #12",
        detail: "Team invites",
        failed: false,
      });
      yield* landed;
      const [toast] = toasts();
      assert.equal(toast?.textContent, "Claude Opus 5.5 opened #12Team invitesView");
      assert.equal(toast?.getAttribute("data-tone"), "done");
      yield* TestClock.adjust(Duration.minutes(10));
      yield* landed;
      assert.equal(toasts().length, 1, "still standing");

      panel.end({
        planId: "plan-2",
        agentId: "agent-2",
        words: "Fix invitations failed",
        detail: "Billing",
        failed: true,
      });
      yield* landed;
      const failed = toasts()[1];
      assert.equal(failed?.getAttribute("data-tone"), "failed");
      const view = failed?.querySelector("button");
      assert.ok(view);
      act(() => view.click());
      assert.deepEqual(panel.viewed, [["plan-2", "agent-2"]]);
    }),
);

it.effect(
  "an agent's toast goes the moment its unseen dot clears, by whatever route its tab was shown, and an agent never dotted takes none away",
  () =>
    Effect.gen(function* () {
      const panel = mount(yield* registryOnTestClock);
      panel.unseen(["agent-1", "agent-2"]);
      panel.end({
        planId: "plan-1",
        agentId: "agent-1",
        words: "Opus 5.5 finished",
        detail: "Team invites",
        failed: false,
      });
      panel.end({
        planId: "plan-1",
        agentId: "agent-2",
        words: "GPT 5.6 Sol finished",
        detail: "Team invites",
        failed: false,
      });
      // The third end's dot has not reached the window yet.
      panel.end({
        planId: "plan-2",
        agentId: "agent-3",
        words: "Fix invitations failed",
        detail: "Billing",
        failed: true,
      });
      yield* landed;
      assert.equal(toasts().length, 3);

      panel.unseen(["agent-2"]);
      yield* TestClock.adjust(Duration.millis(MOTION_DURATION_MS.EXIT));
      yield* landed;
      assert.deepEqual(
        toasts().map((toast) => toast.querySelector(".toast-words")?.textContent),
        ["GPT 5.6 Sol finished", "Fix invitations failed"],
      );
    }),
);
