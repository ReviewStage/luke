import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { AUTOMATION_TRIGGER } from "@repo/features/automation-wire";
import { type Schedule, Schedules, SchedulesApiError } from "@vercel/schedules";
import { Effect } from "effect";
import { afterEach, vi } from "vitest";
import { AutomationCadence, automationCadenceFromEnvironment } from "./automation-cadence.js";

/**
 * An automation's schedule as the cadence keeps it in Vercel Schedules,
 * whose client is spied on at its methods, the HTTP boundary: on production
 * a paused automation saved with no schedule standing has one made in its
 * workspace's namespace on its own cron and zone and then disabled, and one
 * that fires on something else since has its schedule deleted; off
 * production nothing is asked of Vercel at all, since a Preview's database
 * holds production's automations. Synthetic ids throughout.
 */

const WORKSPACE = "workspace-relay";

const NIGHTLY = {
  id: "automation-nightly",
  organizationId: WORKSPACE,
  enabled: false,
  trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "Europe/Paris" },
} as const;

/** A schedule as Vercel answers one, active as a schedule made is. */
const standing = (name: string): Schedule => ({
  scheduleId: "sch_relay",
  ownerId: "team_relay",
  projectId: "prj_relay",
  name,
  namespace: WORKSPACE,
  expression: { type: "cron", cron: NIGHTLY.trigger.cron },
  timezone: NIGHTLY.trigger.timezone,
  target: { type: "queue", topic: "automation-runs" },
  state: "active",
  source: "dynamic",
  createdAt: 0,
  updatedAt: 0,
});

/** Every call the client was asked to make, by method, with what it was handed. */
function spiedSchedules() {
  const missing = new SchedulesApiError(404, "Schedule not found", { code: "not_found" });
  return {
    update: vi.spyOn(Schedules, "update").mockRejectedValue(missing),
    create: vi.spyOn(Schedules, "create").mockImplementation(async (params) => ({
      ...standing(params.name),
      target: { type: "queue", topic: params.target.topic },
    })),
    disable: vi
      .spyOn(Schedules, "disable")
      .mockImplementation(async ({ name }) => ({ ...standing(name), state: "inactive" })),
    enable: vi.spyOn(Schedules, "enable").mockImplementation(async ({ name }) => standing(name)),
    delete: vi.spyOn(Schedules, "delete").mockResolvedValue(undefined),
  };
}

/** The automation kept, and then kept again moved to a webhook, by the cadence the environment names. */
const keptTwice = Effect.gen(function* () {
  const cadence = yield* AutomationCadence;
  yield* cadence.keep(NIGHTLY);
  yield* cadence.keep({ ...NIGHTLY, trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK } });
}).pipe(Effect.provide(automationCadenceFromEnvironment));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.effect(
  "on production a paused automation's schedule is made on its cron and zone and disabled, and deleted once it fires on something else",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_ENV", "production");
      const spied = spiedSchedules();

      yield* keptTwice;

      const identity = { name: NIGHTLY.id, namespace: WORKSPACE };
      assert.deepEqual(spied.create.mock.calls, [
        [
          {
            ...identity,
            expression: { type: "cron", cron: "0 9 * * 1-5" },
            timezone: "Europe/Paris",
            target: { topic: "automation-runs" },
          },
        ],
      ]);
      assert.deepEqual(spied.disable.mock.calls, [[identity]]);
      assert.deepEqual(spied.enable.mock.calls, []);
      assert.deepEqual(spied.delete.mock.calls, [[identity]]);
    }),
);

it.effect("off production nothing is asked of Vercel Schedules", () =>
  Effect.gen(function* () {
    vi.stubEnv("VERCEL_ENV", "preview");
    const spied = spiedSchedules();

    yield* keptTwice;

    assert.deepEqual(
      Object.values(spied).flatMap((spy) => spy.mock.calls),
      [],
    );
  }),
);
