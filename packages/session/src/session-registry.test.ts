import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_DISPOSITION,
  InMemorySessionRegistry,
  maximumSessionRecapLength,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  SESSION_STATUS,
  type SessionLocation,
  type SessionProvider,
} from "@sidecar/session";
import { maximumSessionLinkLength, supportsSessionControl } from "./session.js";

const codex: SessionProvider = { id: "codex", displayName: "Codex" };
const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const TEST_CONTROL = {
  OPEN: "open",
  INTERRUPT: "interrupt",
} as const;
const TEST_CONTROL_WITH_WHITESPACE = " open ";
const TEST_DEVIN_LINK = "https://app.devin.ai/sessions/devin-1";

function observation(
  providerSessionId: string,
  observedAt: number,
  overrides: Partial<ProviderSessionObservation> = {},
): ProviderSessionObservation {
  return {
    providerSessionId,
    title: "Implement the shared session core",
    status: SESSION_STATUS.WORKING,
    observedAt,
    ...overrides,
  };
}

test("normalizes provider observations without conflating provider-local identities", () => {
  const registry = new InMemorySessionRegistry();
  const session = registry.upsert(
    codex,
    observation("run:42", 100, {
      title: "  Implement the shared session core  ",
      parentProviderSessionId: "  run:parent  ",
      recap: `  ${"a".repeat(maximumSessionRecapLength + 1)}  `,
      controls: [{ id: TEST_CONTROL_WITH_WHITESPACE, label: " Open workspace " }],
    }),
  );
  registry.upsert(claude, observation("run:42", 90));

  assert.deepEqual(
    { providerId: session.providerId, providerSessionId: session.providerSessionId },
    { providerId: codex.id, providerSessionId: "run:42" },
  );
  assert.equal(session.title, "Implement the shared session core");
  assert.equal(session.parentProviderSessionId, "run:parent");
  assert.equal(session.recap?.length, maximumSessionRecapLength);
  assert.deepEqual(session.controls, [{ id: TEST_CONTROL.OPEN, label: "Open workspace" }]);
  assert.deepEqual(session.attention, {
    disposition: ATTENTION_DISPOSITION.SILENT,
    decidedAt: 100,
  });
  assert.equal(supportsSessionControl(session, TEST_CONTROL.OPEN), true);
  assert.equal(supportsSessionControl(session, TEST_CONTROL.INTERRUPT), false);
  assert.equal(registry.list().length, 2);
});

test("a workspace grouping is bounded, and one without an id is dropped whole", () => {
  const registry = new InMemorySessionRegistry();

  const grouped = registry.upsert(
    codex,
    observation("run:grouped", 100, {
      workspace: { providerWorkspaceId: "  workspace-1  ", name: "  lisbon-v2  " },
    }),
  );
  assert.deepEqual(grouped.workspace, { providerWorkspaceId: "workspace-1", name: "lisbon-v2" });

  // A workspace no sibling could ever be matched to groups nothing.
  const unidentified = registry.upsert(
    codex,
    observation("run:unidentified", 100, {
      workspace: { providerWorkspaceId: "   ", name: "lisbon-v2" },
    }),
  );
  assert.equal(unidentified.workspace, undefined);

  const ungrouped = registry.upsert(codex, observation("run:ungrouped", 100));
  assert.equal(ungrouped.workspace, undefined);

  // Grouping a session that was ungrouped is a change the registry must
  // notice on its own: the tray appears while nothing else moves.
  const before = registry.revision;
  registry.upsert(
    codex,
    observation("run:ungrouped", 100, {
      workspace: { providerWorkspaceId: "workspace-1", name: "lisbon-v2" },
    }),
  );
  assert.notEqual(registry.revision, before);
});

