import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { IDLE_TASKS_VIEW, TASKS_READ, type TasksView } from "@luke/features/tasks-view";
import {
  carried,
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  gatewayHost,
  NodeRegistry,
} from "@luke/gateway";
import { Context, Effect } from "effect";
import { runModeFor } from "../run-mode.js";
import { AppStateStore, initialAppState } from "./app-state-store.js";
import { wireGateway } from "./gateway-wiring.js";

/**
 * gateway-wiring.test.ts -- what the host says reaching the document every
 * window is told from, through the one in-process Gateway a client holds.
 */

const RUN = {
  launch: { profile: "idle", captureMode: false, fixtureMode: false },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "darwin",
} as const;

it.effect(
  "the host's tasks view reaches the document as the host built it, never rebuilt by a decode on the way",
  () =>
    Effect.gen(function* () {
      const gateway = gatewayHost({
        methods: {},
        client: { clientId: "panel", role: GATEWAY_CLIENT_ROLE.OPERATOR },
      });
      const state = new AppStateStore(initialAppState(RUN, true, []), Context.empty());
      yield* wireGateway({
        gateway,
        nodes: new NodeRegistry(),
        report: () => undefined,
        state,
        node: { openExternal: () => Promise.resolve() },
      });
      const view: TasksView = {
        ...IDLE_TASKS_VIEW,
        activeTaskId: "plan-1",
        document: { status: TASKS_READ.READING },
      };

      gateway.emit(GATEWAY_EVENT.TASKS_CHANGED, carried(view));

      assert.equal(state.snapshot().tasks, view);
      assert.equal(state.snapshot().version, 1);
    }).pipe(Effect.scoped),
);
