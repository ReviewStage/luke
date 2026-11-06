import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { entityPool } from "@repo/sync";
import { Effect } from "effect";
import { type LiveTaskList, taskListCollections } from "./task-list-collections.js";
import { agentListRow, planListRow } from "./testing/task-list-rows.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

it.effect(
  "an agent's row that moves draws its own task again, and every other task and agent is the object drawn before",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const drawings: LiveTaskList[] = [];
        const collections = yield* taskListCollections({
          pool: yield* entityPool(),
          draw: (read) => {
            drawings.push(read);
          },
          txWait: () => undefined,
        });
        const plans = [
          planListRow(INVITES, "Teammate invitations"),
          planListRow(BILLING, "Billing"),
        ];
        const invites = { ...agentListRow(INVITES, 1_000), id: "agent-invites" };
        const billing = { ...agentListRow(BILLING, 1_000), id: "agent-billing" };
        yield* collections.answer({ plans, agents: [invites, billing] });
        const before = drawings.at(-1);

        yield* collections.answer({
          plans,
          agents: [invites, { ...billing, title: "CSV export" }],
        });
        const after = drawings.at(-1);

        const taskOf = (drawing: LiveTaskList | undefined, id: string) =>
          drawing?.list.plans.find((each) => each.id === id);
        const agentOf = (drawing: LiveTaskList | undefined, id: string) =>
          drawing?.taskAgents.find((each) => each.id === id);
        assert.ok(
          taskOf(before, INVITES) !== undefined && agentOf(before, invites.id) !== undefined,
        );
        assert.equal(taskOf(after, INVITES), taskOf(before, INVITES));
        assert.equal(agentOf(after, invites.id), agentOf(before, invites.id));
        assert.equal(taskOf(after, BILLING)?.agents?.agents[0]?.title, "CSV export");
        assert.equal(agentOf(after, billing.id)?.title, "CSV export");
      }),
    ),
);
