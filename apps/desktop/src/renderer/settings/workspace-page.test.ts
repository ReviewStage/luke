// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { WorkspaceInvitation } from "@luke/features/workspace-invitation-wire";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test } from "vitest";
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActResultFor,
  ALREADY_INVITED_REFUSAL,
  WORKSPACE_NOT_PERMITTED_REFUSAL,
} from "#shared/messages/acts";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { focusedSegment, pressKeyIn, readSegmented, segmentedGroup } from "#testing/segmented";
import { ProviderMark } from "../provider-marks";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE } from "../settings-anchors";
import { SETTINGS_SECTION } from "../settings-views";
import { WorkspacePage, type WorkspaceSettingsControl } from "./workspace-page";

/**
 * Settings' Workspace page over a bridge answering as the host would: the
 * picker chooses the workspace the page shows, a team workspace's members
 * are read and listed, the page holding itself back while they are, an
 * owner or an admin is offered Remove in a row's ⋯ for anyone but an owner,
 * a member leaves, a refusal the role earns says so, an owner or admin
 * invites by address and role and copies or cancels what is pending, and
 * every workspace's Integrations group, the first one's too, holds GitHub:
 * an owner's or an admin's to connect, or to manage from its one Manage
 * menu once connected, and a member's to read. Synthetic accounts.
 */

const OWNER: WorkspaceMember = {
  userId: "user-dana",
  name: "Dana",
  email: "dana@example.com",
  role: WORKSPACE_ROLE.OWNER,
};
const MEMBER: WorkspaceMember = {
  userId: "user-sam",
  name: "Sam",
  email: "sam@example.com",
  role: WORKSPACE_ROLE.MEMBER,
};

