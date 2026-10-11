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
  failed: boolean;
}

const roots: Root[] = [];

/**
 * The window over a bridge that hands it agent ends, beside its toast, and
 * every View pressed, by the plan and agent it opened.
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
  function Probe() {
    useAgentEndToasts((planId, agentId) => viewed.push([planId, agentId]));
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const surface = createElement(Fragment, null, createElement(Probe), createElement(ToastHost));
  act(() => root.render(onRegistry(registry, surface)));
  return {
    viewed,
    end: (ended: AgentEnded) => {
      assert.ok(listener, "the window listens for agent ends");
      act(() => listener?.(ended));
    },
  };
}

/** Lets what fell due land and redraw. */
const landed = Effect.promise(() =>
  act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  }),
);

function toast(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".toast");
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

it.effect(
  "an agent's end main hands the window is said in its toast with a View that opens the plan on that agent's tab, a failure in the failed tone, and it leaves on its own",
  () =>
    Effect.gen(function* () {
      const panel = mount(yield* registryOnTestClock);
      panel.end({
        planId: "plan-1",
        agentId: "agent-1",
        words: "Claude Opus 5.5 opened #12",
        failed: false,
      });
      yield* landed;
      assert.equal(toast()?.textContent, "Claude Opus 5.5 opened #12View");
      assert.equal(toast()?.getAttribute("data-tone"), "done");
      yield* TestClock.adjust(Duration.millis(5_000 + MOTION_DURATION_MS.EXIT));
      yield* landed;
      assert.equal(toast(), null);

      panel.end({
        planId: "plan-2",
        agentId: "agent-2",
        words: "Fix invitations failed",
        failed: true,
      });
      yield* landed;
      assert.equal(toast()?.getAttribute("data-tone"), "failed");
      const view = toast()?.querySelector("button");
      assert.ok(view);
      act(() => view.click());
      assert.deepEqual(panel.viewed, [["plan-2", "agent-2"]]);
    }),
);
