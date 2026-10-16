// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { WorkspaceInvitation } from "@luke/features/workspace-invitation-wire";
import {
  WORKSPACE_PHOTO_BOUNDS,
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActResultFor,
  ALREADY_INVITED_REFUSAL,
  WORKSPACE_NOT_PERMITTED_REFUSAL,
} from "@luke/host/acts";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE } from "@luke/settings/settings-anchors";
import { SETTINGS_SECTION } from "@luke/settings/settings-views";
import { ProviderMark } from "@luke/ui";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { dayAndTimeText } from "../planning/plan-time";
import { ToastHost } from "../toast";
import { WorkspacePage, type WorkspaceSettingsControl } from "./workspace-page";

/**
 * Settings' Workspace page over a bridge answering as the host would: it
 * shows the workspace the sidebar lists, with no picker of its own, and the
 * account's role in it, an owner or an admin renames
 * it in place and uploads or removes its photo while a member is offered
 * neither, a team workspace's members
 * are read and listed, the page holding itself back while they are, an
 * owner or an admin is offered Remove in a row's ⋯ for anyone but an owner,
 * a member leaves, a refusal the role earns says so, an owner or admin
 * invites by address and role and copies or cancels what is pending, and
 * every workspace's GitHub group, the first one's too, holds GitHub:
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
  pictureUrl: "https://avatars.githubusercontent.com/u/7",
};

/** The account reading the page: Dana, the owner. */
const READER_ID = OWNER.userId;

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
  personal: true,
};

/** The members the test's service holds. */
let stored: WorkspaceMember[] = [];
/** Every act the section sent, in order. */
let sent: Act[] = [];

/** The one repository the workspace's installation reaches. */
const RELAY_REPOSITORY = {
  owner: "acme",
  name: "relay",
  fullName: "acme/relay",
  defaultBranch: "main",
  private: true,
  updatedAt: 0,
};

/** The run commands set on this Mac, as the host keeps them. */
let runCommands: { workspaceId: string; repository: string; command: string }[] = [];
/** Whether the service refuses to read the invitations. */
let refuseInvitationsRead = false;
/** Whether the service refuses to read the members. */
let refuseMembersRead = false;
/** Where the next members read waits, holding what it read, so a test can land it after a write. */
let membersHeld: Promise<void> | undefined;
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
/** Whether the service refuses a rename for the account's role. */
let refuseRename = false;
/** Whether the service refuses a photo for the account's role. */
let refusePhoto = false;
/** Whether the service refuses a role change for the account's role. */
let refuseRole = false;
/** The automations the workspace holds, as the list answers them; absent, the list is not answered. */
let automations: { name: string; mine?: boolean }[] | undefined;

/** One automation of the workspace's, named and the reader's or not, as the list answers it. */
function automationOf(
  { name, mine }: { name: string; mine?: boolean },
  at: number,
): AutomationSummary {
  const summary: AutomationSummary = {
    id: `3f0e6f5c-7d1a-4f6e-9a55-${String(at + 1).padStart(12, "0")}`,
    planId: null,
    planName: null,
    workspaceId: ACME.id,
    name,
    enabled: true,
    pausedReason: null,
    trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
    action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Triage today's issues." },
    guards: AUTOMATION_DEFAULT_GUARDS,
    nextRunAt: null,
    lastRun: null,
    createdAt: 1,
  };
  return mine === undefined ? summary : { ...summary, mine };
}

const done = (value: ActResultFor<ActKind>): ActOutcome => ({
  status: ACT_OUTCOME_STATUS.DONE,
  value,
});

/** The bridge, answering the section's acts the way the host would. */
function answer(request: Act): Promise<ActOutcome> {
  // The Repositories group's acts are its own, kept apart from the rest the page sends.
  switch (request.kind) {
    case ACT_KIND.PLANNING_REPOSITORIES:
      return Promise.resolve(
        done({
          repositories: {
            installed: true,
            installationUrl: "https://github.com/apps/luke/installations/new",
            repositories: [RELAY_REPOSITORY],
          },
        }),
      );
    case ACT_KIND.PR_RUN_COMMANDS:
      return Promise.resolve(done({ commands: runCommands }));
    case ACT_KIND.PR_RUN_SET_COMMAND: {
      const { workspaceId, repository, command } = request.payload;
      runCommands = [
        ...runCommands.filter((each) => each.repository !== repository.toLowerCase()),
        ...(command === null
          ? []
          : [{ workspaceId, repository: repository.toLowerCase(), command }]),
      ];
      return Promise.resolve(done(undefined));
    }
  }
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.WORKSPACE_MEMBERS_READ:
      if (refuseMembersRead) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Could not read." });
      }
      if (membersHeld !== undefined) {
        const held = membersHeld;
        const read = stored;
        membersHeld = undefined;
        return held.then(() => done(read));
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
    case ACT_KIND.WORKSPACE_RENAME:
      if (refuseRename) {
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.REFUSED,
          reason: WORKSPACE_NOT_PERMITTED_REFUSAL,
        });
      }
      return Promise.resolve(done({ ...ACME, name: request.payload.name }));
    case ACT_KIND.WORKSPACE_PHOTO_SET:
      if (refusePhoto) {
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.REFUSED,
          reason: WORKSPACE_NOT_PERMITTED_REFUSAL,
        });
      }
      return Promise.resolve(
        done(request.payload.photo === null ? ACME : { ...ACME, photoVersion: "v2" }),
      );
    case ACT_KIND.WORKSPACE_MEMBER_ROLE: {
      if (refuseRole) {
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.REFUSED,
          reason: WORKSPACE_NOT_PERMITTED_REFUSAL,
        });
      }
      const { userId, role } = request.payload;
      stored = stored.map((member) => (member.userId === userId ? { ...member, role } : member));
      return Promise.resolve(done(stored));
    }
    case ACT_KIND.WORKSPACE_TRANSFER: {
      const { userId } = request.payload;
      stored = stored.map((member) =>
        member.userId === userId
          ? { ...member, role: WORKSPACE_ROLE.OWNER }
          : member.userId === READER_ID
            ? { ...member, role: WORKSPACE_ROLE.ADMIN }
            : member,
      );
      return Promise.resolve(done(stored));
    }
    case ACT_KIND.AUTOMATIONS_LIST:
      if (automations === undefined)
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
      return Promise.resolve(done({ automations: automations.map(automationOf) }));
    case ACT_KIND.WORKSPACE_LEAVE:
    case ACT_KIND.WINDOW_COPY_TEXT:
      return Promise.resolve(done(undefined));
    default:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];