const ACME: Workspace = {
  id: "workspace-acme",
  name: "acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};
const FIRST: Workspace = {
  id: "workspace-personal",
  name: "Dana",
  slug: "dana",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

/** The members the test's service holds. */
let stored: WorkspaceMember[] = [];
/** Every act the section sent, in order. */
let sent: Act[] = [];
/** Whether the service refuses to read the invitations. */
let refuseInvitationsRead = false;
/** Whether the service refuses to read the members. */
let refuseMembersRead = false;
/** Whether the service refuses the next removal for the account's role. */
let refuseRemoval = false;
/** The invitations the test's service holds pending. */
let invitations: WorkspaceInvitation[] = [];
/** Whether the service refuses the next invitation as the address already invited. */
let refuseInvitation = false;
/** Where the first invitations read waits before answering what it read, so a test can hold it on the wire. */
let firstRead: Promise<void> | undefined;
/** Whether every invitations read after the first is refused, as a service that stopped answering refuses it. */
let refuseLaterReads = false;
/** Where the next invitation waits before the service makes it, so a test can hold it on the wire. */
let inviteHeld: Promise<void> | undefined;
/** Whether the browser could not be opened on GitHub's page. */
let refuseGitHubOpen = false;
/** Whether the service refuses the next GitHub disconnect for the account's role. */
let refuseGitHubDisconnect = false;

const done = (value: ActResultFor<ActKind>): ActOutcome => ({
  status: ACT_OUTCOME_STATUS.DONE,
  value,
});

/** The bridge, answering the section's acts the way the host would. */
function answer(request: Act): Promise<ActOutcome> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.WORKSPACE_MEMBERS_READ:
      if (refuseMembersRead) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Could not read." });
      }
      return Promise.resolve(done(stored));
    case ACT_KIND.WORKSPACE_MEMBER_REMOVE:
      if (refuseRemoval) {
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.REFUSED,
          reason: WORKSPACE_NOT_PERMITTED_REFUSAL,
        });
      }
      stored = stored.filter((member) => member.userId !== request.payload.userId);
      return Promise.resolve(done(stored));
    case ACT_KIND.WORKSPACE_INVITATIONS_READ: {
      if (refuseInvitationsRead) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Could not read." });
      }
      const read = invitations;
      const held = firstRead;
      firstRead = undefined;
      const reads = sent.filter((one) => one.kind === ACT_KIND.WORKSPACE_INVITATIONS_READ).length;
      if (refuseLaterReads && reads > 1) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Could not read." });
      }
      return (held ?? Promise.resolve()).then(() => done(read));
    }
    case ACT_KIND.WORKSPACE_INVITE: {
      if (inviteHeld !== undefined) {
        const held = inviteHeld;
        inviteHeld = undefined;
        return held.then(() => answer({ ...request }));
      }
      if (refuseInvitation) {
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.REFUSED,
          reason: ALREADY_INVITED_REFUSAL,
        });
      }
      const made: WorkspaceInvitation = {
        id: `inv-${request.payload.email}`,
        email: request.payload.email,
        role: request.payload.role,
        expiresAt: "2026-10-16T12:00:00.000Z",
        acceptUrl: `https://tryluke.dev/accept-invitation.html?id=inv-${request.payload.email}`,
      };
      invitations = [...invitations, made];
      return Promise.resolve(done(made));
    }
    case ACT_KIND.WORKSPACE_INVITATION_CANCEL:
      invitations = invitations.filter((one) => one.id !== request.payload.invitationId);
      return Promise.resolve(done(invitations));
    case ACT_KIND.WORKSPACE_GITHUB_CONNECT:
      if (refuseGitHubOpen) {
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.REFUSED,
          reason: "Luke could not open your browser.",
        });
      }
      return Promise.resolve(done(undefined));
    case ACT_KIND.WORKSPACE_GITHUB_DISCONNECT:
      if (refuseGitHubDisconnect) {
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.REFUSED,
          reason: WORKSPACE_NOT_PERMITTED_REFUSAL,
        });
      }
      return Promise.resolve(done(undefined));
    case ACT_KIND.WORKSPACE_LEAVE:
    case ACT_KIND.WINDOW_COPY_TEXT:
      return Promise.resolve(done(undefined));
    default:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  stored = [OWNER, MEMBER];
  sent = [];
  refuseMembersRead = false;
  refuseInvitationsRead = false;
  refuseRemoval = false;
  invitations = [];
  refuseInvitation = false;
  firstRead = undefined;
  refuseLaterReads = false;
  inviteHeld = undefined;
  refuseGitHubOpen = false;
  refuseGitHubDisconnect = false;
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: { act: answer, recordSurfaceEvent: () => undefined },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

/** The page over `workspace` beside the account's first one, its picker choosing for itself, and how often a leave asked to fall back. */
async function mount(workspace: Workspace, others: readonly Workspace[] = []) {
  const pressed = { left: 0 };
  const workspaces = [FIRST, workspace, ...others].filter(
    (each, at, all) => all.findIndex((other) => other.id === each.id) === at,
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (workspaceId: string) => {
    const control: WorkspaceSettingsControl = {
      workspaces,
      workspaceId,
      onChooseWorkspace: (chosen) => render(chosen),
      listFailed: false,
      onRetryList: () => undefined,
      onLeft: () => {
        pressed.left += 1;
      },
    };
    act(() => root.render(createElement(WorkspacePage, { control })));
  };
  render(workspace.id);
  await settle();
  /** Stands the page again over another workspace, as a link naming it does. */
  const relist = async (next: Workspace) => {
    workspaces.push(next);
    render(next.id);
    await settle();
  };
  return { page: container, pressed, relist };
}

const buttons = (within: Element, words: string) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].filter(
    (each) => each.textContent === words && each.closest("[inert]") === null,
  );

const button = (within: Element, words: string) =>
  buttons(within, words)[0] ?? assert.fail(`no ${words} button`);

/** The page's row naming `name`. */
const rowNamed = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll<HTMLElement>(".settings-row")].find(
    (row) => row.querySelector("strong")?.textContent === name,
  ) ?? assert.fail(`no ${name} row`);

/** The rows of the invitations still pending, by the line each wears. */
const invitationRows = (page: HTMLElement) =>
  [...page.querySelectorAll<HTMLElement>(".settings-row")].filter((row) =>
    row.querySelector("small")?.textContent?.startsWith("Invited · "),
  );

