import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  user,
} from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import { listOAuthGrants, revokeOAuthClientTokens } from "../oauth-grants.js";

/**
 * A member's OAuth grants over a real dialect, as the provider leaves its
 * rows: a member lists only their own consents, less the clients left out,
 * each with its client's name and redirects and its newest refresh, and a
 * client that skipped consent by the live token it holds for them, until
 * it is revoked; and a revoke deletes that member's tokens for that client
 * and nobody else's.
 *
 * Synthetic accounts, clients, and tokens throughout.
 */

const DESKTOP = "desktop";
const ALLOWED_AT = new Date("2026-11-03T10:00:00Z");
const REFRESHED_AT = new Date("2026-11-04T09:00:00Z");
const MINTED_AT = new Date("2026-11-04T08:00:00Z");

/** Two accounts, and two outside clients beside a desktop client, as the provider registers them. */
const openGrants = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  const [claude, codex] = [`client-${randomUUID()}`, `client-${randomUUID()}`];
  yield* db
    .insert(user)
    .values([owner, other].map((id) => ({ id, name: "Test User", email: `${id}@app.test` })));
  yield* db.insert(oauthClient).values([
    {
      id: randomUUID(),
      clientId: claude,
      name: "Claude",
      redirectUris: ["https://claude.test/cb"],
    },
    { id: randomUUID(), clientId: codex, name: null, redirectUris: ["http://127.0.0.1/cb"] },
  ]);
  yield* db
    .insert(oauthClient)
    .values({ id: DESKTOP, clientId: DESKTOP, name: "Desktop", redirectUris: [] })
    .onConflictDoNothing();
  return { owner, other, claude, codex };
});

/** The member's Allow of a client, as the consent page leaves it. */
const allow = (userId: string, clientId: string) =>
  Database.use((db) =>
    db.insert(oauthConsent).values({
      id: randomUUID(),
      userId,
      clientId,
      scopes: ["vespin:mcp", "offline_access"],
      createdAt: ALLOWED_AT,
      updatedAt: ALLOWED_AT,
    }),
  );

/**
 * A refresh token the client holds for the member, minted and rotated where
 * given, with an access token naming it; a rotated one is revoked, as the
 * provider marks the token a refresh spends.
 */
const mint = (
  userId: string,
  clientId: string,
  { mintedAt = null, rotatedAt = null }: { mintedAt?: Date | null; rotatedAt?: Date | null } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const refreshId = randomUUID();
    yield* db.insert(oauthRefreshToken).values({
      id: refreshId,
      token: randomUUID(),
      userId,
      clientId,
      scopes: ["vespin:mcp", "offline_access"],
      createdAt: mintedAt,
      rotatedAt,
      revoked: rotatedAt,
    });
    yield* db.insert(oauthAccessToken).values({
      id: randomUUID(),
      token: randomUUID(),
      userId,
      clientId,
      refreshId,
      scopes: ["vespin:mcp"],
    });
  });

/** How many refresh and access tokens the client holds for the member. */
const held = (userId: string, clientId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const refresh = yield* db.select().from(oauthRefreshToken);
    const access = yield* db.select().from(oauthAccessToken);
    const theirs = (row: { userId: string | null; clientId: string }) =>
      row.userId === userId && row.clientId === clientId;
    return { refresh: refresh.filter(theirs).length, access: access.filter(theirs).length };
  });

it.layer(getTestDB())("a member's OAuth grants", (it) => {
  it.effect(
    "a member lists their own consents and live consentless tokens, less the clients left out, with each one's newest refresh",
    () =>
      Effect.gen(function* () {
        const { owner, other, claude, codex } = yield* openGrants;
        yield* allow(owner, claude);
        yield* allow(owner, DESKTOP);
        yield* allow(other, codex);
        yield* mint(owner, claude);
        yield* mint(owner, claude, { rotatedAt: REFRESHED_AT });
        yield* mint(owner, DESKTOP);
        yield* mint(owner, codex, { rotatedAt: REFRESHED_AT });
        yield* mint(other, claude, { mintedAt: MINTED_AT, rotatedAt: REFRESHED_AT });
        yield* mint(other, claude, { mintedAt: REFRESHED_AT });

        assert.deepEqual(yield* listOAuthGrants(owner, [DESKTOP]), [
          {
            clientId: claude,
            name: "Claude",
            redirectUris: ["https://claude.test/cb"],
            allowedAt: ALLOWED_AT,
            lastRefreshedAt: REFRESHED_AT,
          },
        ]);
        const codexGrant = {
          clientId: codex,
          name: null,
          redirectUris: ["http://127.0.0.1/cb"],
          allowedAt: ALLOWED_AT,
          lastRefreshedAt: null,
        };
        assert.deepEqual(yield* listOAuthGrants(other, [DESKTOP]), [
          {
            clientId: claude,
            name: "Claude",
            redirectUris: ["https://claude.test/cb"],
            allowedAt: MINTED_AT,
            lastRefreshedAt: REFRESHED_AT,
          },
          codexGrant,
        ]);

        yield* revokeOAuthClientTokens(other, claude);
        assert.deepEqual(yield* listOAuthGrants(other, [DESKTOP]), [codexGrant]);
      }),
  );

  it.effect("a revoke deletes that member's tokens for that client and nobody else's", () =>
    Effect.gen(function* () {
      const { owner, other, claude, codex } = yield* openGrants;
      yield* mint(owner, claude);
      yield* mint(owner, claude, { rotatedAt: REFRESHED_AT });
      yield* mint(owner, codex);
      yield* mint(other, claude);

      yield* revokeOAuthClientTokens(owner, claude);

      assert.deepEqual(yield* held(owner, claude), { refresh: 0, access: 0 });
      assert.deepEqual(yield* held(owner, codex), { refresh: 1, access: 1 });
      assert.deepEqual(yield* held(other, claude), { refresh: 1, access: 1 });
    }),
  );
});