const registries: AtomRegistry.AtomRegistry[] = [];

beforeEach(() => {
  installScrollIntoView();
  stored = [OWNER, MEMBER];
  sent = [];
  runCommands = [];
  refuseMembersRead = false;
  membersHeld = undefined;
  refuseInvitationsRead = false;
  refuseRemoval = false;
  invitations = [];
  refuseInvitation = false;
  firstRead = undefined;
  refuseLaterReads = false;
  inviteHeld = undefined;
  refuseGitHubOpen = false;
  refuseGitHubDisconnect = false;
  refuseRename = false;
  refusePhoto = false;
  refuseRole = false;
  automations = undefined;
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: { act: answer, recordSurfaceEvent: () => undefined },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

/** The page over `workspace` listed beside the account's first one, or as it, and how often a leave asked to fall back. */
async function mount(workspace: Workspace, others: readonly Workspace[] = []) {
  const pressed = { left: 0 };
  const first = workspace.id === FIRST.id ? workspace : FIRST;
  const workspaces = [first, workspace, ...others].filter(
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
      listFailed: false,
      onRetryList: () => undefined,
      onLeft: () => {
        pressed.left += 1;
      },
    };
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(
            Fragment,
            null,
            createElement(WorkspacePage, { control, readerId: READER_ID }),
            createElement(ToastHost),
          ),
        ),
      ),
    );
  };
  // Each page holds its own atoms, so a toast one test raised is not the next one's.
  const registry = AtomRegistry.make();
  registries.push(registry);
  render(workspace.id);
  await settle();
  /** Stands the page again over another workspace, as the sidebar listing it does. */
  const relist = async (next: Workspace) => {
    workspaces.push(next);
    render(next.id);
    await settle();
  };
  /** Stands the page again over the workspace as the window's list now says it, as a list read after a change elsewhere does. */
  const restand = async (next: Workspace) => {
    workspaces.splice(
      workspaces.findIndex((each) => each.id === next.id),
      1,
      next,
    );
    render(next.id);
    await settle();
  };
  return { page: container, pressed, relist, restand };
}

const buttons = (within: Element, words: string) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].filter(
    (each) => each.textContent === words && each.closest("[inert]") === null,
  );

const button = (within: Element, words: string) =>
  buttons(within, words)[0] ?? assert.fail(`no ${words} button`);

/** The page's row naming `name` past its first row, the workspace's own, the reader's own beside its You. */
const rowNamed = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll<HTMLElement>(".settings-row")].find(
    (row) =>
      row.closest(".settings-group") !== page.querySelector(".settings-group") &&
      row.querySelector("strong")?.firstChild?.textContent === name,
  ) ?? assert.fail(`no ${name} row`);

/** The rows of the invitations still pending, by the line each wears. */
const invitationRows = (page: HTMLElement) =>
  [...page.querySelectorAll<HTMLElement>(".settings-row")].filter((row) =>
    row.querySelector("small")?.textContent?.startsWith("Invited as "),
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

/** The page's first row: the workspace's tile, name, and line, its Rename, and its ⋯. */
const identity = (page: HTMLElement) =>
  page.querySelector<HTMLElement>(".settings-group .settings-row") ??
  assert.fail("no identity row");

/** Who shares the workspace and the account's role in it, as the identity row's line says it. */
const roleLine = (page: HTMLElement) => identity(page).querySelector("small")?.textContent;

/** The renames the page asked for, by their payloads. */
const renames = () =>
  sent.flatMap((request) => (request.kind === ACT_KIND.WORKSPACE_RENAME ? [request.payload] : []));

/** Opens the name's field with Rename, types `typed` over the name, and ends the edit with `key`. */
async function renameTo(page: HTMLElement, typed: string, key: string): Promise<void> {
  act(() => button(identity(page), "Rename").click());
  const field =
    page.querySelector<HTMLInputElement>('input[aria-label="Workspace name"]') ??
    assert.fail("no name field");
  act(() => {
    field.value = typed;
    field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
  await settle();
}

test("an owner renames the workspace in place with its ends trimmed, and Escape or the same name sends nothing", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });

  assert.equal(identity(page).querySelector("strong")?.textContent, ACME.name);
  await renameTo(page, "  Acme Labs  ", "Escape");
  await renameTo(page, ACME.name, "Enter");
  await renameTo(page, "  Acme Labs  ", "Enter");

  assert.deepEqual(renames(), [{ workspaceId: ACME.id, name: "Acme Labs" }]);
  assert.equal(page.querySelector('input[aria-label="Workspace name"]') === null, true);
  // Note that the elements are compared as a yes or no, because a failure's
  // diff of two would print the whole document.
  assert.equal(document.activeElement === button(identity(page), "Rename"), true);
});