/** The items of the ⋯ on `row`, or none where it draws no ⋯. */
function rowActions(row: HTMLElement): string[] {
  const ellipsis = row.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  if (ellipsis === null) return [];
  act(() => ellipsis.click());
  const items = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].map(
    (item) => item.textContent ?? "",
  );
  act(() => ellipsis.click());
  return items;
}

/** Chooses `label` from the ⋯ on `row`. */
async function chooseAction(row: HTMLElement, label: string): Promise<void> {
  const ellipsis =
    row.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ??
    assert.fail("the row draws no ⋯");
  act(() => ellipsis.click());
  const item =
    [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find(
      (each) => each.textContent === label,
    ) ?? assert.fail(`no ${label} in the row's menu`);
  act(() => item.click());
  await settle();
}

/** The confirm dialog a press raised. */
function dialog(): HTMLElement {
  return document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("no question");
}

/** Answers the standing question with its dangerous answer. */
async function confirm(verb: string): Promise<void> {
  act(() => button(dialog(), verb).click());
  await settle();
}

/** What the Workspace picker says under its name: the account's role. */
const pickerLine = (page: HTMLElement) =>
  rowNamed(page, "Workspace").querySelector("small")?.textContent;

test("the chosen team workspace's members are listed with their email and role, and a member is offered no Remove", async () => {
  const { page } = await mount(ACME);

  assert.deepEqual(
    sent.map((request) => request.kind),
    [ACT_KIND.WORKSPACE_MEMBERS_READ],
  );
  assert.equal(
    rowNamed(page, "Dana").querySelector("small")?.textContent,
    "dana@example.com · Owner",
  );
  assert.equal(
    rowNamed(page, "Sam").querySelector("small")?.textContent,
    "sam@example.com · Member",
  );
  assert.deepEqual(rowActions(rowNamed(page, "Sam")), []);
});

test("while the members are being read the page holds itself back, and a read that failed says so with Retry", async () => {
  refuseMembersRead = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const control: WorkspaceSettingsControl = {
    workspaces: [FIRST, ACME],
    workspaceId: ACME.id,
    onChooseWorkspace: () => undefined,
    onLeft: () => undefined,
    listFailed: false,
    onRetryList: () => undefined,
  };
  act(() => root.render(createElement(WorkspacePage, { control })));
  const heldBack = container.querySelector(".settings-reading") !== null;
  await settle();

  assert.equal(heldBack, true);
  assert.equal(
    container.querySelector('[role="alert"] .failure-note-words')?.textContent,
    "Could not read.",
  );
  refuseMembersRead = false;
  act(() => button(container, "Retry").click());
  await settle();
  assert.ok(rowNamed(container, "Sam"));
  assert.equal(container.querySelector(".settings-reading"), null);
});

test("an admin is offered Remove for a member but not for the owner, and Remove asks before it removes", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  assert.deepEqual(rowActions(rowNamed(page, "Dana")), []);
  await chooseAction(rowNamed(page, "Sam"), "Remove from workspace");
  const askedFirst = !sent.some((request) => request.kind === ACT_KIND.WORKSPACE_MEMBER_REMOVE);
  await confirm("Remove");

  assert.equal(askedFirst, true);
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.WORKSPACE_MEMBER_REMOVE)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id, userId: MEMBER.userId }],
  );
  assert.equal(
    [...page.querySelectorAll(".settings-row strong")].some((each) => each.textContent === "Sam"),
    false,
  );
});

test("a removal the account's role does not allow says so in the dialog that asked", async () => {
  refuseRemoval = true;
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });

  await chooseAction(rowNamed(page, "Sam"), "Remove from workspace");
  await confirm("Remove");

  assert.equal(
    dialog().querySelector('[role="alert"]')?.textContent,
    WORKSPACE_NOT_PERMITTED_REFUSAL,
  );
});

