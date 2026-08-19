import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import type { EffectSessionProviderAdapter } from "../../src/effect/provider-adapter.js";
import {
  EffectInMemorySessionRegistry,
  toPromiseSessionRegistry,
} from "../../src/effect/session-registry.js";
import {
  ATTENTION_DISPOSITION,
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionProvider,
} from "../../src/session.js";

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
    status: SESSION_STATUS.WORKING,
    observedAt,
    ...overrides,
  };
}

class FakeEffectObserveAdapter
  implements Pick<EffectSessionProviderAdapter, "provider" | "observe">
{
  readonly provider: SessionProvider;

  constructor(
    provider: SessionProvider,
    private readonly observations: () => Effect.Effect<
      readonly ProviderSessionObservation[],
      never,
      never
    >,
  ) {
    this.provider = provider;
  }

  observe(): Effect.Effect<readonly ProviderSessionObservation[], never, never> {
    return this.observations();
  }
}

test("refresh atomically replaces one adapter's sessions and preserves attention decisions", async () => {
  const registry = new EffectInMemorySessionRegistry();
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

  await Effect.runPromise(
    registry.refresh({
      provider: codex,
      observe: () => Effect.succeed([observation("active", 50), observation("new", 60)]),
    }),
  );

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
  const registry = new EffectInMemorySessionRegistry();
  let resolveOlderObservation: ((value: readonly ProviderSessionObservation[]) => void) | undefined;

  const olderRefresh = Effect.runPromise(
    registry.refresh(
      new FakeEffectObserveAdapter(codex, () =>
        Effect.async((resume) => {
          resolveOlderObservation = (value) => resume(Effect.succeed(value));
        }),
      ),
    ),
  );
  await Effect.runPromise(
    registry.refresh({
      provider: codex,
      observe: () => Effect.succeed([observation("active", 20, { title: "Newer observation" })]),
    }),
  );

  if (!resolveOlderObservation) throw new Error("Older observation did not start");
  resolveOlderObservation([observation("active", 10, { title: "Older observation" })]);
  await olderRefresh;

  assert.equal(
    registry.get({ providerId: codex.id, providerSessionId: "active" })?.title,
    "Newer observation",
  );
});

test("ignores a stale malformed refresh after a newer provider snapshot is applied", async () => {
  const registry = new EffectInMemorySessionRegistry();
  let resolveOlderObservation: ((value: readonly ProviderSessionObservation[]) => void) | undefined;

  const olderRefresh = Effect.runPromise(
    registry.refresh(
      new FakeEffectObserveAdapter(codex, () =>
        Effect.async((resume) => {
          resolveOlderObservation = (value) => resume(Effect.succeed(value));
        }),
      ),
    ),
  );
  await Effect.runPromise(
    registry.refresh({
      provider: codex,
      observe: () => Effect.succeed([observation("active", 20, { title: "Newer observation" })]),
    }),
  );

  if (!resolveOlderObservation) throw new Error("Older observation did not start");
  resolveOlderObservation([observation("duplicate", 10), observation("duplicate", 10)]);
  await olderRefresh;

  assert.equal(
    registry.get({ providerId: codex.id, providerSessionId: "active" })?.title,
    "Newer observation",
  );
});

test("toPromiseSessionRegistry wraps refresh for promise-based adapters", async () => {
  const effectRegistry = new EffectInMemorySessionRegistry();
  effectRegistry.upsert(codex, observation("active", 10));
  const promiseRegistry = toPromiseSessionRegistry(effectRegistry);

  await promiseRegistry.refresh({
    provider: codex,
    observe: async () => [observation("active", 20, { title: "Refreshed through bridge" })],
  });

  assert.equal(
    promiseRegistry.get({ providerId: codex.id, providerSessionId: "active" })?.title,
    "Refreshed through bridge",
  );
  assert.equal(promiseRegistry.revision, effectRegistry.revision);
});

test("toPromiseSessionRegistry delegates synchronous operations", () => {
  const effectRegistry = new EffectInMemorySessionRegistry();
  const promiseRegistry = toPromiseSessionRegistry(effectRegistry);
  const revisions: number[] = [];

  promiseRegistry.subscribe((snapshot) => {
    revisions.push(snapshot.revision);
  });
  promiseRegistry.upsert(codex, observation("active", 10));
  promiseRegistry.setAttention(
    { providerId: codex.id, providerSessionId: "active" },
    { disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN, decidedAt: 11 },
  );

  assert.deepEqual(revisions, [1, 2]);
  assert.equal(promiseRegistry.list().length, 1);
  assert.equal(effectRegistry.list().length, 1);
});