test("an admin's rename the service refuses says so under the row, and a member is offered no rename", async () => {
  refuseRename = true;
  const admin = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });
  await renameTo(admin.page, "Acme Labs", "Enter");

  assert.deepEqual(renames(), [{ workspaceId: ACME.id, name: "Acme Labs" }]);
  assert.equal(
    admin.page.querySelector('.menu-row + [role="alert"]')?.textContent,
    WORKSPACE_NOT_PERMITTED_REFUSAL,
  );

  const member = await mount(ACME);
  assert.equal(roleLine(member.page), "You're a member");
  assert.equal(buttons(member.page, "Rename").length, 0);
  assert.equal(member.page.querySelector('input[aria-label="Workspace name"]') === null, true);
});

test("the identity row says who shares the workspace and the account's role, and an account's own workspace with nobody else in it just that it is personal", async () => {
  const team = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN, memberCount: 6 });
  const shared = roleLine(team.page);
  const alone = await mount({ ...FIRST, memberCount: 1 });
  const ownShared = await mount({ ...FIRST, memberCount: 2 });

  assert.equal(shared, "6 members · You're an admin");
  assert.equal(roleLine(alone.page), "Personal workspace");
  assert.equal(roleLine(ownShared.page), "2 members · You're the owner");
});

test("a personal workspace shows its owner's name with no Rename to its owner and an admin alike, and still offers its photo", async () => {
  for (const role of [WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]) {
    const { page } = await mount({ ...FIRST, role });

    assert.equal(identity(page).querySelector("strong")?.textContent, FIRST.name);
    assert.equal(buttons(page, "Rename").length, 0);
    assert.deepEqual(rowActions(identity(page)), ["Upload photo"]);
  }
  const team = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  assert.equal(buttons(team.page, "Rename").length, 1);
});

/** The photos the page sent, by their payloads. */
const photos = () =>
  sent.flatMap((request) =>
    request.kind === ACT_KIND.WORKSPACE_PHOTO_SET ? [request.payload] : [],
  );

/** What the platform's canvas was asked to draw: the picture's part, and the canvas it was drawn on. */
interface Drawn {
  readonly source: readonly number[];
  readonly canvas: readonly number[];
}

/** A WebP's bytes as the encoder answers them: its RIFF and WEBP signature, then filler, `length` bytes in all. */
function webpBytes(length = 16): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return bytes;
}

/**
 * The platform's image decoder and canvas, which jsdom has not got, standing
 * in at the browser's edge: every picture decodes at `width` by `height`, and
 * every canvas writes `bytes` of WebP, so the real encoder runs between them.
 */
