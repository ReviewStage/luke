import assert from "node:assert/strict";
import type { HostedProjectsAnswer, ObserveAnswer } from "@sidecar/hosted";
import {
  CLOUD_AGENT_PROVIDER_ID,
  PROVIDER_IDENTITY_BY_ID,
  SESSION_STATUS,
  SessionRoster,
  WORKSPACE_TASK_SUPPORT,
} from "@sidecar/session";
import { test } from "vitest";
import { drawSnapshotProjects, drawSnapshotRoster, snapshotProjects } from "./snapshot-roster.js";

const OBSERVED_AT = 1_800_000_000_000;

const OLDER = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  sessionId: "chat-older",
  title: "Write the release notes",
  status: SESSION_STATUS.COMPLETE,
  lastActivityAt: OBSERVED_AT - 60_000,
};

const NEWER = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  sessionId: "chat-newer",
  title: "Fix the roster test",
  status: SESSION_STATUS.WORKING,
  lastActivityAt: OBSERVED_AT,
};

function fixture(answers: readonly (ObserveAnswer | undefined)[]) {
  const registry = new SessionRoster();
  const reports: string[] = [];
  let call = 0;
  let current = true;
  const client = {
    observe: async () => {
      const answer = answers[call];
      call += 1;
      return answer;
    },
  };
  const draw = () =>
    drawSnapshotRoster({
      client,
      registry,
      isCurrent: () => current,
      report: (line) => reports.push(line),
    });
  const ids = () => registry.list().map((session) => session.providerSessionId);
  const stop = () => {
    current = false;
  };
  return { draw, ids, reports, registry, stop };
}

test("a pass replaces the provider's slice whole, newest activity first, and a session the next snapshot lacks leaves", async () => {
  const { draw, ids } = fixture([
    { sessions: [OLDER, NEWER], observedAt: OBSERVED_AT },
    { sessions: [NEWER], observedAt: OBSERVED_AT + 60_000 },
  ]);

  await draw();
  assert.deepEqual(ids(), [NEWER.sessionId, OLDER.sessionId]);

  await draw();
  assert.deepEqual(ids(), [NEWER.sessionId]);
});

test("a read that answers nothing leaves the last roster standing and says so", async () => {
  const { draw, ids, reports } = fixture([
    { sessions: [NEWER], observedAt: OBSERVED_AT },
    undefined,
  ]);

  await draw();
  await draw();
  assert.deepEqual(ids(), [NEWER.sessionId]);
  assert.equal(reports.length, 1);
});

test("a slice that cannot be drawn leaves the provider's previous sessions standing", async () => {
  const { draw, ids, reports } = fixture([
    { sessions: [NEWER], observedAt: OBSERVED_AT },
    { sessions: [OLDER, OLDER], observedAt: OBSERVED_AT },
  ]);

  await draw();
  await draw();
  assert.deepEqual(ids(), [NEWER.sessionId]);
  assert.equal(reports.length, 1);
});

test("a pass stopped while its read was out draws nothing", async () => {
  const { draw, ids, reports, stop } = fixture([{ sessions: [NEWER], observedAt: OBSERVED_AT }]);

  stop();
  await draw();
  assert.deepEqual(ids(), []);
  assert.equal(reports.length, 0);
});

test("the sessions drawn carry the provider's identity and the snapshot's advertisements", async () => {
  const { draw, registry } = fixture([
    {
      sessions: [{ ...NEWER, canReceiveMessage: true, link: "conductor://session/chat-newer" }],
      observedAt: OBSERVED_AT,
    },
  ]);

  await draw();
  const [session] = registry.list();
  assert.equal(session?.providerId, CLOUD_AGENT_PROVIDER_ID.CONDUCTOR);
  assert.deepEqual(session?.provider, {
    id: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
    displayName: "Conductor",
  });
  assert.equal(session?.detail.link, "conductor://session/chat-newer");
  assert.equal(session?.advertises.length, 1);
});

const PROJECT = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  providerProjectId: "project-1",
  repository: "acme/app",
  taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
  targetName: "Default host",
};

test("the projects answer becomes the app's own project list, stamped with the provider's name, and a provider not observed in the cloud is dropped", () => {
  const listed = snapshotProjects({
    projects: [
      PROJECT,
      {
        providerId: "claude-code",
        providerProjectId: "local-1",
        repository: "acme/local",
        taskSupport: WORKSPACE_TASK_SUPPORT.NONE,
      },
      {
        providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
        providerProjectId: "project-2",
        repository: "acme/web",
        taskSupport: WORKSPACE_TASK_SUPPORT.REQUIRED,
        namesItself: true,
      },
    ],
    agentModels: [],
  });

  assert.deepEqual(listed, [
    {
      providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
      providerName: PROVIDER_IDENTITY_BY_ID[CLOUD_AGENT_PROVIDER_ID.CONDUCTOR].displayName,
      providerProjectId: "project-1",
      repository: "acme/app",
      taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
      targetName: "Default host",
    },
    {
      providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
      providerName: PROVIDER_IDENTITY_BY_ID[CLOUD_AGENT_PROVIDER_ID.CONDUCTOR].displayName,
      providerProjectId: "project-2",
      repository: "acme/web",
      taskSupport: WORKSPACE_TASK_SUPPORT.REQUIRED,
      namesItself: true,
    },
  ]);
});

test("a projects read that answers nothing, or answers after the pass was stopped, replaces no list and reports only the first", async () => {
  const reports: string[] = [];
  let current = true;
  const answers: (HostedProjectsAnswer | undefined)[] = [
    { projects: [PROJECT], agentModels: [] },
    undefined,
    { projects: [PROJECT], agentModels: [] },
  ];
  const draw = () =>
    drawSnapshotProjects({
      client: { projects: async () => answers.shift() },
      isCurrent: () => current,
      report: (line) => reports.push(line),
    });

  assert.equal((await draw())?.length, 1);
  assert.equal(await draw(), undefined);
  assert.equal(reports.length, 1);
  current = false;
  assert.equal(await draw(), undefined);
  assert.equal(reports.length, 1);
});
