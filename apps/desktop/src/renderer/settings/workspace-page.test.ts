// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { WorkspaceInvitation } from "@sidecar/hosted/workspace-invitation-wire";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@sidecar/hosted/workspace-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
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
import { WorkspacePage, type WorkspaceSettingsControl } from "./workspace-page";

/**
 * Settings' Workspace page over a bridge answering as the host would: the
 * picker chooses the workspace the page shows, a team workspace's members
 * are read and listed, an owner or an admin is offered Remove for anyone but
 * an owner, a member leaves, a refusal the role earns says so, an owner or
 * admin invites by address and role and copies or cancels what is pending,
 * and an owner or admin connects or disconnects the workspace's GitHub
 * repositories.
 * Synthetic accounts.
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
  personal: false,
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};
const PERSONAL: Workspace = {
  id: "workspace-personal",
  name: "Personal",
  personal: true,
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

/** The members the test's service holds. */
let stored: WorkspaceMember[] = [];
/** Every act the section sent, in order. */
let sent: Act[] = [];
/** Whether the service refuses the next removal for the account's role. */
let refuseRemoval = false;
/** The invitations the test's service holds pending. */
let invitations: WorkspaceInvitation[] = [];
/** Whether the service refuses the next invitation as the address already invited. */
let refuseInvitation = false;

const done = (value: ActResultFor<ActKind>): ActOutcome => ({
  status: ACT_OUTCOME_STATUS.DONE,
  value,
});

/** The bridge, answering the section's acts the way the host would. */
function answer(request: Act): Promise<ActOutcome> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.WORKSPACE_MEMBERS_READ:
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
    case ACT_KIND.WORKSPACE_INVITATIONS_READ:
      return Promise.resolve(done(invitations));
    case ACT_KIND.WORKSPACE_INVITE: {
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
    case ACT_KIND.WORKSPACE_LEAVE:
    case ACT_KIND.WORKSPACE_GITHUB_DISCONNECT:
    case ACT_KIND.WORKSPACE_GITHUB_CONNECT:
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
  refuseRemoval = false;
  invitations = [];
  refuseInvitation = false;
  Object.defineProperty(window, "sidecar", {
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

/** The page over `workspace` beside the personal one, its picker choosing for itself, and how often a leave asked to fall back. */
async function mount(workspace: Workspace, others: readonly Workspace[] = []) {
  const pressed = { left: 0 };
  const workspaces = [PERSONAL, workspace, ...others].filter(
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

const memberRow = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll<HTMLElement>(".workspace-member")].find(
    (row) => row.querySelector("strong")?.textContent === name,
  ) ?? assert.fail(`no ${name} row`);

/** The confirm dialog a press raised. */
function dialog(): HTMLElement {
  return document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("no question");
}

/** Answers the standing question with its dangerous answer. */
async function confirm(verb: string): Promise<void> {
  act(() => button(dialog(), verb).click());
  await settle();
}

test("the chosen team workspace's members are listed with their email and role, and a member is offered no Remove", async () => {
  const { page } = await mount(ACME);

  assert.deepEqual(
    sent.map((request) => request.kind),
    [ACT_KIND.WORKSPACE_MEMBERS_READ],
  );
  assert.equal(
    memberRow(page, "Dana").querySelector("small")?.textContent,
    "dana@example.com · Owner",
  );
  assert.equal(
    memberRow(page, "Sam").querySelector("small")?.textContent,
    "sam@example.com · Member",
  );
  assert.deepEqual(buttons(page, "Remove"), []);
});

test("an admin is offered Remove for a member but not for the owner, and Remove asks before it removes", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  assert.deepEqual(buttons(memberRow(page, "Dana"), "Remove"), []);
  const sam = memberRow(page, "Sam");
  act(() => button(sam, "Remove").click());
  const askedFirst = !sent.some((request) => request.kind === ACT_KIND.WORKSPACE_MEMBER_REMOVE);
  await confirm("Remove");

  assert.equal(askedFirst, true);
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.WORKSPACE_MEMBER_REMOVE)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id, userId: MEMBER.userId }],
  );
  assert.equal(page.querySelectorAll(".workspace-member").length, 1);
});

test("a removal the account's role does not allow says so in the dialog that asked", async () => {
  refuseRemoval = true;
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });

  const sam = memberRow(page, "Sam");
  act(() => button(sam, "Remove").click());
  await confirm("Remove");

  assert.equal(
    dialog().querySelector('[role="alert"]')?.textContent,
    WORKSPACE_NOT_PERMITTED_REFUSAL,
  );
});

