import assert from "node:assert/strict";
import test from "node:test";
import {
  ACT_KIND,
  type AdvertisedAct,
  advertisedActDisagreements,
  advertisedActFor,
  advertisedControls,
  maximumSessionDetailLength,
  normalizeSession,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type Session,
} from "@sidecar/session";

const TEST_NOW = Date.parse("2026-08-16T12:00:00.000Z");

test("the grouping manager's mark leads the row and the press follows it", () => {
  const normalized = normalizeSession(
    { id: "codex", displayName: "Codex" },
    {
      providerSessionId: "run:grouped",
      title: "Implement the shared session core",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: TEST_NOW,
      detail: { link: "codex://threads/run-grouped" },
      applications: [
        {
          id: "chatgpt",
          displayName: "ChatGPT",
          scope: "session",
          link: "codex://threads/run-grouped",
        },
        {
          id: "conductor",
          displayName: "Conductor",
          scope: "session",
          link: "conductor://workspace?id=ws&session=chat",
        },
      ],
      workspace: {
        providerWorkspaceId: "ws",
        name: "lisbon-v2",
        scopeId: "conductor",
        managerName: "Conductor",
      },
    },
  );

  // The manager that grouped the chat leads its marks ahead of the fixed
  // order, and the row's press follows the first linked mark — so the chat
  // opens where its manager holds it, with the agent's own route kept on its
  // own mark.
  assert.deepEqual(
    normalized.applications.map((application) => application.id),
    ["conductor", "chatgpt"],
  );
  assert.equal(normalized.detail.link, "conductor://workspace?id=ws&session=chat");
  assert.equal(normalized.applications[1]?.link, "codex://threads/run-grouped");
});

test("a manager without a linked mark cedes the press down the marks", () => {
  const normalized = normalizeSession(
    { id: "codex", displayName: "Codex" },
    {
      providerSessionId: "run:conductor",
      title: "Implement the shared session core",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: TEST_NOW,
      detail: { link: "codex://threads/run-conductor" },
      applications: [
        { id: "conductor", displayName: "Conductor", scope: "workspace" },
        {
          id: "chatgpt",
          displayName: "ChatGPT",
          scope: "session",
          link: "codex://threads/run-conductor",
        },
      ],
      workspace: {
        providerWorkspaceId: "worktree",
        scopeId: "conductor",
        managerName: "Conductor",
      },
    },
  );

  assert.deepEqual(
    normalized.applications.map((application) => application.id),
    ["conductor", "chatgpt"],
  );
  assert.equal(normalized.detail.link, "codex://threads/run-conductor");
});

test("an ungrouped row keeps the fixed mark order and its provider's press", () => {
  const normalized = normalizeSession(
    { id: "codex", displayName: "Codex" },
    {
      providerSessionId: "run:plain",
      title: "Implement the shared session core",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: TEST_NOW,
      detail: { link: "https://example.com/run-plain" },
      applications: [
        {
          id: "conductor",
          displayName: "Conductor",
          scope: "session",
          link: "conductor://workspace?id=ws&session=chat",
        },
        {
          id: "chatgpt",
          displayName: "ChatGPT",
          scope: "session",
          link: "codex://threads/run-plain",
        },
      ],
    },
  );

  // With no grouping there is no lead: the fixed order stands, and the press
  // follows the first linked mark it yields.
  assert.deepEqual(
    normalized.applications.map((application) => application.id),
    ["chatgpt", "conductor"],
  );
  assert.equal(normalized.detail.link, "codex://threads/run-plain");
});

test("the Claude app's own scheme is an address a row may open", () => {
  const normalized = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "cli-1",
      title: "Held by the Claude app",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: TEST_NOW,
      applications: [
        {
          id: "claude",
          displayName: "Claude",
          scope: "session",
          link: "claude://claude.ai/epitaxy/local_desk-1",
        },
      ],
    },
  );

  assert.equal(normalized.detail.link, "claude://claude.ai/epitaxy/local_desk-1");
  assert.equal(normalized.applications[0]?.link, "claude://claude.ai/epitaxy/local_desk-1");
});

