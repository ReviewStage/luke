import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import {
  PROVIDER_ID,
  PROVIDER_ID_LIST,
  PROVIDER_IDENTITY_BY_ID,
  type ProviderId,
} from "@sidecar/session";
import { Effect } from "effect";
import type { ProviderRegistration } from "../registrations.js";
import {
  builtProviders,
  DuplicateProviderRegistration,
  Providers,
  providersLayer,
} from "./registry.js";

const registrationFor = (providerId: ProviderId): ProviderRegistration => ({
  plugin: {
    provider: {
      id: providerId,
      displayName: PROVIDER_IDENTITY_BY_ID[providerId].displayName,
    },
    observe: async () => [],
    latest: () => [],
  },
});

describe("providersLayer", () => {
  it.effect("provides every registration once, by the id its plugin publishes", () =>
    Effect.gen(function* () {
      const registry = yield* Effect.provide(
        Providers,
        providersLayer(PROVIDER_ID_LIST.map(registrationFor)),
      );

      assert.equal(registry.size, PROVIDER_ID_LIST.length);
      assert.deepEqual([...registry.keys()].sort(), [...PROVIDER_ID_LIST].sort());
      for (const providerId of PROVIDER_ID_LIST) {
        assert.equal(registry.get(providerId)?.plugin.provider.id, providerId);
      }
    }),
  );

  it.effect("fails the build with the duplicate's own id", () =>
    Effect.gen(function* () {
      const refusal = yield* Effect.flip(
        Effect.provide(
          Providers,
          providersLayer([
            registrationFor(PROVIDER_ID.CLAUDE_CODE),
            registrationFor(PROVIDER_ID.CODEX),
            registrationFor(PROVIDER_ID.CLAUDE_CODE),
          ]),
        ),
      );

      assert.ok(refusal instanceof DuplicateProviderRegistration);
      assert.equal(refusal._tag, "DuplicateProviderRegistration");
      assert.equal(refusal.providerId, PROVIDER_ID.CLAUDE_CODE);
    }),
  );

  it.effect("holds no registry a duplicate refused", () =>
    Effect.gen(function* () {
      const built = yield* Effect.exit(
        Effect.scoped(
          builtProviders([registrationFor(PROVIDER_ID.OMP), registrationFor(PROVIDER_ID.OMP)]),
        ),
      );

      assert.equal(built._tag, "Failure");
    }),
  );

  it.effect("takes no registration at all", () =>
    Effect.gen(function* () {
      const registry = yield* Effect.scoped(builtProviders([]));

      assert.equal(registry.size, 0);
    }),
  );
});