test("a member leaves after confirming, which asks to list another workspace, and an owner is offered no Leave", async () => {
  const member = await mount(ACME);
  const leaveRow = button(member.page, "Leave").closest(".settings-row") ?? assert.fail();
  act(() => button(leaveRow, "Leave").click());
  await confirm("Leave");

  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.WORKSPACE_LEAVE)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id }],
  );
  assert.equal(member.pressed.left, 1);

  const owner = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  assert.deepEqual(buttons(owner.page, "Leave"), []);
});

test("the account's first workspace reads like any other: its role, its members with the invite form, and Connect for its GitHub", async () => {
  stored = [OWNER];
  const { page } = await mount(FIRST);
  const row = rowNamed(page, "GitHub");
  act(() => button(row, "Connect").click());
  await settle();

  assert.equal(pickerLine(page), "Your role: Owner");
  assert.ok(page.querySelector(".workspace-invite"));
  assert.equal(
    rowNamed(page, "Dana").querySelector("small")?.textContent,
    "dana@example.com · Owner",
  );
  assert.deepEqual(
    sent.filter((request) => request.kind === ACT_KIND.WORKSPACE_GITHUB_CONNECT),
    [{ kind: ACT_KIND.WORKSPACE_GITHUB_CONNECT, payload: { workspaceId: FIRST.id } }],
  );
});

const CONNECTED: Workspace = {
  ...ACME,
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme-org", active: true },
};

/** The Workspace page's Integrations group, found by the anchor its links have always named. */
const integrationsGroup = (page: HTMLElement) =>
  page.querySelector<HTMLElement>(
    `[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${SETTINGS_SECTION.GITHUB_REPOSITORIES}"]`,
  ) ?? assert.fail("no Integrations group");

/** What a row says: its name, and the line under it. */
const rowWords = (row: HTMLElement) => [
  row.querySelector("strong")?.textContent,
  row.querySelector("small")?.textContent,
];

/** The words of every button a row draws. */
const rowButtons = (row: HTMLElement) =>
  [...row.querySelectorAll("button")].map((each) => each.textContent);

/** The row's Manage, which opens its menu. */
const manageOn = (row: HTMLElement) =>
  row.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ??
  assert.fail("the row draws no Manage");

/** The connects and disconnects sent, by their payloads. */
const githubSent = () =>
  sent.flatMap((request) =>
    request.kind === ACT_KIND.WORKSPACE_GITHUB_CONNECT ||
    request.kind === ACT_KIND.WORKSPACE_GITHUB_DISCONNECT
      ? [[request.kind, request.payload]]
      : [],
  );

test("an owner or an admin of a connected workspace sees Integrations' GitHub row, Connected, led by GitHub's mark, with Manage its one control", async () => {
  for (const role of [WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]) {
    const { page } = await mount({ ...CONNECTED, role });
    const group = integrationsGroup(page);
    const row = rowNamed(group, "GitHub");

    assert.equal(group.querySelector("h2")?.textContent, "Integrations");
    assert.deepEqual(rowWords(row), ["GitHub", "Connected"]);
    assert.equal(
      row.querySelector(".settings-row-mark")?.innerHTML,
      renderToStaticMarkup(createElement(ProviderMark, { provider: INTEGRATION_PROVIDER.GITHUB })),
    );
    assert.deepEqual(rowButtons(row), ["Manage"], `a ${role} has Manage and nothing else`);
    assert.equal(row.textContent?.includes("acme-org"), false, "the account is not named");
    assert.equal(row.textContent?.includes("Repositories"), false, "nor its repositories");
    for (const root of roots.splice(0)) act(() => root.unmount());
  }
});