function stubCanvas(width: number, height: number, bytes: Uint8Array<ArrayBuffer>): Drawn[] {
  const drawn: Drawn[] = [];
  vi.stubGlobal("createImageBitmap", () => Promise.resolve({ width, height, close: () => {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    // SAFETY: the encoder calls drawImage alone on the context it is handed.
    return {
      drawImage: (_bitmap: CanvasImageSource, ...at: number[]) =>
        drawn.push({ source: at.slice(0, 4), canvas: [this.width, this.height] }),
    } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type) =>
    callback(new Blob([bytes], type === undefined ? {} : { type })),
  );
  return drawn;
}

/** Lets the encoder's file read, which jsdom answers on the next turn, land. */
async function drain(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
  await settle();
}

/** Picks `file` in the identity row's hidden picker, as the dialog Upload photo opens would. */
async function pickPhoto(page: HTMLElement, file: File): Promise<void> {
  const picker =
    identity(page).querySelector<HTMLInputElement>('input[type="file"]') ??
    assert.fail("no photo picker");
  Object.defineProperty(picker, "files", { configurable: true, value: [file] });
  act(() => {
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await drain();
}

test("an owner's picked photo is sent drawn as its centre square in WebP, 256 pixels a side, and Upload photo in the ⋯ opens the picker", async () => {
  const webp = webpBytes();
  const drawn = stubCanvas(400, 300, webp);
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  const row = identity(page);
  const picker = row.querySelector<HTMLInputElement>('input[type="file"]');
  let opened = 0;
  picker?.addEventListener("click", () => {
    opened += 1;
  });

  await chooseAction(row, "Upload photo");
  await pickPhoto(page, new File([new Uint8Array([1, 2, 3])], "team.png", { type: "image/png" }));

  assert.equal(opened, 1);
  assert.equal(picker?.accept, "image/png,image/jpeg,image/webp");
  assert.equal(picker?.hidden, true);
  assert.deepEqual(drawn, [{ source: [50, 0, 300, 300], canvas: [256, 256] }]);
  assert.deepEqual(photos(), [
    { workspaceId: ACME.id, photo: `data:image/webp;base64,${btoa(String.fromCharCode(...webp))}` },
  ]);
  assert.equal(page.querySelector('[role="alert"]') === null, true);
});

test("a photo the service refuses, a file that is no PNG, JPEG, or WebP, and a photo past the bound are said under the row", async () => {
  stubCanvas(300, 300, webpBytes());
  refusePhoto = true;
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });
  const said = () => page.querySelector('.menu-row + [role="alert"]')?.textContent;

  await pickPhoto(page, new File(["x"], "team.png", { type: "image/png" }));
  const refused = said();
  await pickPhoto(page, new File(["<svg/>"], "team.svg", { type: "image/svg+xml" }));
  const kind = said();
  vi.restoreAllMocks();
  stubCanvas(300, 300, webpBytes(WORKSPACE_PHOTO_BOUNDS.MAX_BYTES + 1));
  await pickPhoto(page, new File(["x"], "huge.jpg", { type: "image/jpeg" }));

  assert.equal(refused, WORKSPACE_NOT_PERMITTED_REFUSAL);
  assert.equal(kind, "team.svg isn't a PNG, JPEG, or WebP image.");
  assert.equal(said(), "huge.jpg is too large for a workspace photo.");
  assert.equal(photos().length, 1);
});

test("Remove photo stands disabled while an upload is still under way, so the upload cannot put a removed photo back", async () => {
  // The picked image is still being drawn: the encoder's bitmap never arrives.
  vi.stubGlobal("createImageBitmap", () => new Promise(() => undefined));
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER, photoVersion: "v1" });
  await pickPhoto(page, new File(["x"], "team.png", { type: "image/png" }));
  const ellipsis =
    identity(page).querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ??
    assert.fail("the row draws no ⋯");
  act(() => ellipsis.click());
  const remove =
    [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')].find(
      (each) => each.textContent === "Remove photo",
    ) ?? assert.fail("no Remove photo in the row's menu");

  assert.equal(remove.disabled || remove.getAttribute("aria-disabled") === "true", true);
});

test("Remove photo, offered only where a photo is set, asks first and then sends no photo, and a set photo is replaced rather than uploaded", async () => {
  const bare = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  assert.deepEqual(rowActions(identity(bare.page)), ["Upload photo"]);

  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER, photoVersion: "v1" });
  assert.deepEqual(rowActions(identity(page)), ["Replace photo", "Remove photo"]);
  await chooseAction(identity(page), "Remove photo");
  assert.deepEqual(photos(), []);
  await confirm("Remove");

  assert.deepEqual(photos(), [{ workspaceId: ACME.id, photo: null }]);
});

test("a member is offered none of the photo's acts", async () => {
  const { page } = await mount(ACME);

  assert.deepEqual(rowActions(identity(page)), []);
  assert.equal(page.querySelector('input[type="file"]') === null, true);
});

test("the chosen team workspace's members are listed with their email and role, and a member is offered no Remove", async () => {
  const { page } = await mount(ACME);

  assert.deepEqual(
    sent.filter((request) => request.kind.startsWith("workspace.")).map((request) => request.kind),
    [ACT_KIND.WORKSPACE_MEMBERS_READ],
  );
  assert.equal(rowNamed(page, "Dana").querySelector("small")?.textContent, "dana@example.com");
  assert.deepEqual(
    ["Dana", "Sam"].map(
      (name) => rowNamed(page, name).querySelector(".settings-row-value")?.textContent,
    ),
    ["Owner", "Member"],
  );
  assert.deepEqual(rowActions(rowNamed(page, "Sam")), []);
  assert.equal(
    page.querySelector(".settings-act-slot"),
    null,
    "no row keeps a ⋯'s room where none has one",
  );
});

test("where some members' rows carry a ⋯, a row without one keeps its room, so every role ends in one column", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });

  assert.notEqual(rowNamed(page, "Dana").querySelector(".settings-act-slot"), null);
  assert.equal(rowNamed(page, "Sam").querySelector(".settings-act-slot"), null);
  assert.deepEqual(rowActions(rowNamed(page, "Sam")), ["Make admin", "Remove from workspace"]);
});