test("a member leaves after confirming, which lists the personal workspace again, and an owner is offered no Leave", async () => {
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

test("the personal workspace says it is yours, lists no members, and offers its owner GitHub repositories", async () => {
  const { page } = await mount(PERSONAL);

  assert.deepEqual(sent, []);
  assert.equal(
    page.querySelector(".workspace-identity small")?.textContent,
    "Your personal workspace. Its plans are yours alone.",
  );
  assert.equal(page.querySelector(".workspace-member"), null);
  assert.equal(page.querySelector(".workspace-invite"), null);
  assert.ok(page.querySelector(".workspace-github"), "the owner is offered GitHub repositories");
});

test("an admin sees the team's GitHub organization and disconnects it after confirming", async () => {
  const { page } = await mount({
    ...ACME,
    role: WORKSPACE_ROLE.ADMIN,
    github: { login: "acme", active: true },
  });
  const row = page.querySelector(".workspace-github") ?? assert.fail("no GitHub row");

  act(() => button(row, "Disconnect").click());
  const askedFirst = !sent.some((request) => request.kind === ACT_KIND.WORKSPACE_GITHUB_DISCONNECT);
  await confirm("Disconnect");

  assert.equal(row.querySelector("strong")?.textContent, "Repositories from acme");
  assert.equal(askedFirst, true);
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.WORKSPACE_GITHUB_DISCONNECT)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id }],
  );
});

test("an owner of a workspace with no GitHub organization is offered Connect, a connected one Choose repositories on GitHub, and a member sees no GitHub repositories", async () => {
  const owner = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  act(() => button(owner.page, "Connect…").click());
  const admin = await mount({
    ...ACME,
    role: WORKSPACE_ROLE.ADMIN,
    github: { login: "acme", active: true },
  });
  const choose = admin.page.querySelector(".workspace-github") ?? assert.fail("no GitHub row");
  act(() => button(choose, "Choose repositories…").click());
  const member = await mount({ ...ACME, github: { login: "acme", active: true } });
  await settle();

  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.WORKSPACE_GITHUB_CONNECT)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id }, { workspaceId: ACME.id }],
  );
  assert.equal(member.page.querySelector(".workspace-github"), null);
});

test("the picker shows another workspace on the page, its name, the account's role, and its own members", async () => {
  const beta: Workspace = {
    ...ACME,
    id: "workspace-beta",
    name: "Beta",
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

  assert.equal(page.querySelector(".workspace-identity strong")?.textContent, "Beta");
  assert.equal(page.querySelector(".workspace-identity small")?.textContent, "Your role: Admin");
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id }, { workspaceId: beta.id }],
  );
});

/** Types an address, chooses a role, and presses Invite in the page's form. */
async function invite(page: HTMLElement, email: string, role: string): Promise<void> {
  const form = page.querySelector<HTMLFormElement>(".workspace-invite") ?? assert.fail("no form");
  const address = form.querySelector("input") ?? assert.fail("no address field");
  const chosen = form.querySelector("select") ?? assert.fail("no role choice");
  act(() => {
    // React reads a typed value off the element's own setter, as a keystroke sets it.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(address, email);
    address.dispatchEvent(new Event("input", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(chosen, role);
    chosen.dispatchEvent(new Event("change", { bubbles: true }));
  });
  act(() => form.requestSubmit());
  await settle();
}

test("an admin invites an address as a role, sees it pending with its link to copy, and cancels it", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  await invite(page, "alan@example.com", WORKSPACE_ROLE.ADMIN);
  const row = page.querySelector(".workspace-invitation") ?? assert.fail("no pending invitation");
  const listed = [
    row.querySelector("strong")?.textContent,
    row.querySelector("small")?.textContent,
  ];
  act(() => button(row, "Copy link").click());
  act(() => button(row, "Cancel").click());
  await settle();

  assert.deepEqual(listed, ["alan@example.com", "Admin"]);
  assert.equal(page.querySelector(".workspace-invitation"), null);
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

test("an address already invited is said under the form, and a member is offered no invitations", async () => {
  refuseInvitation = true;
  const admin = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  await invite(admin.page, "sam@example.com", WORKSPACE_ROLE.MEMBER);
  const member = await mount(ACME);
  await settle();

  assert.equal(admin.page.querySelector(".settings-note")?.textContent, ALREADY_INVITED_REFUSAL);
  assert.equal(admin.page.querySelector(".workspace-invitation"), null);
  assert.equal(member.page.querySelector(".workspace-invite"), null);
  assert.equal(
    sent.filter((request) => request.kind === ACT_KIND.WORKSPACE_INVITATIONS_READ).length,
    1,
  );
});

test("a Disconnect asked for one workspace does not stand over another listed in its place", async () => {
  const connected = {
    ...ACME,
    role: WORKSPACE_ROLE.ADMIN,
    github: { login: "acme", active: true },
  };
  const { page, relist } = await mount(connected);
  const row = page.querySelector(".workspace-github") ?? assert.fail("no GitHub row");
  act(() => button(row, "Disconnect").click());
  const asked = dialog().querySelector("h2")?.textContent;

  await relist({
    ...connected,
    id: "workspace-beta",
    name: "Beta",
    github: { login: "beta", active: true },
  });

  assert.equal(asked, "Disconnect acme from acme?");
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.equal(
    sent.some((request) => request.kind === ACT_KIND.WORKSPACE_GITHUB_DISCONNECT),
    false,
  );
});
