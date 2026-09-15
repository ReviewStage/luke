import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CHILD_STATUS } from "@sidecar/hosted/reads-wire";
import { type ChildTranscriptSnapshot, CONVERSATION_VIEW_SOURCE } from "@sidecar/session";
import { Effect } from "effect";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import type { AppStateSnapshot } from "#shared/messages/app-state";
import type { ChildrenSnapshot } from "#shared/messages/children";
import { WINDOW_ROLE } from "#shared/messages/session";
import { appStateAtom, appStateSourceAtom } from "./use-app-state";
import { childrenAtom, childTranscriptAtom } from "./use-children";

const CHILD = "5e000000-0000-4000-8000-000000000001";

const CHILDREN: ChildrenSnapshot = {
  settled: true,
  children: [
    {
      id: CHILD,
      parentConversationId: "3c000000-0000-4000-8000-000000000001",
      parentKind: CONVERSATION_VIEW_SOURCE.MAIN,
      label: "tests",
      status: CHILD_STATUS.RUNNING,
      acceptedAt: 1_757_505_600_000,
    },
  ],
};

const TRANSCRIPT: ChildTranscriptSnapshot = { childId: CHILD, groups: [], settled: true };

/** A document carrying the two slices under test and nothing else a reader here looks at. */
function snapshot(version: number, childTranscript?: ChildTranscriptSnapshot): AppStateSnapshot {
  // SAFETY: nothing under test reads another slice; the version, the window facts, and the two children slices are exercised.
  return {
    version,
    window: { role: WINDOW_ROLE.PANEL, mode: "compact" },
    children: CHILDREN,
    ...(childTranscript !== undefined ? { childTranscript } : undefined),
  } as AppStateSnapshot;
}

/** A registry of this test's own over a bridge that answers the read and delivers when told. */
function reading(first: AppStateSnapshot) {
  const deliveries: ((delivered: AppStateSnapshot) => void)[] = [];
  const registry = AtomRegistry.make();
  registry.set(appStateSourceAtom, {
    subscribe: (onDelivered) => {
      deliveries.push(onDelivered);
      return () => undefined;
    },
    read: async () => first,
  });
  return {
    registry,
    read: () => AtomRegistry.getResult(registry, appStateAtom),
    deliver: (delivered: AppStateSnapshot) => {
      for (const onDelivered of deliveries) onDelivered(delivered);
    },
  };
}

it.live(
  "the children read as unread until the document arrives, then as the slice it carries",
  () =>
    Effect.gen(function* () {
      const state = reading(snapshot(1));
      assert.deepEqual(state.registry.get(childrenAtom), { settled: false, children: [] });
      assert.equal(state.registry.get(childTranscriptAtom), undefined);
      yield* state.read();
      assert.deepEqual(state.registry.get(childrenAtom), CHILDREN);
      assert.equal(state.registry.get(childTranscriptAtom), undefined);
    }),
);

it.live("the transcript follows the document: a delivery opens it and the next lets it go", () =>
  Effect.gen(function* () {
    const state = reading(snapshot(1));
    yield* state.read();
    state.deliver(snapshot(2, TRANSCRIPT));
    yield* Effect.sleep(20);
    assert.deepEqual(state.registry.get(childTranscriptAtom), TRANSCRIPT);
    state.deliver(snapshot(3));
    yield* Effect.sleep(20);
    assert.equal(state.registry.get(childTranscriptAtom), undefined);
  }),
);
