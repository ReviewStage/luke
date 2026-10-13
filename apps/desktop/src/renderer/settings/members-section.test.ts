// @vitest-environment jsdom

import assert from "node:assert/strict";
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
  WORKSPACE_NOT_PERMITTED_REFUSAL,
} from "#shared/messages/acts";
import { MembersSection, type WorkspaceSettingsControl } from "./members-section";

/**
 * Settings' Workspace section over a bridge answering as the host would: the
 * chosen team workspace's members are read and listed, an owner or an admin
 * is offered Remove for anyone but an owner, a member leaves and the
 * personal workspace is listed again, and a refusal the role earns says so.
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
};
const PERSONAL: Workspace = {
  id: "workspace-personal",
  name: "Personal",
  personal: true,
  role: WORKSPACE_ROLE.OWNER,
};

/** The members the test's service holds. */
let stored: WorkspaceMember[] = [];
/** Every act the section sent, in order. */
let sent: Act[] = [];
/** Whether the service refuses the next removal for the account's role. */
let refuseRemoval = false;

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
    case ACT_KIND.WORKSPACE_LEAVE:
      return Promise.resolve(done(undefined));
    default:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  stored = [OWNER, MEMBER];
  sent = [];
  refuseRemoval = false;
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

/** The section over `workspace`, keeping how often it asked to fall back and to install. */
async function mount(workspace: Workspace | undefined) {
  const pressed = { left: 0, installed: 0 };
  const control: WorkspaceSettingsControl = {
    workspace,
    onLeft: () => {
      pressed.left += 1;
    },
    onInstall: () => {
      pressed.installed += 1;
    },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(MembersSection, { control })));
  await settle();
  return { page: container, pressed };
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

test("the personal workspace lists no members and offers the install with who may install", async () => {
  const { page, pressed } = await mount(PERSONAL);
  act(() => button(page, "Install Luke on GitHub…").click());

  assert.deepEqual(sent, []);
  assert.equal(page.querySelectorAll(".workspace-member").length, 0);
  assert.match(
    page.textContent ?? "",
    /An org owner or a repository admin installs Luke on GitHub/u,
  );
  assert.equal(pressed.installed, 1);
});
