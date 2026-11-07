import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import type { AdminMetrics } from "@repo/features/admin-answer-wire";
import {
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  ADMIN_METRICS_WINDOW,
  ADMIN_METRICS_WINDOW_PARAM,
  ADMIN_READ,
} from "@repo/features/admin-wire";
import { AUTOMATION_RUN_STATUS } from "@repo/features/automation-wire";
import { INTEGRATION_STATUS } from "@repo/features/integration-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import { RUN_PROFILE } from "@repo/host/app-state";
import {
  actContract,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
} from "@repo/host/contract";
import { Result, Schema } from "effect";
import { test } from "vitest";
import { stateWith } from "../testing/app-state.js";
import { fixtureActAnswer, fixtureAppState } from "./tasks-fixture.js";

/**
 * settings-fixture.test.ts -- a fixture run's Settings, Admin, and
 * Automations profiles sign the window in as a synthetic account and answer
 * the reads their pages ask through the act door, in place of main: every
 * answer one the act port's contract would carry, connected and expired
 * integrations among them, and three automations, one whose newest run
 * failed. A profile that stages no account leaves main's document as it is.
 */

/** Every profile the account is signed in under, which the polish pass shoots one by one. */
const SIGNED_IN_PROFILES = Object.values(RUN_PROFILE).filter(
  (profile) =>
    profile.startsWith("settings-") || profile.startsWith("automations") || profile === "admin",
);

/** One read the staged pages ask, by its kind and payload. */
interface Read {
  readonly kind: PortActKind;
  readonly payload: PortActPayload<PortActKind>;
}

function read<Kind extends PortActKind>(kind: Kind, payload: PortActPayload<Kind>): Read {
  return { kind, payload };
}

const ACME = { workspaceId: "workspace-acme" };

/** The reads the staged pages ask that answer once, each a value the contract encodes. */
const READS: readonly Read[] = [
  read(ACT_KIND.INSTALLED_SKILLS_READ, { skillId: "5d2b7c1e-4a3f-4e8b-9c6d-000000000001" }),
  read(ACT_KIND.ADMIN_READ, { procedure: ADMIN_READ.METRICS, query: {} }),
];

/** Whether a procedure's declared schema is an Effect Schema, which encodes with no service, as every act's output but a stream's is. */
function isWireSchema(schema: unknown): schema is Schema.Codec<unknown, unknown> {
  return Schema.isSchema(schema);
}

/** Whether the act port's contract would carry `answer` as the kind's: it encodes through the output schema the kind's procedure declares. */
function carried(kind: PortActKind, answer: unknown): boolean {
  const [declared] = actContract[kind]["~orpc"].outputSchemas ?? [];
  assert.ok(isWireSchema(declared), `${kind} declares a wire schema`);
  return Result.isSuccess(Schema.encodeUnknownResult(Schema.flip(declared))(answer));
}

/** The profile's answer to one read, which it must stage. */
function answered<Kind extends PortActKind>(
  profile: string,
  kind: Kind,
  payload: PortActPayload<Kind>,
): PortActResult<Kind> {
  const staged = fixtureActAnswer({ profile }, kind, payload as PortActPayload<PortActKind>);
  assert.ok(staged, `${profile} answers ${kind}`);
  // SAFETY: the profile answered this kind's read, with this kind's result.
  return staged.answer as PortActResult<Kind>;
}

test("every read a signed-in profile answers is one the act port's contract carries", () => {
  const refused = SIGNED_IN_PROFILES.flatMap((profile) =>
    READS.flatMap(({ kind, payload }) =>
      carried(kind, answered(profile, kind, payload)) ? [] : [`${profile}: ${kind}`],
    ),
  );

  assert.deepEqual(refused, []);
});

test("the integrations profile draws some accounts connected and some with their sign-in expired", () => {
  const { run } = stateWith({}, {});
  const staged = fixtureAppState(
    stateWith({}, { run: { ...run, profile: RUN_PROFILE.SETTINGS_INTEGRATIONS } }),
  );
  const accountId =
    staged.account.status === ACCOUNT_STATUS.SIGNED_IN ? staged.account.id : undefined;
  const statuses = staged[LIVE_READ.INTEGRATIONS][accountId ?? ""]?.rows;
  assert.ok(statuses !== undefined, "the profile holds the account's integrations");

  const standing = new Set(statuses.accounts?.map((account) => account.status));
  assert.ok(standing.has(INTEGRATION_STATUS.CONNECTED));
  assert.ok(standing.has(INTEGRATION_STATUS.EXPIRED));
});

