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

const DESKTOP = "desktop";
const ALLOWED_AT = new Date("2026-11-03T10:00:00Z");
const REFRESHED_AT = new Date("2026-11-04T09:00:00Z");
const MINTED_AT = new Date("2026-11-04T08:00:00Z");

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
    "a member lists their own consents, less the clients left out, and the named clients' live consentless tokens, with each one's newest refresh",
    () =>
      Effect.gen(function* () {
        const { owner, other, claude, codex } = yield* openGrants;
        const listed = { except: [DESKTOP], tokenOnly: [claude] };
        yield* allow(owner, claude);
        yield* allow(owner, DESKTOP);
        yield* allow(other, codex);
        yield* mint(owner, claude);
        yield* mint(owner, claude, { rotatedAt: REFRESHED_AT });
        yield* mint(owner, DESKTOP);
        yield* mint(owner, codex);
        yield* mint(other, claude, { mintedAt: MINTED_AT, rotatedAt: REFRESHED_AT });
        yield* mint(other, claude, { mintedAt: REFRESHED_AT });

        assert.deepEqual(yield* listOAuthGrants(owner, listed), [
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
        assert.deepEqual(yield* listOAuthGrants(other, listed), [
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
        yield* mint(other, claude, { rotatedAt: REFRESHED_AT });
        assert.deepEqual(yield* listOAuthGrants(other, listed), [codexGrant]);
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
