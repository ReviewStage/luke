import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_DISPOSITION,
  InMemorySessionRegistry,
  maximumSessionSummaryLength,
  type ProviderSessionObservation,
  SESSION_LOCATION,
  SESSION_STATUS,
  type SessionLocation,
  type SessionProvider,
  supportsSessionControl,
} from "../src";

const codex: SessionProvider = { id: "codex", displayName: "Codex" };
const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const TEST_CONTROL = {
  OPEN: "open",
  INTERRUPT: "interrupt",
} as const;
const TEST_CONTROL_WITH_WHITESPACE = " open ";

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
      summary: `  ${"a".repeat(maximumSessionSummaryLength + 1)}  `,
      controls: [{ id: TEST_CONTROL_WITH_WHITESPACE, label: " Open workspace " }],
    }),
  );
  registry.upsert(claude, observation("run:42", 90));

  assert.deepEqual(
    { providerId: session.providerId, providerSessionId: session.providerSessionId },
    { providerId: codex.id, providerSessionId: "run:42" },
  );
  assert.equal(session.title, "Implement the shared session core");
  assert.equal(session.summary?.length, maximumSessionSummaryLength);
  assert.deepEqual(session.controls, [{ id: TEST_CONTROL.OPEN, label: "Open workspace" }]);
  assert.deepEqual(session.attention, {
    disposition: ATTENTION_DISPOSITION.SILENT,
    decidedAt: 100,
  });
  assert.equal(supportsSessionControl(session, TEST_CONTROL.OPEN), true);
  assert.equal(supportsSessionControl(session, TEST_CONTROL.INTERRUPT), false);
  assert.equal(registry.list().length, 2);
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
    const mutable = snapshot.sessions[0] as { title: string } | undefined;
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
