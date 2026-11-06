import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { EXPERIMENT } from "@repo/settings";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import {
  setWorkspaceExperiment,
  workspaceExperimentOn,
  workspaceExperimentsOf,
} from "../workspace-experiment-store.js";

/**
 * A workspace's experiments over a real dialect: off until an admin turns
 * one on, its own and no other workspace's, and naming who changed it last
 * for as long as their account stands.
 *
 * Synthetic accounts and workspaces throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

it.layer(getTestDB())("a workspace's experiments", (it) => {
  it.effect(
    "stand off until turned on, belong to their workspace alone, and keep the last change's author until that account goes",
    () =>
      Effect.gen(function* () {
        const [ada, bob] = [yield* openAccount, yield* openAccount];
        const acme = yield* openWorkspace(ada);
        const beta = yield* openWorkspace(bob);
        const before = yield* workspaceExperimentOn(acme, EXPERIMENT.PILOT);

        yield* setWorkspaceExperiment({
          organizationId: acme,
          experiment: EXPERIMENT.PILOT,
          on: true,
          by: ada,
        });
        yield* setWorkspaceExperiment({
          organizationId: acme,
          experiment: EXPERIMENT.DESCRIPTIONS,
          on: true,
          by: ada,
        });
        yield* setWorkspaceExperiment({
          organizationId: acme,
          experiment: EXPERIMENT.DESCRIPTIONS,
          on: false,
          by: bob,
        });
        const read = {
          acmePilot: yield* workspaceExperimentOn(acme, EXPERIMENT.PILOT),
          acmeDescriptions: yield* workspaceExperimentOn(acme, EXPERIMENT.DESCRIPTIONS),
          betaPilot: yield* workspaceExperimentOn(beta, EXPERIMENT.PILOT),
        };
        const betaStandings = yield* workspaceExperimentsOf(beta);
        yield* Database.use((db) => db.delete(user).where(eq(user.id, bob)));
        const standings = yield* workspaceExperimentsOf(acme);

        assert.equal(before, false);
        assert.deepEqual(read, { acmePilot: true, acmeDescriptions: false, betaPilot: false });
        assert.deepEqual(betaStandings, []);
        assert.deepEqual(
          standings
            .map(({ experiment, on, changedBy }) => ({ experiment, on, changedBy }))
            .toSorted((a, b) => a.experiment.localeCompare(b.experiment)),
          [
            { experiment: EXPERIMENT.DESCRIPTIONS, on: false, changedBy: undefined },
            { experiment: EXPERIMENT.PILOT, on: true, changedBy: ada },
          ],
        );
      }),
  );
});