test("an Automations profile holds three automations in the listed workspace, one whose newest run failed, and that one's runs", () => {
  const { run } = stateWith({}, {});
  /** The document an Automations profile draws. */
  const staged = (profile: string) => fixtureAppState(stateWith({}, { run: { ...run, profile } }));
  const automations =
    staged(RUN_PROFILE.AUTOMATIONS)[LIVE_READ.AUTOMATIONS]["workspace-personal"]?.rows ?? [];
  const failed = automations.filter(
    (automation) => automation.lastRun?.status === AUTOMATION_RUN_STATUS.FAILED,
  );
  assert.equal(automations.length, 3);
  assert.ok(automations.every((automation) => automation.workspaceId === "workspace-personal"));
  assert.equal(failed.length, 1);

  const runs =
    staged(RUN_PROFILE.AUTOMATIONS_RUNS)[LIVE_READ.AUTOMATION_RUNS][failed[0]?.id ?? ""]?.rows ??
    [];
  assert.ok(runs.some((each) => each.status === AUTOMATION_RUN_STATUS.FAILED));
});

test("every skill the Skills profile lists reads whole when viewed", () => {
  const { run } = stateWith({}, {});
  const staged = fixtureAppState(
    stateWith({}, { run: { ...run, profile: RUN_PROFILE.SETTINGS_SKILLS } }),
  );
  const listed = staged[LIVE_READ.INSTALLED_SKILLS][ACME.workspaceId]?.rows ?? [];
  const unread = listed.filter((skill) => {
    const content = answered(RUN_PROFILE.SETTINGS_SKILLS, ACT_KIND.INSTALLED_SKILLS_READ, {
      skillId: skill.id,
    });
    return !("skillFile" in content) || !content.skillFile.includes(skill.name);
  });

  assert.ok(listed.length > 0);
  assert.deepEqual(unread, []);
});

test("Admin's Overview answers the window and the scope its controls ask for, its counts agreeing within it", () => {
  const metrics = (query: Record<string, string>): AdminMetrics => {
    const read = answered(RUN_PROFILE.ADMIN, ACT_KIND.ADMIN_READ, {
      procedure: ADMIN_READ.METRICS,
      query,
    });
    assert.ok("answer" in read);
    // SAFETY: a metrics read answers the Overview's metrics.
    return read.answer as AdminMetrics;
  };
  const week = metrics({ [ADMIN_METRICS_WINDOW_PARAM]: "7" });
  const everyone = metrics({ [ADMIN_METRICS_SCOPE_PARAM]: ADMIN_METRICS_SCOPE.ALL });
  const byDefault = metrics({});

  assert.equal(week.windowDays, 7);
  assert.equal(week.overview.activity.daily.length, 7);
  assert.ok(week.overview.topAccounts.every((account) => account.activeDays <= 7));
  assert.equal(
    week.users.newInWindow,
    week.users.dailySignups.reduce((sum, day) => sum + day.count, 0),
  );
  assert.equal(week.overview.funnel[0]?.accounts, week.users.newInWindow);
  for (const days of Object.values(ADMIN_METRICS_WINDOW)) {
    const window = metrics({ [ADMIN_METRICS_WINDOW_PARAM]: String(days) });
    assert.ok(window.users.newInWindow <= window.users.total, `${days} days`);
  }
  assert.equal(byDefault.windowDays, 30);
  assert.ok(byDefault.overview.topAccounts.every((account) => !account.admin));
  assert.ok(everyone.overview.topAccounts.some((account) => account.admin));
  assert.ok(everyone.users.total > byDefault.users.total);
});

test("a signed-in profile lays the synthetic account, an admin, over main's signed-out document; any other leaves its account and access as they are", () => {
  const { run } = stateWith({}, {});
  const signedOut = stateWith({}, { account: { status: "signed-out" }, access: { admin: false } });
  const staged = fixtureAppState({
    ...signedOut,
    run: { ...run, fixtureMode: true, profile: RUN_PROFILE.SETTINGS_MEMORY },
  });
  const tasks = { ...signedOut, run: { ...run, fixtureMode: true, profile: RUN_PROFILE.TASKS } };

  assert.equal(staged.account.status, "signed-in");
  assert.equal(staged.access.admin, true);
  assert.equal(staged.settings?.experiments.skills, true);
  const other = fixtureAppState(tasks);
  assert.equal(other.account, tasks.account);
  assert.equal(other.access, tasks.access);
});

test("a profile that stages no account answers none of its pages' reads itself", () => {
  assert.equal(
    fixtureActAnswer({ profile: RUN_PROFILE.TASKS }, ACT_KIND.ADMIN_READ, {
      procedure: ADMIN_READ.METRICS,
      query: {},
    }),
    undefined,
  );
});
