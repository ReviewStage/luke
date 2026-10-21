// @vitest-environment jsdom
import type { AdminViewer } from "@luke/service/admin/admin-access";
import { type AdminProcedureSeams, adminProcedures } from "@luke/service/admin/admin-procedures";
import { buildAdminUserList } from "@luke/service/admin/admin-users";
import { hostedFetch } from "@luke/service/orpc/handler";
import type { WebServices } from "@luke/service/runtime";
import { Context, Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { UsersScreen } from "../src/admin/screens/users";

/**
 * admin-orpc-route.test.ts -- the Users screen over the hosted oRPC route
 * itself, through the page's browser client: an admin reads the roster and
 * stars an account for themselves, a signed-in non-admin is refused as
 * before, a signed-out browser is offered the sign-in, an auth outage is
 * said as the service not answering, and an answer that came through a
 * redirect is said as something standing in front of the API. The route's
 * seams are fakes; the network between the page and the route is a `fetch`
 * that hands each request to the route as the browser sent it.
 *
 * Synthetic accounts throughout.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const ADMIN: AdminViewer = { userId: "admin-1", role: "admin" };
const MEMBER: AdminViewer = { userId: "user-1", role: "user" };

/** What the page sent, as the route saw it: its method, path, and query. */
type Sent = string;

/** The admin resource's seams: the viewer given, a roster of one account, and a star that lands. */
function seams(viewer: AdminViewer | null, written: string[]): AdminProcedureSeams {
  const unread = () => Effect.die(new Error("this screen reads only the roster"));
  return {
    resolveViewer: () => Effect.succeed(viewer ?? undefined),
    readUsers: (now, _scope, _viewerId, windowDays, search) =>
      Effect.succeed(
        buildAdminUserList(
          {
            total: 1,
            signIn: { accounts: 1, methods: { github: 1, google: 0, other: 0 } },
            rows: [
              {
                id: "account-ada",
                name: "Ada Lovelace",
                email: "ada@example.test",
                image: null,
                admin: false,
                createdAt: Date.UTC(2026, 8, 1),
                activeDays: 3,
                lastActiveDay: null,
                lastSeenAt: null,
                calls: 12,
                favorite: false,
              },
            ],
          },
          now,
          windowDays,
          search,
        ),
      ),
    writeFavorite: (adminId, userId, favorite) =>
      Effect.sync(() => {
        written.push(`${adminId} ${userId} ${favorite}`);
        return true;
      }),
    readMetrics: unread,
    readCost: unread,
    readUser: unread,
    readDay: unread,
    readWorkspaces: unread,
    readReliability: unread,
  };
}

/**
 * The page's network: each request handed to the hosted oRPC route over the
 * seams given, every one it sent kept in `sent`.
 */
function serve(handed: AdminProcedureSeams, sent: Sent[]): void {
  const route = hostedFetch({ admin: adminProcedures(handed) });
  // SAFETY: the fake seams read nothing of the web runtime's services, so the route runs on none.
  const services = Context.empty() as Context.Context<WebServices>;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input), window.location.href);
    const method = init?.method ?? "GET";
    sent.push(
      `${method} ${url.pathname}${url.search} ${init?.credentials} ${new Headers(init?.headers).get("content-type")}`,
    );
    // Note that the page's own abort signal is jsdom's, which Node's `Request` refuses, so the route is handed the rest.
    return route(
      new Request(url, { method, headers: init?.headers ?? {}, body: init?.body ?? null }),
      services,
    );
  });
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.replaceChildren();
});

async function mount(): Promise<HTMLElement> {
  window.localStorage.setItem("luke-admin-sign-in-chosen", "true");
  const page = document.createElement("div");
  document.body.replaceChildren(page);
  root = createRoot(page);
  await act(async () => {
    root?.render(
      createElement(UsersScreen, {
        hideAdmins: false,
        onHideAdminsChange: () => undefined,
        windowDays: 7,
        onWindowDaysChange: () => undefined,
        account: undefined,
        onSignOut: async () => undefined,
        onOpenAccount: () => undefined,
        frame: (content) => content,
      }),
    );
  });
  return page;
}

test("an admin reads the roster through the route and stars an account for themselves", async () => {
  const sent: Sent[] = [];
  const written: string[] = [];
  serve(seams(ADMIN, written), sent);
  const page = await mount();

  await vi.waitFor(() => expect(page.textContent).toContain("1 of 1 accounts"));
  const star = page.querySelector<HTMLButtonElement>('button[aria-label="Favorite Ada Lovelace"]');
  await act(async () => star?.click());

  await vi.waitFor(() => expect(written).toEqual(["admin-1 account-ada true"]));
  expect(
    page
      .querySelector('button[aria-label="Unfavorite Ada Lovelace"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(sent).toEqual([
    "GET /api/admin/users?scope=all&window=7 include null",
    "PUT /api/admin/favorite?id=account-ada include null",
  ]);
});

test("a signed-in non-admin is refused as before", async () => {
  serve(seams(MEMBER, []), []);
  const page = await mount();

  await vi.waitFor(() => expect(page.textContent).toContain("Not authorized"));
  expect(page.querySelector("table")).toBeNull();
});

test("a signed-out browser is offered the sign-in", async () => {
  serve(seams(null, []), []);
  const page = await mount();

  await vi.waitFor(() => expect(page.textContent).toContain("Luke admin"));
  expect(page.querySelector("table")).toBeNull();
});

test("an auth service that did not answer is said as the service not answering", async () => {
  serve({ ...seams(ADMIN, []), resolveViewer: () => Effect.die(new Error("auth is down")) }, []);
  const page = await mount();

  await vi.waitFor(() => expect(page.textContent).toContain("The service did not answer."));
});

test("an answer that came through a redirect is said as something in front of the API", async () => {
  window.localStorage.setItem("luke-admin-sign-in-chosen", "true");
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const login = new Response("<html>Sign in to Vercel</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(login, "redirected", { value: true });
    return login;
  });
  const page = await mount();

  await vi.waitFor(() =>
    expect(page.textContent).toContain("A preview deployment behind Vercel Deployment Protection"),
  );
});
