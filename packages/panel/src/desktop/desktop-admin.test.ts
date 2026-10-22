// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AdminUserList, AdminUserListRow } from "@luke/features/admin-answer-wire";
import { ADMIN_READ, ADMIN_REFUSED, type AdminReadAnswer } from "@luke/features/admin-wire";
import { ACT_KIND } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import type { WireBoundaryInput } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { AdminView } from "../admin/routing.js";
import { runAppCommand } from "../app-commands.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { fakeActPortAnswering, type SentPortAct } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopAdmin } from "./desktop-admin.js";

/**
 * desktop-admin.test.ts -- the app's Admin place takes the window as
 * Settings does: its sections are listed where the sidebar stood, under its
 * name and the way back, the one standing marked, and a narrow room shows
 * the list or the view one at a time. Each view reads through the window's
 * host (`admin.read`) rather than a browser client, opens an account on a
 * press rather than an address, is blocked from the screen recording whole,
 * and stands a refusal of the service's gate as the app's own failure
 * rather than a sign-in card.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const ADA: AdminUserListRow = {
  id: "account-ada",
  name: "Ada Lovelace",
  email: "ada@example.test",
  image: null,
  admin: false,
  createdAt: Date.UTC(2026, 8, 1),
  activeDays: 12,
  lastActiveDay: "2026-10-12",
  lastSeenAt: Date.UTC(2026, 9, 12),
  calls: 1204,
  favorite: false,
};

/** A synthetic roster of one account. */
const ROSTER: AdminUserList = {
  generatedAt: Date.UTC(2026, 9, 14, 12),
  windowDays: 30,
  total: 1,
  limit: 500,
  search: undefined,
  signIn: { accounts: 1, methods: { github: 1, google: 0, other: 0 } },
  rows: [ADA],
};

/** An answer as the port carries it: JSON, as the host's act answers cross. */
function onTheWire(value: AdminReadAnswer): WireBoundaryInput {
  return JSON.parse(JSON.stringify(value)) as WireBoundaryInput;
}

let root: Root | undefined;
let sent: SentPortAct[] = [];
/** What the fake host answers every admin read with. */
let answer: AdminReadAnswer = { answer: ROSTER };