test("each member's row leads with their face, their picture where the read lists one and their letter where it lists none, and the reader's own wears You", async () => {
  const { page } = await mount(ACME);

  const dana = rowNamed(page, "Dana");
  const sam = rowNamed(page, "Sam");
  assert.equal(dana.querySelector(".actor-mark .actor-face")?.textContent, "D");
  assert.equal(
    sam.querySelector<HTMLImageElement>(".actor-mark img")?.src,
    "https://avatars.githubusercontent.com/u/7",
  );
  assert.equal(dana.querySelector(".actor-you")?.textContent, "You");
  assert.equal(sam.querySelector(".actor-you"), null);
  // The person card's wrapper holds the name and You together, which is what stands the badge off the name.
  assert.equal(
    dana.querySelector(".actor-card-name")?.textContent,
    "DanaYou",
    "the reader's name and its You share the person card's wrapper",
  );
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
    onLeft: () => undefined,
    listFailed: false,
    onRetryList: () => undefined,
  };
  act(() => root.render(createElement(WorkspacePage, { control, readerId: READER_ID })));
  const heldBack = container.querySelector(".settings-reading") !== null;
  await settle();

  assert.equal(heldBack, true);
  assert.equal(
    container.querySelector('[role="alert"] .failure-note-words')?.textContent,
    "The members could not be read.",
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

test("an admin is offered no Remove on their own row, since their way out is Leave", async () => {
  stored = [
    { ...OWNER, userId: "user-ola", name: "Ola", email: "ola@example.com" },
    { ...OWNER, role: WORKSPACE_ROLE.ADMIN },
    MEMBER,
  ];
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  assert.deepEqual(rowActions(rowNamed(page, "Dana")), []);
  assert.deepEqual(rowActions(rowNamed(page, "Sam")), ["Remove from workspace"]);
  assert.equal(buttons(page, "Leave").length, 1);
});

test("an admin is offered no Remove on another admin, and the owner is, as the service allows", async () => {
  const admin: WorkspaceMember = {
    userId: "user-ola",
    name: "Ola",
    email: "ola@example.com",
    role: WORKSPACE_ROLE.ADMIN,
  };
  stored = [OWNER, admin, MEMBER];
  const asAdmin = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });
  const adminSees = rowActions(rowNamed(asAdmin.page, "Ola"));
  const asOwner = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });

  assert.deepEqual(adminSees, []);
  assert.deepEqual(rowActions(rowNamed(asOwner.page, "Ola")), [
    "Make member",
    "Make owner",
    "Remove from workspace",
  ]);
});

/** The role changes and handovers the page asked for, by kind and payload. */
const roleSent = () =>
  sent.flatMap((request) =>
    request.kind === ACT_KIND.WORKSPACE_MEMBER_ROLE || request.kind === ACT_KIND.WORKSPACE_TRANSFER
      ? [[request.kind, request.payload]]
      : [],
  );

/** An admin of the workspace beside the owner and a member. */
const ADMIN_OLA: WorkspaceMember = {
  userId: "user-ola",
  name: "Ola",
  email: "ola@example.com",
  role: WORKSPACE_ROLE.ADMIN,
};

test("the owner makes a member an admin from the member's ⋯ at once, and the row says Admin", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });

  assert.deepEqual(rowActions(rowNamed(page, "Sam")), ["Make admin", "Remove from workspace"]);
  await chooseAction(rowNamed(page, "Sam"), "Make admin");

  assert.deepEqual(roleSent(), [
    [
      ACT_KIND.WORKSPACE_MEMBER_ROLE,
      { workspaceId: ACME.id, userId: MEMBER.userId, role: WORKSPACE_ROLE.ADMIN },
    ],
  ]);
  assert.equal(rowNamed(page, "Sam").querySelector(".settings-row-value")?.textContent, "Admin");
  assert.equal(document.querySelector('[role="alertdialog"]'), null, "nothing asked first");
});

test("the owner's ⋯ on an admin holds Make member, Make owner, and Remove, and Make owner asks first, then hands the workspace over", async () => {
  stored = [OWNER, ADMIN_OLA, MEMBER];
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });

  assert.deepEqual(rowActions(rowNamed(page, "Ola")), [
    "Make member",
    "Make owner",
    "Remove from workspace",
  ]);
  await chooseAction(rowNamed(page, "Ola"), "Make owner");
  const askedFirst = roleSent().length === 0;
  const question = dialog().querySelector(".confirm-dialog-title")?.textContent;
  await confirm("Make owner");

  assert.equal(askedFirst, true);
  assert.equal(question, "Make Ola the owner of acme?");
  assert.deepEqual(roleSent(), [
    [ACT_KIND.WORKSPACE_TRANSFER, { workspaceId: ACME.id, userId: ADMIN_OLA.userId }],
  ]);
  assert.equal(rowNamed(page, "Ola").querySelector(".settings-row-value")?.textContent, "Owner");
});

test("an admin of the account's own first workspace is never offered Make owner, since it is named for its creator", async () => {
  stored = [OWNER, ADMIN_OLA];
  const { page } = await mount({ ...FIRST, role: WORKSPACE_ROLE.OWNER });

  assert.deepEqual(rowActions(rowNamed(page, "Ola")), ["Make member", "Remove from workspace"]);
});

test("an admin is offered no role change, and a role change the service refuses is said under the row", async () => {
  const asAdmin = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });
  const adminSees = rowActions(rowNamed(asAdmin.page, "Sam"));
  refuseRole = true;
  const asOwner = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  await chooseAction(rowNamed(asOwner.page, "Sam"), "Make admin");

  assert.deepEqual(adminSees, ["Remove from workspace"]);
  assert.equal(
    rowNamed(asOwner.page, "Sam").nextElementSibling?.textContent,
    WORKSPACE_NOT_PERMITTED_REFUSAL,
  );
});

/** The page's last group, the way out of the workspace, where it draws one. */
const leaveGroup = (page: HTMLElement) =>
  page.querySelector<HTMLElement>(
    `[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${SETTINGS_SECTION.LEAVE}"]`,
  );

