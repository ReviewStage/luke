// @vitest-environment jsdom
import { it } from "@effect/vitest";
import type { DatabaseServices } from "@luke/database/core/query";
import type { MemberSeams } from "@luke/database/models/workspace-seams";
import { noDatabase } from "@luke/database/testing/no-database";
import { workspaceInvitationsProcedures } from "@luke/service/accounts/workspace-invitations-procedures";
import { githubProcedures } from "@luke/service/github/github-procedures";
import { hostedFetch } from "@luke/service/orpc/handler";
import type { WebServices } from "@luke/service/runtime";
import { type Context, Effect, Option } from "effect";
import { act } from "react";
import { afterEach, expect, vi } from "vitest";

/**
 * browser-pages-orpc-route.test.ts -- the GitHub connect page and the
 * invitation page over the hosted oRPC routes themselves, through the
 * pages' browser client, where the route refuses: the connect page offers a
 * sign-in when the route refuses the browser's session, and the invitation
 * page says Luke could not be reached, as it always did, whether the route
 * refuses its session or its store does not answer. What a route answers
 * when it does is read through the same client on a migrated database in
 * `browser-client-orpc-route.test.ts`, since a page here runs in jsdom,
 * where the database cannot open. Better Auth's session read is a fake; the
 * network between a page and the routes is a `fetch` that hands each
 * request to the route as the browser sent it.
 *
 * Synthetic accounts throughout.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const SESSION_PATH = "/api/auth/get-session";
const USER_ID = "user-ada";
const INVITED = "ada@example.com";

/** The deployment's session cookie the page's browser holds, which a request sent on the page's cookies carries. */
const PAGE_COOKIE = "better-auth.session_token=page";

const SIGNED_IN = {
  session: { id: "session-1", userId: USER_ID, expiresAt: "2099-01-01T00:00:00.000Z" },
  user: { id: USER_ID, email: INVITED, name: "Ada", emailVerified: true },
};

/** Whose Better Auth session the routes resolve: the signed-in account, or none. */
type Session = typeof USER_ID | null;

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

/**
 * The page's network: Better Auth's session read answered signed in, the
 * GitHub and workspace routes answered by the hosted oRPC handler on the
 * test's database under the session given, which the page's cookie names and
 * which a request the page sent on its cookies carries, as a browser does,
 * and anything else left hanging. Every path the page asked is kept in `asked`.
 */
const serve = (session: Session, asked: string[]) =>
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
    // SAFETY: the claim and the offer read the database alone, which is all a test provides of the web runtime's services, here one that refuses every statement.
    const services = (yield* Effect.context<DatabaseServices>()) as Context.Context<WebServices>;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input), window.location.href);
      asked.push(url.pathname);
      if (url.pathname === SESSION_PATH) {
        return new Response(JSON.stringify(SIGNED_IN), {
          headers: { "content-type": "application/json" },
        });
      }
      if (
        !url.pathname.startsWith("/api/github/") &&
        !url.pathname.startsWith("/api/workspaces/")
      ) {
        return new Promise<Response>(() => undefined);
      }
      // Note that the page's own abort signal is jsdom's, which Node's `Request` refuses, so the route is handed the rest.
      const headers = new Headers(init?.headers);
      if (init?.credentials === "include") headers.set("cookie", PAGE_COOKIE);
      return route(
        new Request(url, { method: init?.method ?? "GET", headers, body: init?.body ?? null }),
        services,
      );
    });
  });

/** The page `module` at `address`, mounted on its own `#root` as the browser mounts it. */
const openPage = (module: "connect-github" | "accept-invitation", address: string) =>
  Effect.promise(async () => {
    window.history.replaceState(null, "", address);
    const root = document.createElement("div");
    root.id = "root";
    document.body.replaceChildren(root);
    vi.resetModules();
    await act(async () => {
      await (module === "connect-github"
        ? import("../src/connect-github")
        : import("../src/accept-invitation"));
    });
    return root;
  });

/** The page's title, once it says `title`. */
const titled = (page: HTMLElement, title: string) =>
  Effect.promise(() => vi.waitFor(() => expect(page.querySelector("h1")?.textContent).toBe(title)));

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it.layer(noDatabase)("the browser pages over the oRPC routes, refused", (it) => {
  it.effect("the connect page offers a sign-in when the route refuses the browser's session", () =>
    Effect.gen(function* () {
      yield* serve(null, []);
      const page = yield* openPage("connect-github", "/connect-github.html?intent=intent-1");

      yield* titled(page, "Sign in to connect GitHub");
    }),
  );

  it.effect(
    "the invitation page says Luke could not be reached when the route refuses its session",
    () =>
      Effect.gen(function* () {
        yield* serve(null, []);
        const page = yield* openPage(
          "accept-invitation",
          `/accept-invitation.html?id=invitation-1&email=${INVITED}`,
        );

        yield* titled(page, "Luke could not be reached");
      }),
  );

  it.effect(
    "the invitation page says Luke could not be reached when the route's store does not answer",
    () =>
      Effect.gen(function* () {
        yield* serve(USER_ID, []);
        const page = yield* openPage(
          "accept-invitation",
          `/accept-invitation.html?id=invitation-1&email=${INVITED}`,
        );

        yield* titled(page, "Luke could not be reached");
      }),
  );
});