beforeEach(() => {
  sent = [];
  answer = { answer: ROSTER };
  localStorage.clear();
  fakeAppPlatform({ adminDashboard: () => ({ href: "https://luke.test/admin" }) });
  fakeActPortAnswering((request) => {
    sent.push(request);
    return Promise.resolve(request.kind === ACT_KIND.ADMIN_READ ? onTheWire(answer) : undefined);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  // After the window is gone, since a find bar clears its highlights as it goes.
  vi.unstubAllGlobals();
});

/** The place on `view`, in `room`, every view it was asked to open and every exit written down. */
async function open(
  view: AdminView,
  options: { room?: ShellRoom; listed?: boolean } = {},
): Promise<{ page: HTMLElement; opened: AdminView[]; exits: number[]; listings: number[] }> {
  const opened: AdminView[] = [];
  const exits: number[] = [];
  const listings: number[] = [];
  const { sidebar, history } = sidebarProps(tasksControl());
  const page = document.body.appendChild(document.createElement("div"));
  root = createRoot(page);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopAdmin, {
          sidebar,
          room: options.room ?? SHELL_ROOM.WIDE,
          history,
          view,
          listed: options.listed ?? false,
          onOpen: (next) => opened.push(next),
          onList: () => listings.push(1),
          onExit: () => exits.push(1),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return { page, opened, exits, listings };
}

/** The list's rows by their names. */
function rows(page: HTMLElement): HTMLElement[] {
  const list = page.querySelector('nav[aria-label="Admin sections"]') ?? assert.fail("the list");
  return [...list.querySelectorAll<HTMLElement>(".luke-nav-item")];
}

function row(page: HTMLElement, name: string): HTMLElement {
  return (
    rows(page).find((each) => each.querySelector(".luke-nav-item-name")?.textContent === name) ??
    assert.fail(`the ${name} row`)
  );
}

test("the sections are listed where the sidebar stood, under the place's name and the way back, the one standing marked", async () => {
  const { page } = await open({ kind: "users" });

  const names = rows(page).map((each) => each.querySelector(".luke-nav-item-name")?.textContent);
  assert.deepEqual(names, [
    "Back",
    "Overview",
    "Cost",
    "Reliability",
    "Workspaces",
    "Users",
    "Open in browser",
  ]);
  assert.equal(page.querySelector(".admin-sections-title")?.textContent, "Admin");
  assert.equal(row(page, "Users").getAttribute("aria-current"), "page");
  assert.equal(row(page, "Overview").getAttribute("aria-current"), null);
});

test("a section's row opens it, and Back leaves the place", async () => {
  const { page, opened, exits } = await open({ kind: "users" });

  act(() => row(page, "Cost").click());
  act(() => row(page, "Back").click());

  assert.deepEqual(opened, [{ kind: "cost" }]);
  assert.equal(exits.length, 1);
});

test("a narrow room shows the list or the view, one at a time, and the view's head leads back to the list", async () => {
  const listed = await open({ kind: "users" }, { room: SHELL_ROOM.NARROW, listed: true });
  assert.equal(listed.page.querySelector<HTMLElement>(".admin-sections")?.hidden, false);
  assert.equal(listed.page.querySelector<HTMLElement>(".admin-page")?.hidden, true);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const alone = await open({ kind: "users" }, { room: SHELL_ROOM.NARROW, listed: false });
  assert.equal(alone.page.querySelector<HTMLElement>(".admin-sections")?.hidden, true);
  const back = alone.page.querySelector<HTMLButtonElement>(".admin-page header button");
  assert.ok(back, "the view's head offers the way back to the list");
  act(() => back.click());
  assert.equal(alone.listings.length, 1);
});

test("the Users view reads its roster through the window's host and draws its accounts", async () => {
  const { page } = await open({ kind: "users" });

  const reads = sent.filter((request) => request.kind === ACT_KIND.ADMIN_READ);
  const [read] = reads;
  assert.equal(reads.length, 1);
  assert.ok(read !== undefined);
  assert.equal((read.payload as { procedure: string }).procedure, ADMIN_READ.USERS);
  assert.match(page.textContent ?? "", /Ada Lovelace/u);
});

test("a view's toolbar is the app's own, headed by its section's name, in the title bar's row with no drag strip over it", async () => {
  const { page } = await open({ kind: "users" });

  assert.equal(page.querySelector(".admin-page header.desktop-toolbar h1")?.textContent, "Users");
  assert.equal(page.querySelector(".admin-page .desktop-drag-strip"), null);
});

test("an account opens on a press, as a step of the place, and is no link to an address", async () => {
  const { page, opened } = await open({ kind: "users" });

  const name = [...page.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Ada Lovelace"),
  );
  assert.ok(name instanceof HTMLButtonElement, "the account's name is a button");
  assert.equal(page.querySelector('a[href*="user="]'), null);
  act(() => name.click());

  assert.deepEqual(opened, [{ kind: "account", id: ADA.id }]);
});

test("the place is blocked from the screen recording whole, since every view names other accounts", async () => {
  const { page } = await open({ kind: "users" });

  const roster = [...page.querySelectorAll("*")].find(
    (node) => node.textContent === "Ada Lovelace",
  );
  assert.ok(roster?.closest(".ph-no-capture"), "the roster stands inside the recording's block");
});

test("a refusal of the service's gate stands as the app's failure, offering no sign-in", async () => {
  answer = { refused: ADMIN_REFUSED.FORBIDDEN };
  const { page } = await open({ kind: "users" });

  assert.match(page.textContent ?? "", /does not have the admin role/u);
  assert.doesNotMatch(page.textContent ?? "", /Sign in with/u);
});

test("⌘F finds in the view standing, its bar under the view's toolbar, and counts the words it matches", async () => {
  // jsdom paints no highlights and lays nothing out; the find's are kept as a browser keeps them.
  vi.stubGlobal("CSS", { highlights: new Map() });
  vi.stubGlobal("Highlight", Set);
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  const { page } = await open({ kind: "users" });

  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.FIND), "⌘F is offered on the Admin place");
  });
  const field = page.querySelector<HTMLInputElement>(
    '.admin-page .page-find > search.find-bar input[aria-label="Find"]',
  );
  assert.ok(field, "the find bar stands in the view's column");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      field,
      "Lovelace",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

  assert.equal(
    page.querySelector('search[aria-label="Find"] [aria-live="polite"]')?.textContent,
    "1 of 1",
  );
});

test("on a narrow stage with the section list standing, ⌘F is offered nothing, since the view it would find in is hidden", async () => {
  await open({ kind: "users" }, { room: SHELL_ROOM.NARROW, listed: true });

  act(() => {
    assert.equal(runAppCommand(APP_COMMAND.FIND), false);
  });
  assert.equal(document.querySelector('search[aria-label="Find"]'), null);
});
