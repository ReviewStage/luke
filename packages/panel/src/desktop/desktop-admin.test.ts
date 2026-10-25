// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AdminUserList, AdminUserListRow } from "@luke/features/admin-answer-wire";
import {
  ADMIN_READ,
  ADMIN_REFUSED,
  ADMIN_UNANSWERED,
  type AdminReadAnswer,
} from "@luke/features/admin-wire";
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
import { menuItems, pressInPhoneHead, readPhoneHead } from "../testing/phone-head.js";
import { DesktopAdmin } from "./desktop-admin.js";

/**
 * desktop-admin.test.ts -- the app's Admin place stands in the task's place
 * as Automations does: its toolbar is the place's, titled Admin, with Open in
 * browser among its acts, and its sections are a bar under it, the one
 * standing chosen; it draws no way back of its own, and Escape leaves it.
 * Each view reads through the window's host (`admin.read`) rather than a
 * browser client, opens an account on a press rather than an address, is
 * blocked from the screen recording whole, and stands a refusal of the
 * service's gate as the app's own failure rather than a sign-in card.
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
  vi.restoreAllMocks();
});

/** The place on `view`, in `room`, every view it was asked to open and every exit written down. */
async function open(
  view: AdminView,
  options: { room?: ShellRoom } = {},
): Promise<{ page: HTMLElement; opened: AdminView[]; exits: number[] }> {
  const opened: AdminView[] = [];
  const exits: number[] = [];
  const page = document.body.appendChild(document.createElement("div"));
  root = createRoot(page);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopAdmin, {
          room: options.room ?? SHELL_ROOM.WIDE,
          view,
          shown: true,
          onOpen: (next) => opened.push(next),
          onExit: () => exits.push(1),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return { page, opened, exits };
}

/** The bar of sections, each option by its name and whether it is the one chosen. */
function sections(page: HTMLElement): { name: string; chosen: boolean }[] {
  const bar =
    page.querySelector('[role="radiogroup"][aria-label="Admin sections"]') ??
    assert.fail("the bar of sections");
  return [...bar.querySelectorAll<HTMLElement>('[role="radio"]')].map((option) => ({
    name: option.textContent ?? "",
    chosen: option.getAttribute("aria-checked") === "true",
  }));
}

/** The section option named `name`. */
function section(page: HTMLElement, name: string): HTMLElement {
  return (
    [...page.querySelectorAll<HTMLElement>('[role="radio"]')].find(
      (option) => option.textContent === name,
    ) ?? assert.fail(`the ${name} section`)
  );
}

test("a section stands under the place's own toolbar, titled Admin, with Open in browser among its acts and its sections a bar under it, the one standing chosen", async () => {
  const { page } = await open({ kind: "users" });

  assert.equal(page.querySelector("header.luke-toolbar h1")?.textContent, "Admin");
  assert.ok(page.querySelector('a[aria-label="Open in browser"][href="https://luke.test/admin"]'));
  assert.deepEqual(sections(page), [
    { name: "Overview", chosen: false },
    { name: "Cost", chosen: false },
    { name: "Reliability", chosen: false },
    { name: "Workspaces", chosen: false },
    { name: "Users", chosen: true },
  ]);
});

test("a section chosen in the bar opens it, Escape leaves the place, and no way back stands", async () => {
  const { page, opened, exits } = await open({ kind: "users" });

  act(() => section(page, "Cost").click());
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.EXIT_ADMIN));
  });

  assert.deepEqual(opened, [{ kind: "cost" }]);
  assert.equal(exits.length, 1);
  const names = [...page.querySelectorAll("button")].map((each) => each.getAttribute("aria-label"));
  assert.ok(!names.includes("Back"), "no way back stands");
});

test("on a phone a section is headed by Open in browser, the place's name and range centred, and its View options at the end, the sections a bar under it", async () => {
  let browsed = 0;
  fakeAppPlatform({ adminDashboard: () => ({ open: () => (browsed += 1) }) });
  const { page } = await open({ kind: "users" }, { room: SHELL_ROOM.NARROW });

  assert.deepEqual(readPhoneHead(page, "admin"), {
    start: ["Open in browser"],
    title: "Admin",
    end: ["View options"],
  });
  assert.match(page.querySelector(".admin-head")?.textContent ?? "", /Last 30 days/u);
  assert.equal(sections(page).find((each) => each.chosen)?.name, "Users");
  pressInPhoneHead(page, "admin", "View options");
  assert.deepEqual(
    menuItems().map((item) => item.label),
    ["Time range", "Include admins"],
  );
  pressInPhoneHead(page, "admin", "Open in browser");
  assert.equal(browsed, 1);
});

test("on a phone an account's page has one way back, to the section it stands under, in place of the crumb", async () => {
  // An account whose read is not answered stands its page and head over the failure.
  answer = { refused: ADMIN_UNANSWERED };
  const { page, opened } = await open({ kind: "account", id: ADA.id }, { room: SHELL_ROOM.NARROW });

  const head = readPhoneHead(page, "admin");
  assert.deepEqual(head.start, ["Users"]);
  assert.ok(head.end.length <= 1, "one control at most in the end corner");
  assert.equal(page.querySelector('.admin-head nav[aria-label="Path"]'), null, "no crumb");
  pressInPhoneHead(page, "admin", "Users");
  assert.deepEqual(opened, [{ kind: "users" }]);
});

test("a wide room heads an account's page by its crumb back to its section, with no bar of sections and no phone's header", async () => {
  answer = { refused: ADMIN_UNANSWERED };
  const { page } = await open({ kind: "account", id: ADA.id });

  assert.equal(page.querySelector('header[data-look="phone"]'), null);
  assert.ok(page.querySelector('nav[aria-label="Path"]'), "the view's crumb leads back");
  assert.equal(page.querySelector('[aria-label="Admin sections"]'), null);
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
    '.page-find > .find-bar input[aria-label="Find"]',
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
    page.querySelector('[role="search"][aria-label="Find"] .luke-search-field-tally')?.textContent,
    "1 of 1",
  );
});
