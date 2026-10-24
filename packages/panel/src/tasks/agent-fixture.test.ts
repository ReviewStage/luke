// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { PULL_REQUEST_CHAPTERS_STATE } from "@luke/features/pull-request-chapters-wire";
import { TASK_TREE_ENTRY } from "@luke/features/task-wire";
import { TERMINAL_REFUSAL } from "@luke/features/terminal-acts";
import { SANDBOX_STATE } from "@luke/features/terminal-wire";
import { ACT_KIND } from "@luke/host/acts";
import { RUN_PROFILE } from "@luke/host/app-state";
import {
  actContract,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
} from "@luke/host/contract";
import { Effect, Result, Schema } from "effect";
import { askAct } from "../act.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { handState, stateWith } from "../testing/app-state.js";
import { appStateFirstRead } from "../use-app-state.js";
import { agentActAnswer, FIXTURE_AGENT_ID } from "./agent-fixture.js";
import { FIXTURE_TASK_ID } from "./tasks-fixture.js";
import { loadTasksFixture } from "./tasks-fixture-loader.js";

/**
 * agent-fixture.test.ts -- a fixture run's agent profiles answer the reads
 * their agent's tabs ask through the act door, in place of main, which a
 * fixture run's service reads go to empty-handed: every answer one the act
 * port's contract would carry, the pull request queued with its checks
 * passed and approved, its chapters ready, and the Terminal's sandbox as each
 * profile stages it. Every act the profiles do not stage still goes to main.
 */

/** Every agent profile, which the polish pass shoots one by one. */
const AGENT_PROFILES = Object.values(RUN_PROFILE).filter((profile) => profile.startsWith("agent-"));

/** One read the agent's tabs ask, by its kind and payload. */
interface Read {
  readonly kind: PortActKind;
  readonly payload: PortActPayload<PortActKind>;
}

function read<Kind extends PortActKind>(kind: Kind, payload: PortActPayload<Kind>): Read {
  return { kind, payload };
}

const AGENT = { agentId: FIXTURE_AGENT_ID };

/** The reads the agent's column and its side panel's tabs ask that answer once, each a value the contract encodes. */
const READS: readonly Read[] = [
  read(ACT_KIND.CODING_AGENTS_LIST, { taskId: FIXTURE_TASK_ID, includeArchived: true }),
  read(ACT_KIND.CODING_AGENTS_CALLS, AGENT),
  read(ACT_KIND.CODING_AGENTS_PULL_REQUEST, AGENT),
  read(ACT_KIND.CODING_AGENTS_OVERVIEW_PULL_REQUEST, AGENT),
  read(ACT_KIND.CODING_AGENTS_OVERVIEW_CHECKS, AGENT),
  read(ACT_KIND.CODING_AGENTS_OVERVIEW_CONVERSATION, AGENT),
  read(ACT_KIND.CODING_AGENTS_REVIEW_OPTIONS, AGENT),
  read(ACT_KIND.CODING_AGENTS_CHANGES, AGENT),
  read(ACT_KIND.CODING_AGENTS_PULL_REQUEST_VIEWED, AGENT),
  read(ACT_KIND.CHAPTERS_READ, AGENT),
  read(ACT_KIND.TASKS_FILE, {
    taskId: FIXTURE_TASK_ID,
    path: "src/members/invite.ts",
    firstLine: 1,
    lastLine: 200,
  }),
  read(ACT_KIND.TASKS_TREE, { planId: FIXTURE_TASK_ID, path: "src/members" }),
  read(ACT_KIND.TERMINAL_LIST, AGENT),
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
  const staged = agentActAnswer(profile, kind, payload as PortActPayload<PortActKind>);
  assert.ok(staged, `${profile} answers ${kind}`);
  // SAFETY: the profile answered this kind's read, with this kind's result.
  return staged.answer as PortActResult<Kind>;
}

it("every read an agent profile answers is one the act port's contract carries", () => {
  const refused = AGENT_PROFILES.flatMap((profile) =>
    READS.flatMap(({ kind, payload }) =>
      carried(kind, answered(profile, kind, payload)) ? [] : [`${profile}: ${kind}`],
    ),
  );

  assert.ok(AGENT_PROFILES.length > 0);
  assert.deepEqual(refused, []);
});

it("the agent's pull request waits in its merge queue approved with its checks passed, and its chapters are ready", () => {
  const overview = answered(
    RUN_PROFILE.AGENT_PULL_REQUEST,
    ACT_KIND.CODING_AGENTS_OVERVIEW_PULL_REQUEST,
    AGENT,
  );
  const checks = answered(RUN_PROFILE.AGENT_CHECKS, ACT_KIND.CODING_AGENTS_OVERVIEW_CHECKS, AGENT);
  const chapters = answered(RUN_PROFILE.AGENT_CHAPTERS, ACT_KIND.CHAPTERS_READ, AGENT);

  assert.ok("pullRequest" in overview && overview.pullRequest !== null);
  assert.deepEqual(overview.pullRequest.merging?.queued, { position: 2 });
  assert.equal(overview.pullRequest.merging?.review, "approved");
  assert.ok("pullRequest" in checks && checks.pullRequest !== null);
  assert.ok(checks.pullRequest.checks.every((check) => check.state !== "failed"));
  assert.ok("pullRequest" in chapters && chapters.pullRequest !== null);
  assert.equal(chapters.pullRequest.chapters.status, PULL_REQUEST_CHAPTERS_STATE.READY);
});