test("the owner cannot leave until the workspace is handed over: its row says so and Transfer ownership hands it to the admin chosen, the first unless another is", async () => {
  const other: WorkspaceMember = {
    ...ADMIN_OLA,
    userId: "user-kim",
    name: "Kim",
    email: "kim@example.com",
  };
  stored = [OWNER, ADMIN_OLA, other, MEMBER];
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  const group = leaveGroup(page) ?? assert.fail("no leave");
  const line = group.querySelector("small")?.textContent;
  act(() => button(group, "Transfer ownership").click());
  const chip =
    dialog().querySelector<HTMLButtonElement>('button[aria-label^="New owner"]') ??
    assert.fail("no new owner");
  const first = chip.getAttribute("aria-label");
  act(() => chip.click());
  const offered = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')];
  const names = offered.map((item) => item.textContent);
  act(() => offered.find((item) => item.textContent?.includes("kim@example.com"))?.click());
  await confirm("Transfer ownership");

  assert.equal(line, "You're its owner. Make an admin the owner first, then you can leave.");
  assert.deepEqual(buttons(group, "Leave"), []);
  assert.equal(first, "New owner: Ola");
  assert.deepEqual(
    names.map((name) => name?.replace(/^[A-Z]/u, "")),
    ["Olaola@example.com", "Kimkim@example.com"],
  );
  assert.deepEqual(roleSent(), [
    [ACT_KIND.WORKSPACE_TRANSFER, { workspaceId: ACME.id, userId: "user-kim" }],
  ]);
});

test("the owner with no admin is told to make one first and offered no handover, and the owner of the account's own workspace sees no leave at all", async () => {
  const team = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  const group = leaveGroup(team.page) ?? assert.fail("no leave");
  const own = await mount({ ...FIRST, role: WORKSPACE_ROLE.OWNER });

  assert.equal(
    group.querySelector("small")?.textContent,
    "You're its owner. Make a member an admin, then make them the owner, and you can leave.",
  );
  assert.deepEqual(buttons(group, "Transfer ownership"), []);
  assert.equal(leaveGroup(own.page), null);
});

test("the leave names the automations the reader made where the service says whose they are, and leaves them out where none is the reader's", async () => {
  /** The leave dialog's lines for the automations the workspace holds. */
  const linesFor = async (held: { name: string; mine?: boolean }[]) => {
    automations = held;
    const { page } = await mount(ACME);
    act(() => button(leaveGroup(page) ?? assert.fail("no leave"), "Leave").click());
    await settle();
    const lines = [...dialog().querySelectorAll(".leave-consequences li")].map(
      (li) => li.textContent,
    );
    act(() => button(dialog(), "Cancel").click());
    return lines;
  };

  const named = await linesFor([
    { name: "Nightly triage", mine: true },
    { name: "Weekly digest", mine: true },
    { name: "Sam's sweep", mine: false },
  ]);
  const one = await linesFor([{ name: "Nightly triage", mine: true }]);
  const none = await linesFor([{ name: "Sam's sweep", mine: false }]);
  const unsaid = await linesFor([{ name: "Nightly triage" }]);

  assert.equal(named[2], "2 automations you created stop running: Nightly triage, Weekly digest.");
  assert.equal(one[2], "An automation you created stops running: Nightly triage.");
  assert.equal(
    none.some((line) => line?.includes("automation")),
    false,
  );
  assert.equal(unsaid[2], "Automations you created stop running.");
});

test("an automation made after the page opened is named when the leave is next asked, since the list is read as the leave is", async () => {
  automations = [];
  const { page } = await mount(ACME);
  const leave = () => button(leaveGroup(page) ?? assert.fail("no leave"), "Leave");
  /** The leave dialog's lines, once its read of the automations landed. */
  const asked = async () => {
    act(() => leave().click());
    await settle();
    const lines = [...dialog().querySelectorAll(".leave-consequences li")].map(
      (li) => li.textContent,
    );
    act(() => button(dialog(), "Cancel").click());
    return lines;
  };

  const before = await asked();
  automations = [{ name: "Morning sweep", mine: true }];
  const after = await asked();

  assert.equal(
    before.some((line) => line?.includes("automation")),
    false,
  );
  assert.equal(after.includes("An automation you created stops running: Morning sweep."), true);
});

test("the members are read again when the window's list counts another, so an admin who joined meanwhile may be handed the workspace, and Transfer ownership reads them again as it opens", async () => {
  const { page, restand } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER, memberCount: 2 });
  const offeredBefore = buttons(
    leaveGroup(page) ?? assert.fail("no leave"),
    "Transfer ownership",
  ).length;
  stored = [OWNER, ADMIN_OLA, MEMBER];
  await restand({ ...ACME, role: WORKSPACE_ROLE.OWNER, memberCount: 3 });
  const reads = () =>
    sent.filter((request) => request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ).length;
  const readsBeforePress = reads();
  act(() => button(leaveGroup(page) ?? assert.fail("no leave"), "Transfer ownership").click());
  await settle();

  assert.equal(offeredBefore, 0);
  assert.equal(readsBeforePress, 2);
  assert.equal(reads(), 3);
  assert.equal(
    dialog().querySelector('button[aria-label^="New owner"]')?.getAttribute("aria-label"),
    "New owner: Ola",
  );
});