test("keeps a sound diff summary and drops a suspect or empty one whole", () => {
  const withDiff = (diff: Parameters<typeof normalizeSession>[1]["detail"]) =>
    normalizeSession(
      { id: "codex", displayName: "Codex" },
      {
        providerSessionId: "task-1",
        title: "workspace",
        status: SESSION_STATUS.COMPLETE,
        lastActivityAt: TEST_NOW,
        detail: diff,
      },
    ).detail.diff;

  assert.deepEqual(withDiff({ diff: { filesChanged: 3, linesAdded: 12, linesRemoved: 4 } }), {
    filesChanged: 3,
    linesAdded: 12,
    linesRemoved: 4,
  });
  // A summary of nothing says nothing a row should spend words on.
  assert.equal(withDiff({ diff: { filesChanged: 0, linesAdded: 0, linesRemoved: 0 } }), undefined);
  // One count outside sense makes the others suspect, so the summary drops whole.
  assert.equal(
    withDiff({ diff: { filesChanged: -1, linesAdded: 12, linesRemoved: 4 } }),
    undefined,
  );
  assert.equal(
    withDiff({ diff: { filesChanged: 3, linesAdded: 12.5, linesRemoved: 4 } }),
    undefined,
  );
  assert.equal(
    withDiff({ diff: { filesChanged: 3, linesAdded: 12, linesRemoved: 1_000_000 } }),
    undefined,
  );
});

test("keeps the agent behind a hosted session, and drops one saying nothing", () => {
  const withAgent = (agent: Parameters<typeof normalizeSession>[1]["agent"]) =>
    normalizeSession(
      { id: "conductor", displayName: "Conductor" },
      {
        providerSessionId: "chat-1",
        title: "Hosted chat",
        status: SESSION_STATUS.WORKING,
        lastActivityAt: TEST_NOW,
        agent,
      },
    ).agent;

  assert.deepEqual(withAgent({ id: "claude-code", displayName: "Claude Code" }), {
    id: "claude-code",
    displayName: "Claude Code",
  });
  // An empty display name falls back to the id rather than to a blank mark.
  assert.deepEqual(withAgent({ id: "codex", displayName: "  " }), {
    id: "codex",
    displayName: "codex",
  });
  // An agent naming the provider itself says nothing the provider id does not.
  assert.equal(withAgent({ id: "conductor", displayName: "Conductor" }), undefined);
  assert.equal(withAgent({ id: "   ", displayName: "Claude Code" }), undefined);
  assert.equal(withAgent(undefined), undefined);
});

test("a developer hold rides a waiting session and is dropped on any other status", () => {
  const waiting = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "held",
      title: "Held for permission",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: TEST_NOW,
      holdingForDeveloper: true,
    },
  );
  assert.equal(waiting.holdingForDeveloper, true);

  const working = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "held",
      title: "Held for permission",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: TEST_NOW,
      holdingForDeveloper: true,
    },
  );
  assert.equal(working.holdingForDeveloper, undefined);
});

function advertising(advertises: readonly AdvertisedAct[]): Session {
  return normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "chat-1",
      title: "Advertised acts",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: TEST_NOW,
      advertises,
    },
  );
}

test("a control needs an id, and the same id twice is a contradiction", () => {
  assert.throws(() => advertising([{ kind: ACT_KIND.CONTROL, id: "  ", label: "Stop" }]), {
    message: "control id must not be empty",
  });
  assert.throws(
    () =>
      advertising([
        { kind: ACT_KIND.CONTROL, id: "stop", label: "Stop" },
        { kind: ACT_KIND.CONTROL, id: "stop", label: "Halt" },
      ]),
    { message: "Duplicate session control: stop" },
  );
});