/** What each hunk of a patch says it counts and what it holds, old side and new, as `old/new`. */
function hunkCounts(patch: string): readonly { readonly said: string; readonly held: string }[] {
  const hunks: { said: string; old: number; new: number }[] = [];
  for (const line of patch.split("\n")) {
    const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/u.exec(line);
    if (header !== null) {
      hunks.push({ said: `${header[1] ?? "1"}/${header[2] ?? "1"}`, old: 0, new: 0 });
      continue;
    }
    const hunk = hunks.at(-1);
    if (hunk === undefined) continue;
    if (!line.startsWith("+")) hunk.old += 1;
    if (!line.startsWith("-")) hunk.new += 1;
  }
  return hunks.map((hunk) => ({ said: hunk.said, held: `${hunk.old}/${hunk.new}` }));
}

it("every changed file's patch counts the lines its hunks hold, as the diff view reads it", () => {
  const changes = answered(RUN_PROFILE.AGENT_FILES, ACT_KIND.CODING_AGENTS_CHANGES, AGENT);
  assert.ok("pullRequest" in changes && changes.pullRequest !== null);
  const miscounted = changes.pullRequest.files.flatMap((file) =>
    hunkCounts(file.patch ?? "").flatMap(({ said, held }) =>
      said === held ? [] : [`${file.path}: says ${said}, holds ${held}`],
    ),
  );

  assert.deepEqual(miscounted, []);
});

/** Every file path the File tab's tree lists under `path`, walking its folders. */
function listedFiles(path: string): readonly string[] {
  const listed = answered(RUN_PROFILE.AGENT_FILE, ACT_KIND.TASKS_TREE, {
    planId: FIXTURE_TASK_ID,
    path,
  });
  assert.ok("folder" in listed, `${path || "the root"} is listed`);
  return listed.folder.entries.flatMap((entry) => {
    const at = path === "" ? entry.name : `${path}/${entry.name}`;
    return entry.kind === TASK_TREE_ENTRY.FOLDER ? listedFiles(at) : [at];
  });
}

it("every file the File tab's tree lists, and every file the pull request changed, reads whole on the agent's branch", () => {
  const changes = answered(RUN_PROFILE.AGENT_FILES, ACT_KIND.CODING_AGENTS_CHANGES, AGENT);
  assert.ok("pullRequest" in changes && changes.pullRequest !== null);
  const listed = listedFiles("");
  const unread = [
    ...new Set([...listed, ...changes.pullRequest.files.map((file) => file.path)]),
  ].filter((path) => {
    const read = answered(RUN_PROFILE.AGENT_FILE, ACT_KIND.TASKS_FILE, {
      taskId: FIXTURE_TASK_ID,
      path,
      firstLine: 1,
      lastLine: 1,
      raw: true,
    });
    return !("text" in read);
  });

  assert.ok(listed.includes("src/members/invite.test.ts"));
  assert.deepEqual(unread, []);
});

it("each Terminal profile lists the agent's sandbox as the state it stages", () => {
  const listed = (profile: string) => answered(profile, ACT_KIND.TERMINAL_LIST, AGENT);

  assert.equal(
    (listed(RUN_PROFILE.AGENT_TERMINAL) as { sandbox: string }).sandbox,
    SANDBOX_STATE.RUNNING,
  );
  assert.equal(
    (listed(RUN_PROFILE.AGENT_TERMINAL_STOPPED) as { sandbox: string }).sandbox,
    SANDBOX_STATE.STOPPED,
  );
  assert.equal(
    (listed(RUN_PROFILE.AGENT_TERMINAL_STARTING) as { sandbox: string }).sandbox,
    SANDBOX_STATE.STARTING,
  );
  assert.deepEqual(listed(RUN_PROFILE.AGENT_TERMINAL_UNREACHABLE), {
    refused: TERMINAL_REFUSAL.SANDBOX_UNANSWERED,
  });
});

it("a profile that stages no agent answers nothing itself", () => {
  assert.equal(
    agentActAnswer(RUN_PROFILE.TASKS, ACT_KIND.CODING_AGENTS_LIST, { taskId: FIXTURE_TASK_ID }),
    undefined,
  );
});

it.effect(
  "an agent profile's fixture run answers its agent's reads at the act door, and sends main every other act",
  () =>
    Effect.gen(function* () {
      const { run } = stateWith({}, {});
      handState(
        {},
        { run: { ...run, fixtureMode: true, profile: RUN_PROFILE.AGENT_PULL_REQUEST } },
      );
      yield* appStateFirstRead;
      // The window is drawn once the synthetic tasks have landed (`App`).
      yield* Effect.promise(loadTasksFixture);
      const sent: PortActKind[] = [];
      fakeActPort({
        [ACT_KIND.CODING_AGENTS_LIST]: () => {
          sent.push(ACT_KIND.CODING_AGENTS_LIST);
          return Promise.resolve({ agents: [] });
        },
        [ACT_KIND.PROVIDER_KEYS_READ]: () => {
          sent.push(ACT_KIND.PROVIDER_KEYS_READ);
          return Promise.resolve({ keys: [] });
        },
      });

      const listed = yield* Effect.promise(() =>
        askAct(ACT_KIND.CODING_AGENTS_LIST, { taskId: FIXTURE_TASK_ID }),
      );
      const keys = yield* Effect.promise(() => askAct(ACT_KIND.PROVIDER_KEYS_READ));

      assert.ok("agents" in listed);
      assert.deepEqual(
        listed.agents.map((agent) => agent.title),
        ["Add teammate invitations"],
      );
      assert.deepEqual(keys, { keys: [] });
      assert.deepEqual(sent, [ACT_KIND.PROVIDER_KEYS_READ]);
    }),
);