test("a members read sent before a role change and landing after it does not put back the role the change made", async () => {
  stored = [OWNER, ADMIN_OLA, MEMBER];
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  let release: () => void = () => undefined;
  membersHeld = new Promise((resolve) => {
    release = resolve;
  });
  act(() => button(leaveGroup(page) ?? assert.fail("no leave"), "Transfer ownership").click());
  act(() => button(dialog(), "Cancel").click());
  await chooseAction(rowNamed(page, "Sam"), "Make admin");
  release();
  await settle();

  assert.equal(rowNamed(page, "Sam").querySelector(".settings-row-value")?.textContent, "Admin");
});

test("an admin's leave says the invitations they sent stay valid, and a member's, who sends none, says nothing of them", async () => {
  /** The leave dialog's lines for a reader of `role`. */
  const linesAs = async (role: Workspace["role"]) => {
    const { page } = await mount({ ...ACME, role });
    act(() => button(leaveGroup(page) ?? assert.fail("no leave"), "Leave").click());
    await settle();
    const lines = [...dialog().querySelectorAll(".leave-consequences li")].map(
      (li) => li.textContent,
    );
    act(() => button(dialog(), "Cancel").click());
    return lines;
  };

  const admin = await linesAs(WORKSPACE_ROLE.ADMIN);
  const member = await linesAs(WORKSPACE_ROLE.MEMBER);

  assert.equal(admin.includes("Invitations you sent stay valid: they're the workspace's."), true);
  assert.equal(
    member.some((line) => line?.startsWith("Invitations")),
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

test("a member leaves after confirming, which names what stays and what stops, says so in a toast, and lands the window; an owner is offered no Leave", async () => {
  const member = await mount(ACME);
  const leaveRow = button(member.page, "Leave").closest(".settings-row") ?? assert.fail();
  const line = leaveRow.querySelector("small")?.textContent;
  act(() => button(leaveRow, "Leave").click());
  const named = [...dialog().querySelectorAll(".leave-consequences li")].map(
    (li) => li.textContent,
  );
  await confirm("Leave acme");

  assert.equal(line, "You lose its tasks, agents, and Inbox until someone invites you again.");
  assert.deepEqual(named, [
    "Tasks you wrote stay in acme, for its members to keep.",
    "Agents you started stay in its history, named as a former member, and any still working stop.",
    "Automations you created stop running.",
    "Your own workspace, Dana, isn't affected.",
  ]);
  assert.equal(
    document.querySelector(".toast-stack")?.textContent?.includes("You left acme."),
    true,
  );

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

  assert.equal(roleLine(page), "You're the owner");
  assert.ok(page.querySelector(".workspace-invite"));
  assert.equal(rowNamed(page, "Dana").querySelector("small")?.textContent, "dana@example.com");
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

/** The Workspace page's GitHub group, found by the anchor its links have always named. */
const githubGroup = (page: HTMLElement) =>
  page.querySelector<HTMLElement>(
    `[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${SETTINGS_SECTION.GITHUB_REPOSITORIES}"]`,
  ) ?? assert.fail("no GitHub group");

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

test("an owner or an admin of a connected workspace sees the GitHub group's GitHub row, connected to its account, led by GitHub's mark, with Manage its one control", async () => {
  for (const role of [WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]) {
    const { page } = await mount({ ...CONNECTED, role });
    const group = githubGroup(page);
    const row = rowNamed(group, "GitHub");

    assert.equal(group.querySelector("h2")?.textContent, "GitHub");
    assert.deepEqual(rowWords(row), ["GitHub", "Connected to acme-org"]);
    assert.equal(
      row.querySelector(".settings-row-mark")?.innerHTML,
      renderToStaticMarkup(createElement(ProviderMark, { provider: INTEGRATION_PROVIDER.GITHUB })),
    );
    assert.deepEqual(rowButtons(row), ["Manage"], `a ${role} has Manage and nothing else`);
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
    "Its tasks lose these repositories until GitHub is connected again.",
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
      githubGroup(page).querySelector('.error-message[role="alert"]')?.textContent,
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

  assert.deepEqual(rowWords(connectedRow), ["GitHub", "Connected to acme-org"]);
  assert.deepEqual(rowWords(unconnectedRow), ["GitHub", "Not connected. Ask an owner or admin."]);
  for (const row of [connectedRow, unconnectedRow]) {
    assert.equal(row.querySelector("button"), null);
    act(() => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    assert.equal(document.querySelector('[role="menu"]'), null);
  }
});

test("the page has no workspace picker of its own, and shows another workspace, the account's role in it, and its own members once the sidebar lists it", async () => {
  const beta: Workspace = {
    ...ACME,
    id: "workspace-beta",
    name: "Beta",
    slug: "beta",
    role: WORKSPACE_ROLE.ADMIN,
  };
  const { page, relist } = await mount(ACME, [beta]);
  const rowNames = [...page.querySelectorAll(".settings-row strong")].map(
    (name) => name.textContent,
  );
  const listedRole = roleLine(page);

  await relist(beta);

  assert.equal(page.querySelector('button[aria-label^="Workspace:"]'), null, "no picker");
  assert.equal(rowNames.includes("Workspace"), false, "no Workspace row");
  assert.equal(listedRole, "You're a member");
  assert.equal(roleLine(page), "You're an admin");
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id }, { workspaceId: beta.id }],
  );
});

/** The invite form's role chip, which names the role an invitation is sent as. */
const roleChip = (form: HTMLElement) =>
  form.querySelector<HTMLButtonElement>('button[aria-label^="Invite as"]') ??
  assert.fail("no role chip");

/** The role menu's items, each its role's name and what it may do. */
const roleItems = () => [
  ...document.querySelectorAll<HTMLElement>(
    '[role="menu"] [role="menuitemcheckbox"], [role="menu"] [role="menuitem"], [role="menu"] [role="menuitemradio"]',
  ),
];

/** Opens the role chip's menu and chooses `words`. */
function chooseRole(form: HTMLElement, words: string): void {
  act(() => roleChip(form).click());
  const item =
    roleItems().find((each) => each.textContent?.startsWith(words)) ??
    assert.fail(`no ${words} in the role's menu`);
  act(() => item.click());
}

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
  if (roleWords !== roleChip(form).textContent) chooseRole(form, roleWords);
  act(() => {
    for (let press = 0; press < presses; press += 1) form.requestSubmit();
  });
  await settle();
}

test("the owner invites an address as a role, sees it pending with its link to copy, and cancels it from its ⋯", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });

  await invite(page, "alan@example.com", WORKSPACE_ROLE.ADMIN);
  const row = invitationRows(page)[0] ?? assert.fail("no pending invitation");
  const face = row.querySelector<HTMLElement>(".actor-mark")?.dataset.kind;
  const listed = [
    row.querySelector("strong")?.textContent,
    row.querySelector("small")?.textContent,
  ];
  act(() => button(row, "Copy link").click());
  await chooseAction(row, "Cancel invitation");

  assert.deepEqual(listed, [
    "alan@example.com",
    `Invited as Admin · Expires ${dayAndTimeText(Date.parse("2026-10-16T12:00:00.000Z"))}`,
  ]);
  assert.equal(
    face,
    "someone",
    "an invited address wears the outline face, in the members' column",
  );
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

test("an invitation's role is a field chip, Member by default, whose menu checks the role and says what each may do, and the invitation is sent as the role chosen", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  const form = page.querySelector<HTMLFormElement>(".workspace-invite") ?? assert.fail("no form");
  const before = roleChip(form).textContent;
  act(() => roleChip(form).click());
  const offered = roleItems().map((item) => [item.textContent, item.getAttribute("aria-checked")]);
  act(() => roleChip(form).click());

  await invite(page, "alan@example.com", WORKSPACE_ROLE.ADMIN);

  assert.equal(before, "Member");
  assert.deepEqual(offered, [
    ["MemberWorks on tasks and agents", "true"],
    ["AdminAlso manages members and GitHub", "false"],
  ]);
  assert.deepEqual(
    sent.flatMap((request) =>
      request.kind === ACT_KIND.WORKSPACE_INVITE ? [request.payload.role] : [],
    ),
    [WORKSPACE_ROLE.ADMIN],
  );
});

test("an admin's role menu offers Admin dimmed, since only the owner invites admins, and an admin invites a member", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });
  const form = page.querySelector<HTMLFormElement>(".workspace-invite") ?? assert.fail("no form");
  act(() => roleChip(form).click());
  const admin = roleItems().find((item) => item.textContent?.startsWith("Admin"));
  const offered = [
    admin?.textContent,
    admin?.getAttribute("aria-disabled") === "true" || admin?.hasAttribute("disabled"),
  ];
  act(() => roleChip(form).click());

  await invite(page, "alan@example.com", WORKSPACE_ROLE.MEMBER);

  assert.deepEqual(offered, ["AdminOnly the owner invites admins", true]);
  assert.deepEqual(
    sent.flatMap((request) =>
      request.kind === ACT_KIND.WORKSPACE_INVITE ? [request.payload.role] : [],
    ),
    [WORKSPACE_ROLE.MEMBER],
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
    onLeft: () => undefined,
    listFailed: true,
    onRetryList: () => {
      retried += 1;
    },
  };
  act(() => root.render(createElement(WorkspacePage, { control, readerId: READER_ID })));

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
      (each) => each.textContent === "The invitations could not be read.",
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

