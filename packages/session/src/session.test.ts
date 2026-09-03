import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSession,
  SESSION_STATUS,
  type Session,
  type SessionStatus,
  sessionChangeNumber,
} from "@sidecar/session";

const TEST_NOW = Date.parse("2026-08-16T12:00:00.000Z");
const _DAY_MS = 24 * 60 * 60 * 1000;

function _session(
  providerSessionId: string,
  status: SessionStatus,
  lastActivityAt: number,
): Session {
  return normalizeSession(
    { id: "codex", displayName: "Codex" },
    { providerSessionId, title: "Implement the shared session core", status, lastActivityAt },
  );
}

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

test("reads the pull request's number off every host's address shape", () => {
  assert.equal(sessionChangeNumber("https://github.com/reviewstage/luke/pull/245"), 245);
  assert.equal(
    sessionChangeNumber("https://gitlab.com/reviewstage/group/sidecar-web/-/merge_requests/3"),
    3,
  );
  assert.equal(
    sessionChangeNumber("https://bitbucket.org/reviewstage/sidecar-native/pull-requests/9"),
    9,
  );
});

test("an address whose tail names no number yields none rather than a guess", () => {
  assert.equal(sessionChangeNumber("https://github.com/reviewstage/luke/pulls"), undefined);
  assert.equal(
    sessionChangeNumber("https://github.com/reviewstage/luke/pull/245/files"),
    undefined,
  );
  assert.equal(sessionChangeNumber("not an address"), undefined);
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
