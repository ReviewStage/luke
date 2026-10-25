import assert from "node:assert/strict";
import type { AdminMetrics } from "@luke/features/admin-answer-wire";
import {
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  ADMIN_METRICS_WINDOW,
  ADMIN_METRICS_WINDOW_PARAM,
  ADMIN_READ,
} from "@luke/features/admin-wire";
import { AUTOMATION_FOLLOW } from "@luke/features/automation-view";
import { AUTOMATION_RUN_STATUS } from "@luke/features/automation-wire";
import { INTEGRATION_PROVIDER, INTEGRATION_STATUS } from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
import { RUN_PROFILE } from "@luke/host/app-state";
import {
  actContract,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
} from "@luke/host/contract";
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
  read(ACT_KIND.GITHUB_TOKEN_READ, undefined),
  read(ACT_KIND.PROVIDER_KEYS_READ, undefined),
  read(ACT_KIND.CODING_AGENTS_MODELS, undefined),
  read(ACT_KIND.CODING_AGENTS_DEFAULT_READ, undefined),
  read(ACT_KIND.CHAPTERS_MODEL_READ, undefined),
  read(ACT_KIND.INTEGRATIONS_STATUS, undefined),
  read(ACT_KIND.INTEGRATIONS_TOOLS, { provider: INTEGRATION_PROVIDER.NOTION }),
  read(ACT_KIND.WORKSPACE_MEMBERS_READ, ACME),
  read(ACT_KIND.WORKSPACE_INVITATIONS_READ, ACME),
  read(ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_READ, ACME),
  read(ACT_KIND.WORKSPACE_SENTRY_READ, ACME),
  read(ACT_KIND.INSTALLED_SKILLS_LIST, ACME),
  read(ACT_KIND.INSTALLED_SKILLS_CHECK_UPDATE, {
    ...ACME,
    skillId: "5d2b7c1e-4a3f-4e8b-9c6d-000000000001",
  }),
  read(ACT_KIND.INSTALLED_SKILLS_READ, { skillId: "5d2b7c1e-4a3f-4e8b-9c6d-000000000001" }),
  read(ACT_KIND.MEMORIES_READ, ACME),
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

/** Every view a follow pushes, until it ends. */
async function pushed(stream: AsyncIterable<unknown>): Promise<readonly unknown[]> {
  const views: unknown[] = [];
  for await (const view of stream) views.push(view);
  return views;
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
  const statuses = answered(
    RUN_PROFILE.SETTINGS_INTEGRATIONS,
    ACT_KIND.INTEGRATIONS_STATUS,
    undefined,
  );
  assert.ok("integrations" in statuses);

  const standing = new Set(statuses.accounts?.map((account) => account.status));
  assert.ok(standing.has(INTEGRATION_STATUS.CONNECTED));
  assert.ok(standing.has(INTEGRATION_STATUS.EXPIRED));
});

test("an Automations profile follows three automations in the listed workspace, one whose newest run failed, and that one's runs", async () => {
  const [list] = await pushed(
    answered(RUN_PROFILE.AUTOMATIONS, ACT_KIND.AUTOMATIONS_FOLLOW, {
      kind: AUTOMATION_FOLLOW.WORKSPACE,
      id: "workspace-personal",
    }),
  );
  assert.ok(typeof list === "object" && list !== null && "automations" in list);
  const automations = list.automations as readonly {
    id: string;
    workspaceId: string;
    lastRun: { status: string } | null;
  }[];
  const failed = automations.filter(
    (automation) => automation.lastRun?.status === AUTOMATION_RUN_STATUS.FAILED,
  );
  assert.equal(automations.length, 3);
  assert.ok(automations.every((automation) => automation.workspaceId === "workspace-personal"));
  assert.equal(failed.length, 1);

  const [runs] = await pushed(
    answered(RUN_PROFILE.AUTOMATIONS_RUNS, ACT_KIND.AUTOMATIONS_FOLLOW, {
      kind: AUTOMATION_FOLLOW.RUNS,
      id: failed[0]?.id ?? "",
    }),
  );
  assert.ok(typeof runs === "object" && runs !== null && "runs" in runs);
  assert.ok(
    (runs.runs as readonly { status: string }[]).some(
      (run) => run.status === AUTOMATION_RUN_STATUS.FAILED,
    ),
  );
});

test("every skill the Skills profile lists reads whole when viewed", () => {
  const listed = answered(RUN_PROFILE.SETTINGS_SKILLS, ACT_KIND.INSTALLED_SKILLS_LIST, ACME);
  assert.ok("skills" in listed);
  const unread = listed.skills.filter((skill) => {
    const content = answered(RUN_PROFILE.SETTINGS_SKILLS, ACT_KIND.INSTALLED_SKILLS_READ, {
      skillId: skill.id,
    });
    return !("skillFile" in content) || !content.skillFile.includes(skill.name);
  });

  assert.ok(listed.skills.length > 0);
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

test("a signed-in profile lays the synthetic account, an admin, over main's signed-out document; any other leaves it as it is", () => {
  const { run } = stateWith({}, {});
  const signedOut = stateWith({}, { account: { status: "signed-out" }, access: { admin: false } });
  const staged = fixtureAppState({
    ...signedOut,
    run: { ...run, fixtureMode: true, profile: RUN_PROFILE.SETTINGS_MEMORY },
  });
  const tasks = { ...signedOut, run: { ...run, fixtureMode: true, profile: RUN_PROFILE.TASKS } };

  assert.equal(staged.account.status, "signed-in");
  assert.equal(staged.access.admin, true);
  assert.equal(staged.settings?.experiments.memory, true);
  assert.equal(fixtureAppState(tasks), tasks);
});

test("a profile that stages no account answers none of its pages' reads itself", () => {
  assert.equal(
    fixtureActAnswer({ profile: RUN_PROFILE.TASKS }, ACT_KIND.MEMORIES_READ, ACME),
    undefined,
  );
});