test("Manage holds Choose repositories on GitHub, then past a rule Disconnect in red, and the first opens GitHub through the same connect", async () => {
  const { page } = await mount(CONNECTED);
  const row = rowNamed(page, "GitHub");

  act(() => manageOn(row).click());
  const menu = document.querySelector<HTMLElement>('[role="menu"]') ?? assert.fail("no menu");
  const drawn = [...menu.children].map((child) =>
    child.tagName === "HR" ? "rule" : child.textContent,
  );
  const red = menu.querySelector('[role="menuitem"][data-danger="true"]')?.textContent;
  act(() => manageOn(row).click());
  await chooseAction(row, "Choose repositories on GitHub");

  assert.equal(menu.getAttribute("aria-label"), "GitHub actions");
  assert.deepEqual(drawn, ["Choose repositories on GitHub", "rule", "Disconnect"]);
  assert.equal(red, "Disconnect");
  assert.deepEqual(githubSent(), [
    [ACT_KIND.WORKSPACE_GITHUB_CONNECT, { workspaceId: CONNECTED.id }],
  ]);
});

test("Disconnect from Manage asks first, naming the account, Cancel disconnects nothing, and Disconnect then disconnects", async () => {
  const { page } = await mount(CONNECTED);
  const row = rowNamed(page, "GitHub");

  await chooseAction(row, "Disconnect");
  const asked = [
    dialog().querySelector("h2")?.textContent,
    dialog().querySelector("p")?.textContent,
  ];
  act(() => button(dialog(), "Cancel").click());
  await settle();
  const afterCancel = githubSent();
  const cancelled = document.querySelector('[role="alertdialog"]');
  await chooseAction(row, "Disconnect");
  await confirm("Disconnect");

  assert.deepEqual(asked, [
    "Disconnect acme-org from acme?",
    "Its plans lose these repositories until GitHub is connected again.",
  ]);
  assert.deepEqual(afterCancel, []);
  assert.equal(cancelled, null);
  assert.deepEqual(githubSent(), [
    [ACT_KIND.WORKSPACE_GITHUB_DISCONNECT, { workspaceId: CONNECTED.id }],
  ]);
});

test("a disconnect the account's role does not allow says so in the dialog that asked", async () => {
  refuseGitHubDisconnect = true;
  const { page } = await mount(CONNECTED);

  await chooseAction(rowNamed(page, "GitHub"), "Disconnect");
  await confirm("Disconnect");

  assert.equal(
    dialog().querySelector('[role="alert"]')?.textContent,
    WORKSPACE_NOT_PERMITTED_REFUSAL,
  );
});

test("Escape in Manage's menu, and Cancel in the question it raised, hand focus back to Manage", async () => {
  const { page } = await mount(CONNECTED);
  const manage = manageOn(rowNamed(page, "GitHub"));

  act(() => manage.click());
  const firstFocused = document.activeElement?.textContent;
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  const afterEscape = document.activeElement;
  await chooseAction(rowNamed(page, "GitHub"), "Disconnect");
  act(() => button(dialog(), "Cancel").click());
  await settle();

  assert.equal(firstFocused, "Choose repositories on GitHub");
  assert.equal(afterEscape, manage);
  assert.equal(document.activeElement, manage);
  assert.equal(manage.getAttribute("aria-expanded"), "false");
});

test("a GitHub page the browser could not open is said under the row, from Manage and from Connect alike", async () => {
  refuseGitHubOpen = true;
  const connected = await mount(CONNECTED);
  await chooseAction(rowNamed(connected.page, "GitHub"), "Choose repositories on GitHub");
  const unconnected = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  act(() => button(rowNamed(unconnected.page, "GitHub"), "Connect").click());
  await settle();

  for (const { page } of [connected, unconnected]) {
    assert.equal(
      integrationsGroup(page).querySelector('.error-message[role="alert"]')?.textContent,
      "Luke could not open your browser.",
    );
  }
});

test("an installation GitHub suspended or removed says so in place of Connected, and Manage keeps both its items", async () => {
  const suspended = { ...CONNECTED, github: { login: "acme-org", active: false } };
  const admin = await mount(suspended);
  const adminRow = rowNamed(admin.page, "GitHub");
  const member = await mount({ ...suspended, role: WORKSPACE_ROLE.MEMBER });
  const memberRow = rowNamed(member.page, "GitHub");

  for (const row of [adminRow, memberRow]) {
    assert.deepEqual(rowWords(row), ["GitHub", "Suspended or removed on GitHub."]);
    assert.equal(row.querySelector('[data-state="attention"]')?.textContent, rowWords(row)[1]);
  }
  assert.deepEqual(rowActions(adminRow), ["Choose repositories on GitHub", "Disconnect"]);
  assert.deepEqual(rowButtons(memberRow), []);
});

