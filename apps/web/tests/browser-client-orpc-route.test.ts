import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import { openGitHubConnectIntent } from "@luke/database/models/github-connection-store";
import type { MemberSeams } from "@luke/database/models/workspace-seams";
import { invitation, member, organization, user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import { browserClient, browserRefusal } from "@luke/features/contract/browser-client";
import { GITHUB_CONNECT_CLAIM } from "@luke/features/github-connection-wire";
import { INVITATION_OFFER_REFUSAL } from "@luke/features/workspace-invitation-wire";
import { workspaceInvitationsProcedures } from "@luke/service/accounts/workspace-invitations-procedures";
import { githubProcedures } from "@luke/service/github/github-procedures";
import { hostedFetch } from "@luke/service/orpc/handler";
import type { WebServices } from "@luke/service/runtime";
import { type Context, Effect, Option } from "effect";
import { afterEach, vi } from "vitest";

/**
 * browser-client-orpc-route.test.ts -- what the GitHub connect page and the
 * invitation page read through their browser client, from the hosted oRPC
 * routes themselves on a migrated database: the claim of an intent as the
 * account it was made for, another account, or one the service never made;
 * an invitation's offer, and one the service does not hold; and a session
 * the route refuses, read as its status and slug. Each request leaves as
 * the pages' own did: on the page's cookies, and a body as JSON.
 *
 * Synthetic accounts throughout.
 */

const ORIGIN = "https://luke.test";
const ADA = "user-ada";
const GRACE = "user-grace";
const INVITED = "ada@example.com";

/** The deployment's session cookie the page's browser holds, which a request sent on the page's cookies carries. */
const PAGE_COOKIE = "better-auth.session_token=page";

/** A Better Auth call this test never makes, refused if it were. */
const unmade = () => Effect.die(new Error("this test makes no Better Auth call"));

const MEMBERS: MemberSeams = {
  inviteMember: unmade,
  listInvitations: unmade,
  cancelInvitation: unmade,
  removeMember: unmade,
  updateMemberRole: unmade,
  leaveOrganization: unmade,
  updateOrganization: unmade,
};

/** What a request carried as it left the client: its method, path, cookies, content type, and body. */
interface Sent {
  readonly line: string;
  readonly body: string | undefined;
}

/**
 * The browser's network: every request the client sends handed to the
 * GitHub and workspace routes on the test's database, carrying the page's
 * cookie where the client sent it on the page's cookies, as a browser does,
 * and kept in `sent`. The page's cookie names the session given.
 */
const serve = (session: string | null, sent: Sent[] = []) =>
  Effect.gen(function* () {
    const resolveSessionUserId = (request: Request) =>
      Effect.succeed(
        Option.fromNullishOr(request.headers.get("cookie") === PAGE_COOKIE ? session : null),
      );
    const route = hostedFetch({
      github: githubProcedures({
        resolveUserId: () => Effect.succeed(Option.none()),
        resolveSessionUserId,
        unlinkGitHub: unmade,
      }),
      workspaceInvitations: workspaceInvitationsProcedures({
        resolveSessionUserId,
        members: MEMBERS,
      }),
    });
    // SAFETY: the claim and the offer read the database alone, which is all a test provides of the web runtime's services.
    const services = (yield* Effect.context<DatabaseServices>()) as Context.Context<WebServices>;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input), ORIGIN);
      // Note that a body the client sends is only ever the JSON text it serialized.
      const body = init?.body === undefined || init.body === null ? undefined : String(init.body);
      sent.push({
        line: `${init?.method} ${url.pathname}${url.search} ${init?.credentials} ${new Headers(init?.headers).get("content-type")}`,
        body,
      });
      const headers = new Headers(init?.headers);
      if (init?.credentials === "include") headers.set("cookie", PAGE_COOKIE);
      return route(
        new Request(url, { method: init?.method ?? "GET", headers, body: body ?? null }),
        services,
      );
    });
  });