test("keeps several bounded app associations without changing the agent identity", () => {
  const registry = new InMemorySessionRegistry();
  const session = registry.upsert(
    codex,
    observation("run:applications", 100, {
      applications: [
        {
          id: SESSION_APPLICATION_ID.SUPERSET,
          displayName: " Superset ",
          scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
          link: "file:///tmp/not-openable",
        },
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          displayName: "Conductor",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
        {
          id: SESSION_APPLICATION_ID.CHATGPT,
          displayName: "ChatGPT",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
          link: "codex://threads/run%3Aapplications",
        },
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          displayName: "Duplicate",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
      ],
    }),
  );

  assert.equal(session.providerId, codex.id);
  assert.deepEqual(session.applications, [
    {
      id: SESSION_APPLICATION_ID.CHATGPT,
      displayName: "ChatGPT",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
      link: "codex://threads/run%3Aapplications",
    },
    {
      id: SESSION_APPLICATION_ID.CONDUCTOR,
      displayName: "Conductor",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
    },
    {
      id: SESSION_APPLICATION_ID.SUPERSET,
      displayName: "Superset",
      scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
    },
  ]);

  const revision = registry.revision;
  registry.upsert(
    codex,
    observation("run:applications", 100, {
      applications: [
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          displayName: "Conductor",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
      ],
    }),
  );
  assert.equal(registry.revision, revision + 1);
});

test("a session takes messages only when its adapter said so explicitly", () => {
  const registry = new InMemorySessionRegistry();
  const identity = { providerId: codex.id, providerSessionId: "run:message" };

  registry.upsert(codex, observation("run:message", 100));
  assert.equal(registry.get(identity)?.canReceiveMessage, false);

  // The flag flipping is a change the registry must notice on its own: the
  // reply affordance appears and disappears with it while nothing else moves.
  const before = registry.revision;
  registry.upsert(codex, observation("run:message", 100, { canReceiveMessage: true }));
  assert.equal(registry.get(identity)?.canReceiveMessage, true);
  assert.notEqual(registry.revision, before);
});

test("a change in the agents a session can start is a revision the surface hears", () => {
  const registry = new InMemorySessionRegistry();
  const identity = { providerId: codex.id, providerSessionId: "run:spawn" };
  const revisions: number[] = [];
  registry.subscribe((snapshot) => {
    revisions.push(snapshot.revision);
  });

  registry.upsert(codex, observation("run:spawn", 100));
  assert.deepEqual(registry.get(identity)?.spawnableAgents, []);

  // The roster flipping is a change the registry must notice on its own: the
  // agents a row offers to start appear and disappear with it while nothing
  // else moves.
  const before = registry.revision;
  registry.upsert(codex, observation("run:spawn", 100, { spawnableAgents: ["claude", "cursor"] }));
  assert.deepEqual(registry.get(identity)?.spawnableAgents, ["claude", "cursor"]);
  assert.equal(registry.revision, before + 1);
  assert.deepEqual(revisions, [before, before + 1]);
});

test("keeps only the addresses Luke would open, and never a shortened one", () => {
  const registry = new InMemorySessionRegistry();
  const linkFor = (link: string) =>
    registry.upsert(codex, observation("run:link", 100, { detail: { link } })).detail.link;

  for (const link of [
    "https://cursor.com/agents?id=bc_1",
    "codex://threads/019ff315-8735-7382-9fbe-16b0ea8ad990",
    "conductor://workspace?session=session-working",
    "superset://v2-workspace/019ff315-8735-7382-9fbe-16b0ea8ad990",
  ]) {
    assert.equal(linkFor(link), link, `${link} is a session's own address`);
  }
  assert.equal(linkFor("  https://app.devin.ai/sessions/devin-1  "), TEST_DEVIN_LINK);

  // A scheme outside the set never becomes a session's address, so nothing
  // downstream has to ask a second time whether an address is safe to open.
  for (const link of [
    "http://cursor.com/agents?id=bc_1",
    "file:///Users/dean/.claude/projects/luke/session.jsonl",
    "javascript:void 0",
    "/Users/dean/luke",
    "not a url",
    "",
  ]) {
    assert.equal(linkFor(link), undefined, `${link} is not an address Luke may open`);
  }

  // A link past the bound is dropped rather than cut: every other field is
  // shortened to fit a row, but a shortened address is a different address.
  assert.equal(linkFor(`https://example.com/${"a".repeat(maximumSessionLinkLength)}`), undefined);
});