test("an owner or an admin of a workspace with no GitHub is offered Connect alone, which opens the same connect", async () => {
  for (const role of [WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]) {
    const { page } = await mount({ ...ACME, role });
    const row = rowNamed(page, "GitHub");

    assert.deepEqual(rowWords(row), ["GitHub", "Not connected."]);
    assert.deepEqual(rowButtons(row), ["Connect"]);
    assert.equal(row.querySelector('[aria-haspopup="menu"]'), null);
    act(() => button(row, "Connect").click());
    await settle();
  }

  assert.deepEqual(githubSent(), [
    [ACT_KIND.WORKSPACE_GITHUB_CONNECT, { workspaceId: ACME.id }],
    [ACT_KIND.WORKSPACE_GITHUB_CONNECT, { workspaceId: ACME.id }],
  ]);
});

test("a member reads that GitHub is connected, or is told to ask an owner or admin, and is offered no Manage, Connect, or right-click menu", async () => {
  const connected = await mount({ ...CONNECTED, role: WORKSPACE_ROLE.MEMBER });
  const connectedRow = rowNamed(connected.page, "GitHub");
  const unconnected = await mount(ACME);
  const unconnectedRow = rowNamed(unconnected.page, "GitHub");

  assert.deepEqual(rowWords(connectedRow), ["GitHub", "Connected"]);
  assert.equal(connectedRow.textContent?.includes("acme-org"), false);
  assert.deepEqual(rowWords(unconnectedRow), ["GitHub", "Not connected. Ask an owner or admin."]);
  for (const row of [connectedRow, unconnectedRow]) {
    assert.equal(row.querySelector("button"), null);
    act(() => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    assert.equal(document.querySelector('[role="menu"]'), null);
  }
});

test("the picker shows another workspace on the page, the account's role, and its own members", async () => {
  const beta: Workspace = {
    ...ACME,
    id: "workspace-beta",
    name: "Beta",
    slug: "beta",
    role: WORKSPACE_ROLE.ADMIN,
  };
  const { page } = await mount(ACME, [beta]);
  const chip =
    page.querySelector<HTMLButtonElement>('button[aria-label="Workspace: acme"]') ??
    assert.fail("no picker naming acme");

  act(() => chip.click());
  const option =
    [...page.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (each) => each.textContent === "Beta",
    ) ?? assert.fail("no Beta in the picker");
  act(() => option.click());
  await settle();

  assert.ok(page.querySelector('button[aria-label="Workspace: Beta"]'), "the picker names Beta");
  assert.equal(pickerLine(page), "Your role: Admin");
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id }, { workspaceId: beta.id }],
  );
});