/** A procedure's answer, or the refusal it failed with. */
const asked = <Answer>(call: () => Promise<Answer>) =>
  Effect.promise(() =>
    call().then(
      (answer) => ({ answer }),
      (cause: unknown) => ({ refused: browserRefusal(cause) }),
    ),
  );

/** Ada and Grace, under ids and addresses of the test's own `tag`, since the tests share one database. */
const insertAccounts = (tag = "") =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.insert(user).values([
      { id: `${ADA}${tag}`, name: "Ada", email: `ada${tag}@example.com`, emailVerified: true },
      {
        id: `${GRACE}${tag}`,
        name: "Grace",
        email: `grace${tag}@example.com`,
        emailVerified: true,
      },
    ]);
  });

/** A workspace Grace owns, with a pending invitation for Ada; answers the invitation's id. */
const insertInvitation = Effect.gen(function* () {
  const db = yield* Database;
  const createdAt = new Date(Date.UTC(2026, 0, 1));
  yield* db
    .insert(organization)
    .values({ id: "org-atlas", name: "Atlas", slug: "atlas", createdAt });
  yield* db.insert(member).values({
    id: "member-grace",
    organizationId: "org-atlas",
    userId: GRACE,
    role: "owner",
    createdAt,
  });
  yield* db.insert(invitation).values({
    id: "invitation-1",
    organizationId: "org-atlas",
    email: INVITED,
    role: "member",
    status: "pending",
    expiresAt: new Date(Date.UTC(2099, 0, 1)),
    inviterId: GRACE,
  });
  return "invitation-1";
});

afterEach(() => {
  vi.restoreAllMocks();
});

it.layer(getTestDB())("the browser client over the oRPC routes", (it) => {
  it.effect("a claim reads as the account it was made for, another account, or expired", () =>
    Effect.gen(function* () {
      yield* insertAccounts("-claim");
      const intent = yield* openGitHubConnectIntent(`${ADA}-claim`);
      const sent: Sent[] = [];

      yield* serve(`${ADA}-claim`, sent);
      assert.deepEqual(yield* asked(() => browserClient.github.claim({ intent })), {
        answer: { claim: GITHUB_CONNECT_CLAIM.CLAIMED },
      });
      assert.deepEqual(yield* asked(() => browserClient.github.claim({ intent: "never-made" })), {
        answer: { claim: GITHUB_CONNECT_CLAIM.EXPIRED },
      });
      yield* serve(`${GRACE}-claim`);
      assert.deepEqual(yield* asked(() => browserClient.github.claim({ intent })), {
        answer: { claim: GITHUB_CONNECT_CLAIM.OTHER_ACCOUNT },
      });

      assert.deepEqual(sent[0], {
        line: "POST /api/github/connect/claim include application/json",
        body: JSON.stringify({ intent }),
      });
    }),
  );

  it.effect("a claim the route refuses reads as its status and slug", () =>
    Effect.gen(function* () {
      yield* serve(null);
      assert.deepEqual(yield* asked(() => browserClient.github.claim({ intent: "intent-1" })), {
        refused: { status: 401, error: HOSTED_API_ERROR.INVALID_TOKEN },
      });
    }),
  );

  it.effect(
    "an offer reads as the workspace it names, or as spent where the service holds none",
    () =>
      Effect.gen(function* () {
        yield* insertAccounts();
        const id = yield* insertInvitation;
        const sent: Sent[] = [];
        yield* serve(ADA, sent);

        assert.deepEqual(yield* asked(() => browserClient.workspaceInvitations.offer({ id })), {
          answer: {
            offer: {
              id,
              workspaceName: "Atlas",
              role: "member",
              inviter: { name: "Grace", email: "grace@example.com" },
            },
          },
        });
        assert.deepEqual(
          yield* asked(() => browserClient.workspaceInvitations.offer({ id: "invitation-gone" })),
          { answer: { refused: INVITATION_OFFER_REFUSAL.SPENT } },
        );
        assert.deepEqual(sent[0], {
          line: "GET /api/workspaces/invitations/offer?id=invitation-1 include null",
          body: undefined,
        });
      }),
  );
});