test("a control's label falls back to its id, and its target is bounded", () => {
  const [control] = advertisedControls(
    advertising([{ kind: ACT_KIND.CONTROL, id: "stop", label: "   ", target: "t".repeat(400) }]),
  );

  assert.equal(control?.label, "stop");
  assert.equal(control?.target?.length, maximumSessionDetailLength);
});

test("a control kind this build does not know is dropped, the control kept", () => {
  const [control] = advertisedControls(
    advertising([
      // SAFETY: a provider naming a kind this build never learned is exactly
      // what the drop exists for, so the test has to be able to say one.
      { kind: ACT_KIND.CONTROL, id: "stop", label: "Stop", controlKind: "detonate" as never },
    ]),
  );

  assert.deepEqual(control, { kind: ACT_KIND.CONTROL, id: "stop", label: "Stop" });
});

test("an add-agent whose kinds all fall outside their bound advertises nothing", () => {
  assert.equal(
    advertisedActFor(
      advertising([{ kind: ACT_KIND.ADD_AGENT, agents: ["   "] }]),
      ACT_KIND.ADD_AGENT,
    ),
    undefined,
  );
  assert.deepEqual(
    advertisedActFor(
      advertising([{ kind: ACT_KIND.ADD_AGENT, agents: ["claude", "a".repeat(80)] }]),
      ACT_KIND.ADD_AGENT,
    ),
    { kind: ACT_KIND.ADD_AGENT, agents: ["claude"] },
  );
});

test("a workspace rename with nothing to rename advertises nothing", () => {
  assert.equal(
    advertisedActFor(
      advertising([{ kind: ACT_KIND.RENAME_WORKSPACE, target: "   " }]),
      ACT_KIND.RENAME_WORKSPACE,
    ),
    undefined,
  );
});

test("a singleton kind advertised twice keeps the first, and carries nothing else", () => {
  const session = advertising([
    { kind: ACT_KIND.RENAME_SESSION },
    { kind: ACT_KIND.RENAME_SESSION },
    { kind: ACT_KIND.MESSAGE },
    { kind: ACT_KIND.ADD_AGENT, agents: ["claude"] },
    { kind: ACT_KIND.ADD_AGENT, agents: ["codex"] },
  ]);

  assert.deepEqual(session.advertises, [
    { kind: ACT_KIND.RENAME_SESSION },
    { kind: ACT_KIND.MESSAGE },
    { kind: ACT_KIND.ADD_AGENT, agents: ["claude"] },
  ]);
});

test("an unadvertised session advertises nothing rather than nothing at all", () => {
  assert.deepEqual(
    normalizeSession(
      { id: "codex", displayName: "Codex" },
      {
        providerSessionId: "run-1",
        title: "Nothing advertised",
        status: SESSION_STATUS.WORKING,
        lastActivityAt: TEST_NOW,
      },
    ).advertises,
    [],
  );
});

test("an observation writing both says the same thing twice, or is reported", () => {
  const both = normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "chat-1",
      title: "Both written",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: TEST_NOW,
      advertises: [
        { kind: ACT_KIND.MESSAGE },
        { kind: ACT_KIND.RENAME_SESSION },
        { kind: ACT_KIND.RENAME_WORKSPACE, target: "ws-1" },
        { kind: ACT_KIND.ADD_AGENT, agents: ["claude"], target: "ws-1" },
        {
          kind: ACT_KIND.CONTROL,
          id: "stop",
          label: "Stop",
          controlKind: SESSION_CONTROL_KIND.STOP,
        },
      ],
      canReceiveMessage: true,
      canRename: true,
      renameTarget: "ws-1",
      spawnableAgents: ["claude"],
      spawnTarget: "ws-1",
      controls: [{ id: "stop", label: "Stop", kind: SESSION_CONTROL_KIND.STOP }],
    },
  );
  assert.deepEqual(advertisedActDisagreements(both), []);

  const advertisementOnly = advertising([{ kind: ACT_KIND.MESSAGE }]);
  assert.deepEqual(advertisedActDisagreements(advertisementOnly), [
    "canReceiveMessage: advertised true, kept false",
  ]);
});