/** Types an address, chooses a role, and presses Invite in the page's form, as many times as asked before any answer. */
async function invite(page: HTMLElement, email: string, role: string, presses = 1): Promise<void> {
  const form = page.querySelector<HTMLFormElement>(".workspace-invite") ?? assert.fail("no form");
  const address = form.querySelector("input") ?? assert.fail("no address field");
  const roleWords = role === WORKSPACE_ROLE.ADMIN ? "Admin" : "Member";
  act(() => {
    // React reads a typed value off the element's own setter, as a keystroke sets it.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(address, email);
    address.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => button(form, roleWords).click());
  act(() => {
    for (let press = 0; press < presses; press += 1) form.requestSubmit();
  });
  await settle();
}

test("an admin invites an address as a role, sees it pending with its link to copy, and cancels it from its ⋯", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  await invite(page, "alan@example.com", WORKSPACE_ROLE.ADMIN);
  const row = invitationRows(page)[0] ?? assert.fail("no pending invitation");
  const listed = [
    row.querySelector("strong")?.textContent,
    row.querySelector("small")?.textContent,
  ];
  act(() => button(row, "Copy link").click());
  await chooseAction(row, "Cancel invitation");

  assert.deepEqual(listed, ["alan@example.com", "Invited · Admin"]);
  assert.deepEqual(invitationRows(page), []);
  assert.deepEqual(
    sent
      .filter((request) => request.kind !== ACT_KIND.WORKSPACE_MEMBERS_READ)
      .map((request) => [request.kind, "payload" in request ? request.payload : undefined]),
    [
      [ACT_KIND.WORKSPACE_INVITATIONS_READ, { workspaceId: ACME.id }],
      [
        ACT_KIND.WORKSPACE_INVITE,
        { workspaceId: ACME.id, email: "alan@example.com", role: WORKSPACE_ROLE.ADMIN },
      ],
      [ACT_KIND.WORKSPACE_INVITATIONS_READ, { workspaceId: ACME.id }],
      [
        ACT_KIND.WINDOW_COPY_TEXT,
        { words: "https://tryluke.dev/accept-invitation.html?id=inv-alan@example.com" },
      ],
      [
        ACT_KIND.WORKSPACE_INVITATION_CANCEL,
        { workspaceId: ACME.id, invitationId: "inv-alan@example.com" },
      ],
    ],
  );
});

test("an invitation's Role is a radio group, Member checked and the one stop for Tab, and an arrow chooses Admin, which the invitation is sent as", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });
  const form = page.querySelector<HTMLFormElement>(".workspace-invite") ?? assert.fail("no form");
  const role = segmentedGroup(form, "Role");
  const before = readSegmented(role);
  const address = form.querySelector("input") ?? assert.fail("no address field");

  pressKeyIn(role, "ArrowRight");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      address,
      "alan@example.com",
    );
    address.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const moved = focusedSegment();
  act(() => form.requestSubmit());
  await settle();

  assert.deepEqual(before, {
    options: ["Member", "Admin"],
    checked: ["Member"],
    tabStops: ["Member"],
  });
  assert.equal(moved, "Admin");
  assert.deepEqual(
    sent.flatMap((request) =>
      request.kind === ACT_KIND.WORKSPACE_INVITE ? [request.payload.role] : [],
    ),
    [WORKSPACE_ROLE.ADMIN],
  );
});

test("a first read still out when an invitation lands does not take the new invitation away", async () => {
  let release: () => void = () => undefined;
  firstRead = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  await invite(page, "alan@example.com", WORKSPACE_ROLE.MEMBER);
  release();
  await settle();

  assert.deepEqual(
    invitationRows(page).map((row) => row.querySelector("strong")?.textContent),
    ["alan@example.com"],
  );
});

test("an invitation made stays listed with its link when the read after it fails", async () => {
  refuseLaterReads = true;
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  await invite(page, "alan@example.com", WORKSPACE_ROLE.MEMBER);

  const row = invitationRows(page)[0] ?? assert.fail("the invitation was lost");
  assert.equal(row.querySelector("strong")?.textContent, "alan@example.com");
  assert.ok(button(row, "Copy link"));
});

test("Cancel invitation sends nothing while an invitation is on its way", async () => {
  invitations = [
    {
      id: "inv-sam",
      email: "sam@example.com",
      role: WORKSPACE_ROLE.MEMBER,
      expiresAt: "2026-10-16T12:00:00.000Z",
      acceptUrl: "https://tryluke.dev/accept-invitation.html?id=inv-sam",
    },
  ];
  let release: () => void = () => undefined;
  inviteHeld = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  await invite(page, "alan@example.com", WORKSPACE_ROLE.MEMBER);
  const row = invitationRows(page)[0] ?? assert.fail("no pending invitation");
  const ellipsis =
    row.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ?? assert.fail();
  act(() => ellipsis.click());
  const cancel =
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Cancel invitation",
    ) ?? assert.fail("no Cancel invitation");
  act(() => cancel.click());
  release();
  await settle();

  assert.equal(
    sent.some((request) => request.kind === ACT_KIND.WORKSPACE_INVITATION_CANCEL),
    false,
  );
});