test("a change is held to the web alone, and never a shortened one", () => {
  const registry = new InMemorySessionRegistry();
  const changeFor = (change: string) =>
    registry.upsert(codex, observation("run:change", 100, { detail: { change } })).detail.change;

  // The pull-request chip acts on this field the way pressing a row acts on
  // the link, so the same rule guards it — narrowed to https because every
  // pull request a provider reports lives on the web.
  assert.equal(
    changeFor("https://github.com/example/luke/pull/7"),
    "https://github.com/example/luke/pull/7",
  );
  for (const change of [
    "codex://threads/019ff315-8735-7382-9fbe-16b0ea8ad990",
    "file:///Users/dean/luke/pull.diff",
    "javascript:void 0",
    "not a url",
    "",
  ]) {
    assert.equal(changeFor(change), undefined, `${change} is not a change Luke may open`);
  }
  assert.equal(changeFor(`https://example.com/${"a".repeat(maximumSessionLinkLength)}`), undefined);
});

test("a session runs on this machine unless its provider observed it elsewhere", () => {
  const registry = new InMemorySessionRegistry();
  const local = registry.upsert(codex, observation("local", 100));
  const remote = registry.upsert(
    codex,
    observation("remote", 100, { location: SESSION_LOCATION.CLOUD }),
  );

  assert.equal(local.location, SESSION_LOCATION.LOCAL);
  assert.equal(remote.location, SESSION_LOCATION.CLOUD);
  // Where a session runs is the only thing that changed here, so a registry
  // that did not compare it would leave the panel showing the old row.
  const revision = registry.revision;
  registry.upsert(codex, observation("local", 100, { location: SESSION_LOCATION.CLOUD }));
  assert.equal(registry.revision, revision + 1);
  // A location a later build adds is rejected rather than shown as local.
  assert.throws(
    () =>
      registry.upsert(
        codex,
        // SAFETY: test deliberately supplies an out-of-vocabulary location to prove rejection.
        observation("elsewhere", 100, { location: "orbit" as SessionLocation }),
      ),
    /Unknown session location: orbit/,
  );
});

test("refresh atomically replaces one adapter's sessions and preserves attention decisions", async () => {
  const registry = new InMemorySessionRegistry();
  registry.upsert(codex, observation("stale", 10));
  registry.upsert(codex, observation("active", 20));
  registry.upsert(claude, observation("review", 30, { status: SESSION_STATUS.WAITING }));
  registry.setAttention(
    { providerId: "codex", providerSessionId: "active" },
    {
      disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
      decidedAt: 40,
      summary: "A review decision is ready.",
    },
  );

  await registry.refresh({
    provider: codex,
    observe: async () => [observation("active", 50), observation("new", 60)],
  });

  assert.deepEqual(
    registry.list().map(({ providerId, providerSessionId }) => ({ providerId, providerSessionId })),
    [
      { providerId: codex.id, providerSessionId: "new" },
      { providerId: codex.id, providerSessionId: "active" },
      { providerId: claude.id, providerSessionId: "review" },
    ],
  );
  assert.equal(
    registry.get({ providerId: "codex", providerSessionId: "active" })?.attention.disposition,
    ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
  );
  assert.equal(
    registry.get({ providerId: "claude-code", providerSessionId: "review" })?.status,
    SESSION_STATUS.WAITING,
  );
  assert.equal(registry.get({ providerId: "codex", providerSessionId: "stale" }), undefined);
});

test("ignores an older overlapping refresh after a newer provider snapshot is applied", async () => {
  const registry = new InMemorySessionRegistry();
  let resolveOlderObservation: ((value: readonly ProviderSessionObservation[]) => void) | undefined;
  const olderObservation = new Promise<readonly ProviderSessionObservation[]>((resolve) => {
    resolveOlderObservation = resolve;
  });

  const olderRefresh = registry.refresh({
    provider: codex,
    observe: async () => olderObservation,
  });
  await registry.refresh({
    provider: codex,
    observe: async () => [observation("active", 20, { title: "Newer observation" })],
  });

  if (!resolveOlderObservation) throw new Error("Older observation did not start");
  resolveOlderObservation([observation("active", 10, { title: "Older observation" })]);
  await olderRefresh;

  assert.equal(
    registry.get({ providerId: codex.id, providerSessionId: "active" })?.title,
    "Newer observation",
  );
});