test("a repository's row opens its own page, where its run command on this Mac is saved and removed", async () => {
  const { page } = await mount(ACME);
  await settle();
  const row = () =>
    [...page.querySelectorAll<HTMLButtonElement>(".repository-row")].find(
      (each) => each.querySelector("strong")?.textContent === "acme/relay",
    ) ?? assert.fail("no acme/relay row");

  assert.equal(row().querySelector("small")?.textContent, "No run command on this Mac");
  act(() => row().click());
  await settle();
  assert.equal(page.querySelector(".repository-page-title")?.textContent, "acme/relay");
  const field =
    page.querySelector<HTMLTextAreaElement>("textarea") ?? assert.fail("no run command field");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      field,
      "  pnpm install && pnpm dev  ",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => button(page, "Save").click());
  await settle();

  assert.deepEqual(runCommands, [
    { workspaceId: ACME.id, repository: "acme/relay", command: "pnpm install && pnpm dev" },
  ]);
  act(() => button(page, "Remove").click());
  await settle();
  assert.deepEqual(runCommands, []);
  act(() =>
    (
      page.querySelector<HTMLButtonElement>(".repository-page-back") ?? assert.fail("no way back")
    ).click(),
  );
  await settle();
  assert.equal(row().querySelector("small")?.textContent, "No run command on this Mac");
});
