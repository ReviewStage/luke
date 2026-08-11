import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemorySessionRegistry,
  maximumSessionSummaryLength,
  type ProviderSessionObservation,
  type SessionProvider,
  sessionKey,
  supportsSessionControl,
} from "../src";

const codex: SessionProvider = { id: "codex", displayName: "Codex" };
const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };

function observation(
  providerSessionId: string,
  observedAt: number,
  overrides: Partial<ProviderSessionObservation> = {},
): ProviderSessionObservation {
  return {
    providerSessionId,
    title: "Implement the shared session core",
    status: "working",
    observedAt,
    ...overrides,
  };
}

test("normalizes provider observations into bounded, collision-free session records", () => {
  const registry = new InMemorySessionRegistry();
  const session = registry.upsert(
    codex,
    observation("run:42", 100, {
      title: "  Implement the shared session core  ",
      summary: `  ${"a".repeat(maximumSessionSummaryLength + 1)}  `,
      controls: [{ id: " open ", label: " Open workspace " }],
    }),
  );

  assert.equal(session.id, "codex:run%3A42");
  assert.equal(session.title, "Implement the shared session core");
  assert.equal(session.summary?.length, maximumSessionSummaryLength);
  assert.deepEqual(session.controls, [{ id: "open", label: "Open workspace" }]);
  assert.deepEqual(session.attention, { disposition: "silent", decidedAt: 100 });
  assert.equal(supportsSessionControl(session, "open"), true);
  assert.equal(supportsSessionControl(session, "interrupt"), false);
  assert.equal(
    sessionKey({ providerId: "codex:local", providerSessionId: "run:42" }),
    "codex%3Alocal:run%3A42",
  );
});

test("refresh atomically replaces one adapter's sessions and preserves attention decisions", async () => {
  const registry = new InMemorySessionRegistry();
  registry.upsert(codex, observation("stale", 10));
  registry.upsert(codex, observation("active", 20));
  registry.upsert(claude, observation("review", 30, { status: "waiting" }));
  registry.setAttention(
    { providerId: "codex", providerSessionId: "active" },
    {
      disposition: "speak-at-turn-end",
      decidedAt: 40,
      summary: "A review decision is ready.",
    },
  );

  await registry.refresh({
    provider: codex,
    observe: async () => [observation("active", 50), observation("new", 60)],
  });

  assert.deepEqual(
    registry.list().map((session) => session.id),
    ["codex:new", "codex:active", "claude-code:review"],
  );
  assert.equal(
    registry.get({ providerId: "codex", providerSessionId: "active" })?.attention.disposition,
    "speak-at-turn-end",
  );
  assert.equal(
    registry.get({ providerId: "claude-code", providerSessionId: "review" })?.status,
    "waiting",
  );
  assert.equal(registry.get({ providerId: "codex", providerSessionId: "stale" }), undefined);
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
    { disposition: "speak-during-turn", decidedAt: 11 },
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
