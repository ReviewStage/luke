// @vitest-environment jsdom
import { it } from "@effect/vitest";
import type { DatabaseServices } from "@repo/database/core/query";
import type { MemberSeams } from "@repo/database/models/workspace-seams";
import { noDatabase } from "@repo/database/testing/no-database";
import { workspaceInvitationsProcedures } from "@repo/service/accounts/workspace-invitations-procedures";
import { githubProcedures } from "@repo/service/github/github-procedures";
import { hostedFetch } from "@repo/service/orpc/handler";
import type { WebServices } from "@repo/service/runtime";
import { type Context, Effect, Option } from "effect";
import { act } from "react";
import { afterEach, expect, vi } from "vitest";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const SESSION_PATH = "/api/auth/get-session";
const USER_ID = "user-ada";
const INVITED = "ada@example.com";

const PAGE_COOKIE = "better-auth.session_token=page";

const SIGNED_IN = {
  session: { id: "session-1", userId: USER_ID, expiresAt: "2099-01-01T00:00:00.000Z" },
  user: { id: USER_ID, email: INVITED, name: "Ada", emailVerified: true },
};

type Session = typeof USER_ID | null;

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
      const headers = new Headers(init?.headers);
      if (init?.credentials === "include") headers.set("cookie", PAGE_COOKIE);
      return route(
        new Request(url, { method: init?.method ?? "GET", headers, body: init?.body ?? null }),
        services,
      );
    });
  });

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
    "the invitation page says Vespin could not be reached when the route refuses its session",
    () =>
      Effect.gen(function* () {
        yield* serve(null, []);
        const page = yield* openPage(
          "accept-invitation",
          `/accept-invitation.html?id=invitation-1&email=${INVITED}`,
        );

        yield* titled(page, "Vespin could not be reached");
      }),
  );

  it.effect(
    "the invitation page says Vespin could not be reached when the route's store does not answer",
    () =>
      Effect.gen(function* () {
        yield* serve(USER_ID, []);
        const page = yield* openPage(
          "accept-invitation",
          `/accept-invitation.html?id=invitation-1&email=${INVITED}`,
        );

        yield* titled(page, "Vespin could not be reached");
      }),
  );
});