test("ignores a stale malformed refresh after a newer provider snapshot is applied", async () => {
  const registry = new InMemorySessionRegistry();
  let resolveOlderObservation: ((value: readonly ProviderSessionObservation[]) => void) | undefined;
  const olderObservation = new Promise<readonly ProviderSessionObservation[]>((resolve) => {
    resolveOlderObservation = resolve;
  });
  const olderRefresh = registry.refresh({
    provider: codex,
    observe: async () => olderObservation,
  });
  await registry.refresh({
    provider: codex,
    observe: async () => [observation("active", 20, { title: "Newer observation" })],
  });

  if (!resolveOlderObservation) throw new Error("Older observation did not start");
  resolveOlderObservation([observation("duplicate", 10), observation("duplicate", 10)]);
  await olderRefresh;

  assert.equal(
    registry.get({ providerId: codex.id, providerSessionId: "active" })?.title,
    "Newer observation",
  );
});

test("keeps a valid refresh after a rejected or unchanged direct update", async () => {
  const registry = new InMemorySessionRegistry();
  registry.upsert(codex, observation("active", 10));
  let resolveObservation: ((value: readonly ProviderSessionObservation[]) => void) | undefined;
  const pendingObservation = new Promise<readonly ProviderSessionObservation[]>((resolve) => {
    resolveObservation = resolve;
  });
  const refresh = registry.refresh({
    provider: codex,
    observe: async () => pendingObservation,
  });

  registry.upsert(codex, observation("active", 10));
  assert.throws(
    () =>
      registry.replaceProvider(codex, [observation("duplicate", 20), observation("duplicate", 30)]),
    /Duplicate session observation: duplicate/,
  );

  if (!resolveObservation) throw new Error("Refresh observation did not start");
  resolveObservation([observation("active", 40, { title: "Refreshed observation" })]);
  await refresh;

  assert.equal(
    registry.get({ providerId: codex.id, providerSessionId: "active" })?.title,
    "Refreshed observation",
  );
});

test("registry snapshots are isolated and listeners only receive effective updates", () => {
  const registry = new InMemorySessionRegistry();
  const revisions: number[] = [];
  const unsubscribe = registry.subscribe((snapshot) => {
    revisions.push(snapshot.revision);
    const mutable = snapshot.sessions[0];
    if (mutable) mutable.title = "Changed outside the registry";
  });

  registry.upsert(codex, observation("active", 10));
  registry.upsert(codex, observation("active", 10));
  registry.setAttention(
    { providerId: "codex", providerSessionId: "active" },
    { disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN, decidedAt: 11 },
  );
  unsubscribe();
  registry.remove({ providerId: "codex", providerSessionId: "active" });

  assert.deepEqual(revisions, [1, 2]);
  assert.equal(registry.revision, 3);
  assert.equal(registry.list().length, 0);
});

test("a malformed provider snapshot leaves the previous registry state intact", () => {
  const registry = new InMemorySessionRegistry();
  registry.upsert(codex, observation("active", 10));

  assert.throws(
    () =>
      registry.replaceProvider(codex, [observation("duplicate", 20), observation("duplicate", 30)]),
    /Duplicate session observation: duplicate/,
  );
  assert.equal(registry.list().length, 1);
  assert.equal(
    registry.get({ providerId: "codex", providerSessionId: "active" })?.title,
    "Implement the shared session core",
  );
  assert.throws(
    () =>
      registry.replaceProvider({ id: " ", displayName: "Invalid" }, [observation("ignored", 20)]),
    /provider id must not be empty/,
  );
});

test("a snapshot's diff summary is the caller's copy, never the store's", () => {
  const registry = new InMemorySessionRegistry();
  registry.replaceProvider(codex, [
    observation("task-1", 1, {
      detail: { diff: { filesChanged: 3, linesAdded: 12, linesRemoved: 4 } },
    }),
  ]);

  const identity = { providerId: "codex", providerSessionId: "task-1" };
  const held = registry.get(identity);
  assert.ok(held?.detail.diff);
  held.detail.diff.linesAdded = 999;

  assert.equal(registry.get(identity)?.detail.diff?.linesAdded, 12);
});
