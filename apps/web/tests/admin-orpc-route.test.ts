// @vitest-environment jsdom

import { UsersScreen } from "@repo/panel/admin/screens/users";
import type { AdminViewer } from "@repo/service/admin/admin-access";
import { type AdminProcedureSeams, adminProcedures } from "@repo/service/admin/admin-procedures";
import { buildAdminUserList } from "@repo/service/admin/admin-users";
import { hostedFetch } from "@repo/service/orpc/handler";
import type { WebServices } from "@repo/service/runtime";
import { Context, Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { readLanded, underWebAdminDoors } from "./support/admin-doors";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const ADMIN: AdminViewer = { userId: "admin-1", role: "admin" };
const MEMBER: AdminViewer = { userId: "user-1", role: "user" };

type Sent = string;

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
                favorite: written.includes(`${viewer?.userId} account-ada true`),
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
    readWorkspace: unread,
    readReliability: unread,
  };
}

function serve(handed: AdminProcedureSeams, sent: Sent[]): void {
  const route = hostedFetch({ admin: adminProcedures(handed) });
  const services = Context.empty() as Context.Context<WebServices>;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input), window.location.href);
    const method = init?.method ?? "GET";
    sent.push(
      `${method} ${url.pathname}${url.search} ${init?.credentials} ${new Headers(init?.headers).get("content-type")}`,
    );
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
  window.localStorage.setItem("app-admin-sign-in-chosen", "true");
  const page = document.createElement("div");
  document.body.replaceChildren(page);
  root = createRoot(page);
  await act(async () => {
    root?.render(
      underWebAdminDoors(
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
      ),
    );
  });
  await readLanded(page);
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
  await vi.waitFor(() =>
    expect(
      page
        .querySelector('button[aria-label="Unfavorite Ada Lovelace"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true"),
  );
  await vi.waitFor(() =>
    expect(sent).toEqual([
      "GET /api/admin/users?scope=all&window=7 include null",
      "PUT /api/admin/favorite?id=account-ada include null",
      "GET /api/admin/users?scope=all&window=7 include null",
    ]),
  );
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

  await vi.waitFor(() => expect(page.textContent).toContain("Vespin admin"));
  expect(page.querySelector("table")).toBeNull();
});

test("an auth service that did not answer is said as the service not answering", async () => {
  serve({ ...seams(ADMIN, []), resolveViewer: () => Effect.die(new Error("auth is down")) }, []);
  const page = await mount();

  await vi.waitFor(() => expect(page.textContent).toContain("The service did not answer."));
});

test("an answer that came through a redirect is said as something in front of the API", async () => {
  window.localStorage.setItem("app-admin-sign-in-chosen", "true");
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