test("Invite pressed again while one is on its way sends one invitation", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  // The second press lands before the first answer: the form refuses it.
  await invite(page, "alan@example.com", WORKSPACE_ROLE.MEMBER, 2);

  assert.equal(sent.filter((request) => request.kind === ACT_KIND.WORKSPACE_INVITE).length, 1);
  assert.equal(page.querySelector(".error-message"), null);
});

test("an address already invited is said under the form, and a member is offered no invitations", async () => {
  refuseInvitation = true;
  const admin = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  await invite(admin.page, "sam@example.com", WORKSPACE_ROLE.MEMBER);
  const member = await mount(ACME);
  await settle();

  assert.equal(
    admin.page.querySelector('.error-message[role="alert"]')?.textContent,
    ALREADY_INVITED_REFUSAL,
  );
  assert.deepEqual(invitationRows(admin.page), []);
  assert.equal(member.page.querySelector(".workspace-invite"), null);
  assert.equal(
    sent.filter((request) => request.kind === ACT_KIND.WORKSPACE_INVITATIONS_READ).length,
    1,
  );
});

test("a Disconnect asked for one workspace does not stand over another listed in its place", async () => {
  const { page, relist } = await mount(CONNECTED);
  await chooseAction(rowNamed(page, "GitHub"), "Disconnect");
  const asked = dialog().querySelector("h2")?.textContent;

  await relist({
    ...CONNECTED,
    id: "workspace-beta",
    name: "Beta",
    github: { login: "beta", active: true },
  });

  assert.equal(asked, "Disconnect acme-org from acme?");
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.equal(
    sent.some((request) => request.kind === ACT_KIND.WORKSPACE_GITHUB_DISCONNECT),
    false,
  );
});

test("Manage's menu left open on one workspace closes when another is listed in its place", async () => {
  const { page, relist } = await mount(CONNECTED);
  act(() => manageOn(rowNamed(page, "GitHub")).click());
  const opened = document.querySelector('[role="menu"]:not([data-leaving])') !== null;

  await relist({
    ...CONNECTED,
    id: "workspace-beta",
    name: "Beta",
    github: { login: "beta", active: true },
  });

  assert.equal(opened, true);
  assert.equal(document.querySelector('[role="menu"]:not([data-leaving])'), null);
  assert.equal(manageOn(rowNamed(page, "GitHub")).getAttribute("aria-expanded"), "false");
});

test("a workspaces read that failed says so with Retry, which asks for them again", () => {
  let retried = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const control: WorkspaceSettingsControl = {
    workspaces: [],
    workspaceId: undefined,
    onChooseWorkspace: () => undefined,
    onLeft: () => undefined,
    listFailed: true,
    onRetryList: () => {
      retried += 1;
    },
  };
  act(() => root.render(createElement(WorkspacePage, { control })));

  assert.equal(
    container.querySelector('[role="alert"] .failure-note-words')?.textContent,
    "Your workspaces could not be read.",
  );
  assert.equal(container.querySelector(".settings-reading"), null);
  act(() => button(container, "Retry").click());
  assert.equal(retried, 1);
});

test("an invitations read that failed says so with Retry in the list's place, which reads them again", async () => {
  invitations = [
    {
      id: "inv-sam",
      email: "sam@example.com",
      role: WORKSPACE_ROLE.MEMBER,
      expiresAt: "2026-10-16T12:00:00.000Z",
      acceptUrl: "https://tryluke.dev/accept-invitation.html?id=inv-sam",
    },
  ];
  refuseInvitationsRead = true;
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  assert.equal(
    [...page.querySelectorAll('[role="alert"] .failure-note-words')].some(
      (each) => each.textContent === "Could not read.",
    ),
    true,
  );
  refuseInvitationsRead = false;
  const retries = buttons(page, "Retry");
  assert.equal(retries.length, 1, "the members read, which landed, offers none");
  act(() => retries[0]?.click());
  await settle();

  assert.deepEqual(
    invitationRows(page).map((row) => row.querySelector("strong")?.textContent),
    ["sam@example.com"],
  );
});
