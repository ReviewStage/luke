// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AUTOMATION_FOLLOW } from "@repo/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@repo/features/automation-wire";
import {
  GITHUB_ACCESS,
  type GitHubAccess,
  type WorkspaceTokenRepository,
} from "@repo/features/github-repositories-wire";
import { GITHUB_TOKEN_STATUS } from "@repo/features/github-token-wire";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import type { WorkspaceSentry } from "@repo/features/sentry-install-wire";
import type { WorkspaceSlackBot } from "@repo/features/slack-bot-wire";
import { dayAndTimeText } from "@repo/features/time-format";
import type { WorkspaceSlack } from "@repo/features/workspace-integrations-live";
import type { WorkspaceInvitation } from "@repo/features/workspace-invitation-wire";
import {
  WORKSPACE_PHOTO_BOUNDS,
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@repo/features/workspace-wire";
import {
  ACT_KIND,
  ALREADY_INVITED_REFUSAL,
  WORKSPACE_NOT_PERMITTED_REFUSAL,
} from "@repo/host/acts";
import {
  type AppTokenRepositories,
  type AppWorkspaceIntegrations,
  type AppWorkspaceInvitations,
  type AppWorkspaceMembers,
  NO_KEYS_HELD,
} from "@repo/host/app-state";
import {
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  TASKS_ACT_KIND,
  WORKSPACE_ACT_KIND,
} from "@repo/host/contract";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE } from "@repo/settings/settings-anchors";
import { SETTINGS_SECTION, type SettingsLink } from "@repo/settings/settings-views";
import { ProviderMark, SettingsPage } from "@repo/ui";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";
import { OpenSettingsProvider } from "../open-settings.js";
import { OpenPersonProvider } from "../person-door.js";
import { rendererRegistry } from "../renderer-runtime.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActPort,
  fakeAppBridge,
  quietHold,
  refusedOnPort,
} from "../testing/app-bridge.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import {
  DESKTOP_CAPABILITIES,
  type HostReadsHanded,
  handCapabilities,
  handHostReads,
  holdAutomations,
  holdGitHubToken,
  holdRepositoryLists,
  type RepositoriesRead,
} from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { relayout } from "../testing/resize-observer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { ToastHost } from "../toast.js";
import { WorkspacePage, type WorkspaceSettingsControl } from "./workspace-page.js";

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
 * an owner's or an admin's to connect, or to manage on GitHub from its one
 * button once connected, its accounts listed under it, and a member's to
 * read. Synthetic accounts.
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
  pictureUrl: "https://lh3.googleusercontent.com/a/photo-7",
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
let sent: Asked[] = [];
/** Whether the service refuses to read the invitations. */
let refuseInvitationsRead = false;
/** Whether the service refuses to read the members. */
let refuseMembersRead = false;
/** Lays each workspace's people on the window's document, as the host does once the page holds them. */
let deliverPeople: HostReadsHanded["deliverMembers"] = () => undefined;
/** Each workspace's people the host holds for the window, as last laid. */
let people: AppWorkspaceMembers = NO_KEYS_HELD;
/** Lays each workspace's pending invitations on the window's document, as the host does once the page holds them. */
let deliverInvitations: HostReadsHanded["deliverInvitations"] = () => undefined;
/** Each workspace's pending invitations the host holds for the window, as last laid. */
let heldInvitations: AppWorkspaceInvitations = NO_KEYS_HELD;
/** Whether the service refuses the next removal for the account's role. */
let refuseRemoval = false;
/** The invitations the test's service holds pending. */
let invitations: WorkspaceInvitation[] = [];
/** Whether the service refuses the next invitation as the address already invited. */
let refuseInvitation = false;
/** Where the next invitation waits before the service makes it, so a test can hold it on the wire. */
let inviteHeld: Promise<void> | undefined;
/** Whether the browser could not be opened on GitHub's page. */
let refuseGitHubOpen = false;
/** The workspace's Sentry on a deployment that holds no Sentry integration, which every test reads unless it says otherwise. */
const SENTRY_NOT_SET_UP: WorkspaceSentry = { configured: false, installations: [] };
/** The workspace's Sentry as the service holds it; none where the host's read of it fails. */
let sentry: WorkspaceSentry | undefined = SENTRY_NOT_SET_UP;
/** The workspace's Slack bot as the fake service holds it; unset, it holds none. */
let slackBot: WorkspaceSlackBot = { configured: false };
/** Lays each workspace's integrations on the window's document, as the host does once the page holds them. */
let deliverIntegrations: HostReadsHanded["deliverIntegrations"] = () => undefined;
/** Each workspace's integrations the host holds for the window, as last laid. */
let integrations: AppWorkspaceIntegrations = NO_KEYS_HELD;
/** Whether the service refuses a rename for the account's role. */
let refuseRename = false;
/** Whether the service refuses a photo for the account's role. */
let refusePhoto = false;
/** Whether the service refuses a role change for the account's role. */
let refuseRole = false;
/** The repositories the workspace reaches on GitHub, by full name. */
let githubRepositories: string[] = [];
/** A repository as the picker's listing answers it, by its full name and what reaches it. */
function listedRepository(fullName: string, access: GitHubAccess) {
  const [owner = "", name = ""] = fullName.split("/");
  return { owner, name, fullName, defaultBranch: "main", private: true, updatedAt: 1, access };
}

/** The repositories the workspace's picker lists, as the service answers them: the App's, and the reader's token's as addable, or among them from a service older than `addable`. */
function listing(): RepositoriesRead {
  return {
    repositories: {
      installed: true,
      installationUrl: "https://github.com/apps/luke/installations/new",
      ...(beforeAddable
        ? {
            repositories: [
              ...githubRepositories.map((fullName) =>
                listedRepository(fullName, GITHUB_ACCESS.APP),
              ),
              ...tokenReach.map((fullName) => listedRepository(fullName, GITHUB_ACCESS.TOKEN)),
            ],
          }
        : {
            repositories: githubRepositories.map((fullName) =>
              listedRepository(fullName, GITHUB_ACCESS.APP),
            ),
            addable: tokenReach.map((fullName) => listedRepository(fullName, GITHUB_ACCESS.TOKEN)),
          }),
    },
  };
}

/** A token the reader saved, as the token's read answers it. */
const SAVED_TOKEN = {
  login: "octo-member",
  hint: "ghp_…wxyz",
  status: GITHUB_TOKEN_STATUS.VERIFIED,
  statusAt: 1,
  addedAt: 1,
  expiresAt: null,
};

/** The repositories the reader's own token may push to that the picker's listing answers as addable, by full name. */
let tokenReach: string[] = [];
/** Whether the listing answers as a service older than `addable`, the token's repositories among its own. */
let beforeAddable = false;
/** The repositories members added to the workspace on their tokens, as the service lists them to the reader. */
let tokenRepositories: WorkspaceTokenRepository[] = [];
/** While set, the token repositories' read waits on it before answering what it read. */
let tokenReadHeld: Promise<void> | undefined;
/** Whether the token repositories' read is refused rather than answered. */
let tokenReadFails = false;
/** Whether the reader has a GitHub token saved, as the host holds it. */
let tokenSaved = true;
/** Each workspace's token repositories as the host holds them for the window. */
let heldTokenRepositories: AppTokenRepositories = NO_KEYS_HELD;
let deliverTokenRepositories: HostReadsHanded["deliverTokenRepositories"] = () => undefined;
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
    action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Triage today's issues." },
    guards: AUTOMATION_DEFAULT_GUARDS,
    nextRunAt: null,
    lastRun: null,
    createdAt: 1,
  };
  return mine === undefined ? summary : { ...summary, mine };
}

/** One ask of the window on its act port. */
type Asked = AnyAct;

/** Any answer a kind gives. */
type AnswerValue = PortActResult<PortActKind>;

/** What the fake host answers an ask with. */
type Answered = FakeActAnswer;

const done = (value: AnswerValue): Answered => ({ status: FAKE_ANSWER.DONE, value });

/** Lays a workspace's people on the window's document as the service holds them, or as refused where it refuses them. */
function layPeople(workspaceId: string): void {
  people = {
    ...people,
    [workspaceId]: refuseMembersRead ? { failed: true } : { rows: { members: stored } },
  };
  deliverPeople(people);
}

/** The Slack bot as the workspace's held read carries it: its team, its default repository, and each channel's. */
function slackOf(bot: WorkspaceSlackBot): WorkspaceSlack {
  const { configured, team, defaultRepository, channels = [] } = bot;
  return {
    configured,
    ...(team === undefined ? undefined : { team }),
    ...(defaultRepository === undefined ? undefined : { defaultRepository }),
    channelRepositories: Object.fromEntries(
      channels.flatMap((channel) =>
        channel.repository === undefined ? [] : [[channel.id, channel.repository]],
      ),
    ),
  };
}

/** Lays a workspace's integrations on the window's document as the service holds them, or as failed where the host's read of them fails. */
function layIntegrations(workspaceId: string): void {
  integrations = {
    ...integrations,
    [workspaceId]:
      sentry === undefined ? { failed: true } : { rows: { sentry, slack: slackOf(slackBot) } },
  };
  deliverIntegrations(integrations);
}

/** Lays a workspace's pending invitations on the window's document as the service holds them, or as refused where it refuses them. */
function layInvitations(workspaceId: string): void {
  heldInvitations = {
    ...heldInvitations,
    [workspaceId]: refuseInvitationsRead ? { failed: true } : { rows: invitations },
  };
  deliverInvitations(heldInvitations);
}

/** Lays a workspace's token repositories on the window's document as the host holds them: as the service lists them, or failed where it refused them. */
function layTokenRepositories(workspaceId: string, refused = tokenReadFails): void {
  heldTokenRepositories = {
    ...heldTokenRepositories,
    [workspaceId]: refused ? { failed: true } : { rows: tokenRepositories },
  };
  deliverTokenRepositories(heldTokenRepositories);
}

/** The bridge, answering the section's acts the way the host would, a member or invitation write drawn on the document from its answer. */
function answer(request: Asked): Promise<Answered> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.WORKSPACE_MEMBERS_RETRY:
      layPeople(request.payload.workspaceId);
      return Promise.resolve(done(undefined));
    case ACT_KIND.WORKSPACE_MEMBER_REMOVE:
      if (refuseRemoval) {
        return Promise.resolve({
          status: FAKE_ANSWER.REFUSED,
          reason: WORKSPACE_NOT_PERMITTED_REFUSAL,
        });
      }
      stored = stored.filter((member) => member.userId !== request.payload.userId);
      layPeople(request.payload.workspaceId);
      return Promise.resolve(done(stored));
    case ACT_KIND.WORKSPACE_INVITATIONS_RETRY:
      layInvitations(request.payload.workspaceId);
      return Promise.resolve(done(undefined));
    case ACT_KIND.WORKSPACE_INVITE: {
      if (inviteHeld !== undefined) {
        const held = inviteHeld;
        inviteHeld = undefined;
        return held.then(() => answer({ ...request }));
      }
      if (refuseInvitation) {
        return Promise.resolve({
          status: FAKE_ANSWER.REFUSED,
          reason: ALREADY_INVITED_REFUSAL,
        });
      }
      const made: WorkspaceInvitation = {
        id: `inv-${request.payload.email}`,
        email: request.payload.email,
        role: request.payload.role,
        expiresAt: "2026-10-16T12:00:00.000Z",
        acceptUrl: `https://vespin.dev/accept-invitation.html?id=inv-${request.payload.email}`,
      };
      invitations = [...invitations, made];
      layInvitations(request.payload.workspaceId);
      return Promise.resolve(done(made));
    }
    case ACT_KIND.WORKSPACE_INVITATION_CANCEL:
      invitations = invitations.filter((one) => one.id !== request.payload.invitationId);
      layInvitations(request.payload.workspaceId);
      return Promise.resolve(done(invitations));
    case ACT_KIND.WORKSPACE_INTEGRATIONS_RETRY:
      layIntegrations(request.payload.workspaceId);
      return Promise.resolve(done(undefined));
    case ACT_KIND.WORKSPACE_SENTRY_INSTALL:
      return Promise.resolve(done(undefined));
    // Note that the host draws each write over the workspace's held integrations, so the window reads it there.
    case ACT_KIND.WORKSPACE_SLACK_BOT_CONNECT:
      slackBot = { configured: true, team: SLACK_TEAM, notifications: true };
      layIntegrations(request.payload.workspaceId);
      return Promise.resolve(done(slackBot));
    case ACT_KIND.WORKSPACE_SLACK_BOT_DISCONNECT:
      slackBot = { configured: true };
      layIntegrations(request.payload.workspaceId);
      return Promise.resolve(done(slackBot));
    case ACT_KIND.WORKSPACE_SENTRY_DISCONNECT: {
      const { installationId } = request.payload;
      const was: WorkspaceSentry = sentry ?? { configured: true, installations: [] };
      sentry = {
        ...was,
        installations: was.installations.filter((one) => one.installationId !== installationId),
      };
      layIntegrations(request.payload.workspaceId);
      return Promise.resolve(done(sentry));
    }
    case ACT_KIND.WORKSPACE_GITHUB_CONNECT:
      if (refuseGitHubOpen) {
        return Promise.resolve({
          status: FAKE_ANSWER.REFUSED,
          reason: "Vespin could not open your browser.",
        });
      }
      return Promise.resolve(done(undefined));
    case ACT_KIND.WORKSPACE_GITHUB_DISCONNECT:
      return Promise.resolve(done(undefined));
    case ACT_KIND.WORKSPACE_RENAME:
      if (refuseRename) {
        return Promise.resolve({
          status: FAKE_ANSWER.REFUSED,
          reason: WORKSPACE_NOT_PERMITTED_REFUSAL,
        });
      }
      return Promise.resolve(done({ ...ACME, name: request.payload.name }));
    case ACT_KIND.WORKSPACE_PHOTO_SET:
      if (refusePhoto) {
        return Promise.resolve({
          status: FAKE_ANSWER.REFUSED,
          reason: WORKSPACE_NOT_PERMITTED_REFUSAL,
        });
      }
      return Promise.resolve(
        done(request.payload.photo === null ? ACME : { ...ACME, photoVersion: "v2" }),
      );
    case ACT_KIND.WORKSPACE_MEMBER_ROLE: {
      if (refuseRole) {
        return Promise.resolve({
          status: FAKE_ANSWER.REFUSED,
          reason: WORKSPACE_NOT_PERMITTED_REFUSAL,
        });
      }
      const { userId, role } = request.payload;
      stored = stored.map((member) => (member.userId === userId ? { ...member, role } : member));
      layPeople(request.payload.workspaceId);
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
      layPeople(request.payload.workspaceId);
      return Promise.resolve(done(stored));
    }
    case ACT_KIND.WORKSPACE_LEAVE:
      return Promise.resolve(done(undefined));
    case ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_RETRY:
      layTokenRepositories(request.payload.workspaceId);
      return Promise.resolve(done(undefined));
    case ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET: {
      const { workspaceId, repository, added } = request.payload;
      tokenRepositories = added
        ? [
            { fullName: repository, addedBy: READER_ID, addedAt: 2, removable: true },
            ...tokenRepositories,
          ]
        : tokenRepositories.filter((one) => one.fullName !== repository);
      layTokenRepositories(workspaceId, false);
      return Promise.resolve(done(tokenRepositories));
    }
    default:
      return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
  }
}

/** One kind on the act port, answered by `answer`, a refusal as the port's declared error. */
function onPort(kind: PortActKind) {
  return async (payload: PortActPayload<PortActKind>) => {
    // SAFETY: the port hands each procedure the payload its own kind takes.
    const outcome = await answer({ kind, payload } as Asked);
    if (outcome.status === FAKE_ANSWER.DONE) return outcome.value;
    throw refusedOnPort(
      outcome.status === FAKE_ANSWER.REFUSED ? outcome.reason : "Not in this test.",
    );
  };
}

/** The act port answering every workspace and task kind, as `answer` does. */
function workspacePort(): Parameters<typeof fakeActPort>[0] {
  const kinds: readonly PortActKind[] = [
    ...Object.values(TASKS_ACT_KIND),
    ...Object.values(WORKSPACE_ACT_KIND),
  ];
  const procedures = kinds.map((kind) => [kind, onPort(kind)]);
  // SAFETY: each kind's procedure answers that kind's own result, as `answer` gives it.
  return Object.fromEntries(procedures) as Parameters<typeof fakeActPort>[0];
}

const roots: Root[] = [];
const registries: AtomRegistry.AtomRegistry[] = [];

beforeEach(() => {
  installScrollIntoView();
  stored = [OWNER, MEMBER];
  sent = [];
  refuseMembersRead = false;
  refuseInvitationsRead = false;
  refuseRemoval = false;
  invitations = [];
  refuseInvitation = false;
  inviteHeld = undefined;
  refuseGitHubOpen = false;
  sentry = SENTRY_NOT_SET_UP;
  slackBot = { configured: false };
  refuseRename = false;
  refusePhoto = false;
  refuseRole = false;
  automations = undefined;
  githubRepositories = [];
  tokenReach = [];
  beforeAddable = false;
  tokenRepositories = [];
  tokenReadHeld = undefined;
  tokenReadFails = false;
  tokenSaved = true;
  heldTokenRepositories = NO_KEYS_HELD;
  // SAFETY: the fake answers each kind with its own result, the dispatch on the kind the one erasure.
  fakeAppBridge({});
  fakeActPort({
    ...workspacePort(),
    // Note that the host lays what it read once the hold is taken, never inside it.
    [ACT_KIND.WORKSPACE_MEMBERS_FOLLOW]: (input) => {
      sent.push({ kind: ACT_KIND.WORKSPACE_MEMBERS_FOLLOW, payload: input });
      void Promise.resolve().then(() => layPeople(input.workspaceId));
      return quietHold();
    },
    [ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW]: (input) => {
      void Promise.resolve().then(() => layIntegrations(input.workspaceId));
      return quietHold();
    },
    [ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW]: (input) => {
      sent.push({ kind: ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW, payload: input });
      void Promise.resolve().then(() => layInvitations(input.workspaceId));
      return quietHold();
    },
    // Note that the token repositories' read waits where the test holds it, as one still out on the wire.
    [ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW]: (input) => {
      sent.push({ kind: ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW, payload: input });
      const held = tokenReadHeld;
      tokenReadHeld = undefined;
      void (held ?? Promise.resolve()).then(() => layTokenRepositories(input.workspaceId));
      return quietHold();
    },
  });
  handCapabilities(DESKTOP_CAPABILITIES);
  people = NO_KEYS_HELD;
  integrations = NO_KEYS_HELD;
  heldInvitations = NO_KEYS_HELD;
  const reads = handHostReads({});
  deliverPeople = reads.deliverMembers;
  deliverIntegrations = reads.deliverIntegrations;
  deliverInvitations = reads.deliverInvitations;
  deliverTokenRepositories = reads.deliverTokenRepositories;
  // Note that a workspace's automations are laid as the leave holds them, where the test names any.
  holdAutomations(reads.deliverAutomations, {
    [AUTOMATION_FOLLOW.WORKSPACE]: () =>
      automations === undefined ? undefined : { rows: automations.map(automationOf) },
  });
  holdRepositoryLists(reads.deliverRepositoryLists, listing);
  holdGitHubToken(() => ({ rows: { token: tokenSaved ? SAVED_TOKEN : null } }));
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
async function mount(
  workspace: Workspace,
  others: readonly Workspace[] = [],
  openPerson?: (userId: string, name?: string, workspaceId?: string) => void,
) {
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
            createElement(
              OpenSettingsProvider,
              { value: (_link: SettingsLink) => undefined },
              openPerson === undefined
                ? createElement(WorkspacePage, { control, readerId: READER_ID })
                : createElement(
                    OpenPersonProvider,
                    { value: openPerson },
                    createElement(WorkspacePage, { control, readerId: READER_ID }),
                  ),
            ),
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

/** Every row of the page, the shared row and the window's own alike. */
const ROWS = ".settings-row, .ui-settings-row";

/** What a row names: the shared row's label, or the window's own row's first words. */
const nameOf = (row: Element) =>
  row.matches(".ui-settings-row")
    ? row.querySelector('[id$="label"]')?.textContent
    : row.querySelector("strong")?.firstChild?.textContent;

/** The page's row naming `name`, the reader's own beside its You. */
const rowNamed = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll<HTMLElement>(ROWS)].find((row) => nameOf(row) === name) ??
  assert.fail(`no ${name} row`);

/** The Members row naming `name`, the reader's own beside its You. */
const memberNamed = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll<HTMLElement>(".menu-row")].find(
    (row) => row.querySelector('[id$="label"]')?.firstChild?.firstChild?.textContent === name,
  ) ?? assert.fail(`no ${name} member`);

/** A member row's line under the name: their email. */
const emailOf = (row: HTMLElement) => row.querySelector("p")?.textContent;

/** The rows of the invitations still pending, by the line each wears. */
const invitationRows = (page: HTMLElement) =>
  [...page.querySelectorAll<HTMLElement>(".menu-row")].filter((row) =>
    row.querySelector("p")?.textContent?.startsWith("Invited as "),
  );

/** A pending invitation's address, its row's label. */
const addressOf = (row: HTMLElement) => row.querySelector('[id$="label"] .ui-one-line');

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

/** Chooses `label` from the ⋯ on `row`, or presses its button of that name where the row's one act stands alone. */
async function chooseAction(row: HTMLElement, label: string): Promise<void> {
  const lone = row.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (lone !== null) {
    act(() => lone.click());
    await settle();
    return;
  }
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

/** Types `words` into the standing question's gate, as a reader typing the subject's name does. */
function typeGate(words: string): void {
  const field = dialog().querySelector<HTMLInputElement>("input") ?? assert.fail("no gate");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Answers the standing question with its dangerous answer. */
async function confirm(verb: string): Promise<void> {
  act(() => button(dialog(), verb).click());
  await settle();
}

/** The page's first row: the workspace's tile, name, and line, its Rename, and its ⋯. */
const identity = (page: HTMLElement) =>
  page.querySelector<HTMLElement>(".menu-row") ?? assert.fail("no identity row");

/** What a row says its last act was refused with, in its error line, or nothing while that is empty. */
const refusalOf = (within: Element) =>
  [...within.querySelectorAll('[data-slot="field-error"]')]
    .map((each) => each.textContent)
    .find((words) => words !== null && words !== "");

/** Whether anything drawn is busy, as a placeholder standing for a read still out is. */
const busy = (container: HTMLElement) => container.querySelector('[aria-busy="true"]') !== null;

/** The page's group a Settings link names by `anchor`. */
const section = (page: HTMLElement, anchor: string) =>
  page.querySelector<HTMLElement>(`[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${anchor}"]`) ??
  assert.fail(`no ${anchor} group`);

/** The placeholder standing for a read still out, what it says it reads, and how many rows it stands. */
const placeholderOf = (within: Element) => {
  const status = within.querySelector('[role="status"][aria-busy="true"]');
  return status === null
    ? undefined
    : [status.textContent, status.querySelectorAll(".ui-settings-row").length];
};

/** The boxes the first settings row in `within` is built of, in order, its words and blocks aside. */
const rowBoxes = (within: Element) =>
  [...(within.querySelector(".ui-settings-row")?.querySelectorAll("[class]") ?? [])]
    .map((element) => element.getAttribute("class") ?? "")
    .filter((name) => name.startsWith("ui-settings-row"));

/** The workspace's name, as the identity row's label says it. */
const nameShown = (page: HTMLElement) => identity(page).querySelector('[id$="label"]')?.textContent;

/** Who shares the workspace and the account's role in it, as the identity row's line says it. */
const roleLine = (page: HTMLElement) => identity(page).querySelector("p")?.textContent;

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

  assert.equal(nameShown(page), ACME.name);
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
  assert.equal(refusalOf(identity(admin.page)), WORKSPACE_NOT_PERMITTED_REFUSAL);

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

    assert.equal(nameShown(page), FIRST.name);
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

test("an owner's picked photo is sent drawn as its center square in WebP, 256 pixels a side, and Upload photo in the ⋯ opens the picker", async () => {
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
  const said = () => refusalOf(identity(page));

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
  // The confirm repeats the menu's verb and says in one line what goes, with no ellipsis.
  assert.match(
    dialog().textContent ?? "",
    /The photo is deleted, and the workspace is marked by its first letter instead\./u,
  );
  assert.equal((dialog().textContent ?? "").includes("…"), false);
  await confirm("Remove photo");

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
    [ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW, ACT_KIND.WORKSPACE_MEMBERS_FOLLOW],
  );
  assert.equal(emailOf(memberNamed(page, "Dana")), "dana@example.com");
  assert.deepEqual(
    ["Dana", "Sam"].map(
      (name) => memberNamed(page, name).querySelector(".ui-settings-row-value")?.textContent,
    ),
    ["Owner", "Member"],
  );
  assert.deepEqual(rowActions(memberNamed(page, "Sam")), ["Copy link"]);
});

/** Lays `words` out narrower than they run, as a row too narrow for an address does, and tells the window. */
function cutShort(words: Element): void {
  Object.defineProperty(words, "scrollWidth", { configurable: true, value: 320 });
  Object.defineProperty(words, "clientWidth", { configurable: true, value: 180 });
  act(() => relayout());
}

/** The pill the pointer resting on `words` raises, or nothing where it raises none. */
function pillOver(words: Element): string | undefined {
  restOn(words);
  const pill = document.querySelector('[role="tooltip"]:not([inert])')?.textContent ?? undefined;
  act(() => words.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
  return pill;
}

test("a member's address and an invited one, where the row cuts them short, are read whole when the pointer rests on them", async () => {
  const LONG = "bartholomew.montgomery-fitzgerald@orbital-freight.example.com";
  stored = [OWNER, { ...MEMBER, email: LONG }];
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  await invite(page, LONG, WORKSPACE_ROLE.MEMBER);
  const addresses = [
    memberNamed(page, "Sam").querySelector("p .ui-one-line"),
    addressOf(invitationRows(page)[0] ?? assert.fail("no pending invitation")),
  ].map((words) => words ?? assert.fail("an address is not drawn"));

  assert.deepEqual(addresses.map(pillOver), [undefined, undefined], "drawn whole, no pill");
  for (const words of addresses) cutShort(words);
  assert.deepEqual(addresses.map(pillOver), [LONG, LONG]);
});

test("each member's row leads with their face, their picture where the read lists one and their letter where it lists none, and the reader's own wears You", async () => {
  const { page } = await mount(ACME);

  const dana = memberNamed(page, "Dana");
  const sam = memberNamed(page, "Sam");
  assert.equal(dana.querySelector(".actor-mark")?.textContent, "D");
  assert.equal(
    sam.querySelector<HTMLImageElement>(".actor-mark img")?.src,
    "https://lh3.googleusercontent.com/a/photo-7",
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

test("while the members are being read the rest of the page stands, a placeholder row for each member in theirs, and a read that failed says so with Retry", async () => {
  refuseMembersRead = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const control: WorkspaceSettingsControl = {
    workspaces: [FIRST, { ...ACME, memberCount: 3 }],
    workspaceId: ACME.id,
    onLeft: () => undefined,
    listFailed: false,
    onRetryList: () => undefined,
  };
  const registry = AtomRegistry.make();
  registries.push(registry);
  act(() =>
    root.render(
      onRegistry(
        registry,
        createElement(SettingsPage, {
          title: "Workspace",
          children: createElement(WorkspacePage, { control, readerId: READER_ID }),
        }),
      ),
    ),
  );
  const members = section(container, SETTINGS_SECTION.MEMBERS);
  const whileReading = {
    members: placeholderOf(members),
    identityHeld: identity(container).closest('[aria-busy="true"]') !== null,
  };
  const placeholderBoxes = rowBoxes(members);
  await settle();

  assert.deepEqual(whileReading, { members: ["Reading the members", 3], identityHeld: false });
  assert.equal(
    container.querySelector('[role="alert"]')?.textContent,
    "The members could not be read.Retry",
  );
  refuseMembersRead = false;
  act(() => button(container, "Retry").click());
  await settle();
  assert.ok(memberNamed(container, "Sam"));
  assert.equal(busy(container), false);
  // A member's placeholder stood in the boxes of the row that landed: its face, its email, its role.
  assert.deepEqual(placeholderBoxes, rowBoxes(section(container, SETTINGS_SECTION.MEMBERS)));
});

test("before the workspaces are read, placeholder sections stand in the page's shape, saying what is read", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const control: WorkspaceSettingsControl = {
    workspaces: [],
    workspaceId: undefined,
    onLeft: () => undefined,
    listFailed: false,
    onRetryList: () => undefined,
  };
  act(() =>
    root.render(
      createElement(SettingsPage, {
        title: "Workspace",
        children: createElement(WorkspacePage, { control, readerId: READER_ID }),
      }),
    ),
  );

  // The identity unheaded, the members, and a row to each integration the page draws.
  const sections = [...container.querySelectorAll('[role="status"] .ui-settings-section')].map(
    (group) => [
      group.querySelector(".ui-settings-section-head") !== null,
      group.querySelectorAll(".ui-settings-row").length,
    ],
  );
  assert.deepEqual(placeholderOf(container)?.[0], "Reading your workspaces");
  assert.deepEqual(sections, [
    [false, 1],
    [true, 1],
    [true, 3],
  ]);
});

test("an admin is offered Remove for a member but not for the owner, and Remove asks before it removes", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  assert.deepEqual(rowActions(memberNamed(page, "Dana")), ["Copy link"]);
  await chooseAction(memberNamed(page, "Sam"), "Remove from workspace");
  const askedFirst = !sent.some((request) => request.kind === ACT_KIND.WORKSPACE_MEMBER_REMOVE);
  // The confirm repeats the menu's verb.
  await confirm("Remove from workspace");

  assert.equal(askedFirst, true);
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.WORKSPACE_MEMBER_REMOVE)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id, userId: MEMBER.userId }],
  );
  assert.equal(
    [...page.querySelectorAll(".menu-row")].some((each) => each.textContent?.includes("Sam")),
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

  assert.deepEqual(rowActions(memberNamed(page, "Dana")), ["Copy link"]);
  assert.deepEqual(rowActions(memberNamed(page, "Sam")), ["Copy link", "Remove from workspace"]);
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
  const adminSees = rowActions(memberNamed(asAdmin.page, "Ola"));
  const asOwner = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });

  assert.deepEqual(adminSees, ["Copy link"]);
  assert.deepEqual(rowActions(memberNamed(asOwner.page, "Ola")), [
    "Copy link",
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

  assert.deepEqual(rowActions(memberNamed(page, "Sam")), [
    "Copy link",
    "Make admin",
    "Remove from workspace",
  ]);
  await chooseAction(memberNamed(page, "Sam"), "Make admin");

  assert.deepEqual(roleSent(), [
    [
      ACT_KIND.WORKSPACE_MEMBER_ROLE,
      { workspaceId: ACME.id, userId: MEMBER.userId, role: WORKSPACE_ROLE.ADMIN },
    ],
  ]);
  assert.equal(
    memberNamed(page, "Sam").querySelector(".ui-settings-row-value")?.textContent,
    "Admin",
  );
  assert.equal(document.querySelector('[role="alertdialog"]'), null, "nothing asked first");
});

test("the owner's ⋯ on an admin holds Make member, Make owner, and Remove, and Make owner asks first, then hands the workspace over", async () => {
  stored = [OWNER, ADMIN_OLA, MEMBER];
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });

  assert.deepEqual(rowActions(memberNamed(page, "Ola")), [
    "Copy link",
    "Make member",
    "Make owner",
    "Remove from workspace",
  ]);
  await chooseAction(memberNamed(page, "Ola"), "Make owner");
  const askedFirst = roleSent().length === 0;
  const question = dialog().querySelector("h2")?.textContent;
  await confirm("Make owner");

  assert.equal(askedFirst, true);
  assert.equal(question, "Make Ola the owner of acme?");
  assert.deepEqual(roleSent(), [
    [ACT_KIND.WORKSPACE_TRANSFER, { workspaceId: ACME.id, userId: ADMIN_OLA.userId }],
  ]);
  assert.equal(
    memberNamed(page, "Ola").querySelector(".ui-settings-row-value")?.textContent,
    "Owner",
  );
});

test("an admin of the account's own first workspace is never offered Make owner, since it is named for its creator", async () => {
  stored = [OWNER, ADMIN_OLA];
  const { page } = await mount({ ...FIRST, role: WORKSPACE_ROLE.OWNER });

  assert.deepEqual(rowActions(memberNamed(page, "Ola")), [
    "Copy link",
    "Make member",
    "Remove from workspace",
  ]);
});

test("an admin is offered no role change, and a role change the service refuses is said under the row", async () => {
  const asAdmin = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });
  const adminSees = rowActions(memberNamed(asAdmin.page, "Sam"));
  refuseRole = true;
  const asOwner = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  await chooseAction(memberNamed(asOwner.page, "Sam"), "Make admin");

  assert.deepEqual(adminSees, ["Copy link", "Remove from workspace"]);
  assert.equal(refusalOf(memberNamed(asOwner.page, "Sam")), WORKSPACE_NOT_PERMITTED_REFUSAL);
});

/** The page's last group, the way out of the workspace, where it draws one. */
const leaveGroup = (page: HTMLElement) =>
  page.querySelector<HTMLElement>(
    `[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${SETTINGS_SECTION.LEAVE}"]`,
  );

/** What the leave group's one row says under its name. */
const leaveLine = (group: HTMLElement) =>
  rowWords(group.querySelector<HTMLElement>(ROWS) ?? assert.fail("no leave row"))[1];

test("the owner cannot leave until the workspace is handed over: its row says so and Transfer ownership hands it to the admin chosen, the first by name unless another is, each offered with their email beside their name, once the workspace's name is typed", async () => {
  const other: WorkspaceMember = {
    ...ADMIN_OLA,
    userId: "user-kim",
    name: "Kim",
    email: "kim@example.com",
  };
  stored = [OWNER, ADMIN_OLA, other, MEMBER];
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  const group = leaveGroup(page) ?? assert.fail("no leave");
  const line = leaveLine(group);
  act(() => button(group, "Transfer ownership").click());
  const chip =
    dialog().querySelector<HTMLButtonElement>('button[aria-label^="New owner"]') ??
    assert.fail("no new owner");
  const first = chip.getAttribute("aria-label");
  act(() => chip.click());
  const offered = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')];
  const names = offered.map((item) => item.textContent);
  const besides = offered.map((item) =>
    item.querySelector(".ui-menu-item-copy")?.getAttribute("data-place"),
  );
  act(() => offered.find((item) => item.textContent?.includes("ola@example.com"))?.click());
  assert.equal((dialog().textContent ?? "").includes(`Transfer ownership of ${ACME.name}?`), true);
  await confirm("Transfer ownership");
  const refusedUntilNamed = roleSent();
  typeGate(ACME.name.toUpperCase());
  await confirm("Transfer ownership");
  const refusedMisnamed = roleSent();
  typeGate(ACME.name);
  await confirm("Transfer ownership");

  assert.equal(line, "You're its owner. Make an admin the owner first, then you can leave.");
  assert.deepEqual(buttons(group, "Leave"), []);
  assert.equal(first, "New owner: Kim");
  assert.deepEqual(
    names.map((name) => name?.replace(/^[A-Z]/u, "")),
    ["Kimkim@example.com", "Olaola@example.com"],
  );
  assert.deepEqual(besides, ["beside", "beside"]);
  assert.deepEqual(refusedUntilNamed, [], "the act waits on the workspace's name");
  assert.deepEqual(refusedMisnamed, [], "a name typed otherwise is not the name");
  assert.deepEqual(roleSent(), [
    [ACT_KIND.WORKSPACE_TRANSFER, { workspaceId: ACME.id, userId: ADMIN_OLA.userId }],
  ]);
});

test("the owner with no admin is told to make one first and offered no handover, and the owner of the account's own workspace sees no leave at all", async () => {
  const team = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  const group = leaveGroup(team.page) ?? assert.fail("no leave");
  const own = await mount({ ...FIRST, role: WORKSPACE_ROLE.OWNER });

  assert.equal(
    leaveLine(group),
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

test("the members the host lays on the document are drawn with nothing asked again, so an admin who joined meanwhile may be handed the workspace", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER, memberCount: 2 });
  const offeredBefore = buttons(
    leaveGroup(page) ?? assert.fail("no leave"),
    "Transfer ownership",
  ).length;
  act(() => deliverPeople({ [ACME.id]: { rows: { members: [OWNER, ADMIN_OLA, MEMBER] } } }));
  await settle();
  act(() => button(leaveGroup(page) ?? assert.fail("no leave"), "Transfer ownership").click());
  await settle();

  assert.equal(offeredBefore, 0);
  assert.deepEqual(
    sent
      .filter((request) => request.kind.startsWith("workspace.members"))
      .map((request) => request.kind),
    [ACT_KIND.WORKSPACE_MEMBERS_FOLLOW],
  );
  assert.equal(
    dialog().querySelector('button[aria-label^="New owner"]')?.getAttribute("aria-label"),
    "New owner: Ola",
  );
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

  assert.equal(admin.includes("Invitations you sent stay valid."), true);
  assert.equal(
    member.some((line) => line?.startsWith("Invitations")),
    false,
  );
});

test("a removal the account's role does not allow says so in a toast", async () => {
  refuseRemoval = true;
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  // A press's refusal is said on the window's own toasts, which the page's registry does not hold.
  const toasts = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(toasts);
  act(() => toasts.render(onRegistry(rendererRegistry, createElement(ToastHost))));

  await chooseAction(memberNamed(page, "Sam"), "Remove from workspace");
  await confirm("Remove from workspace");

  assert.deepEqual(
    [...document.querySelectorAll(".ui-toast:not([data-leaving]) .ui-toast-words")].map(
      (words) => words.textContent,
    ),
    [WORKSPACE_NOT_PERMITTED_REFUSAL],
  );
});

test("a member leaves after confirming, which names what stays and what stops, and lands the window; an owner is offered no Leave", async () => {
  const member = await mount(ACME);
  const leaveRow = leaveGroup(member.page) ?? assert.fail("no leave");
  const line = leaveLine(leaveRow);
  act(() => button(leaveRow, "Leave").click());
  const named = [...dialog().querySelectorAll(".leave-consequences li")].map(
    (li) => li.textContent,
  );
  await confirm("Leave acme");

  assert.equal(line, "You lose its tasks, agents, and inbox until someone invites you again.");
  assert.deepEqual(named, [
    "Tasks you wrote stay in acme.",
    "Agents you started that are still working stop.",
    "Automations you created stop running.",
    "Your own workspace, Dana, isn't affected.",
  ]);

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
  assert.equal(emailOf(memberNamed(page, "Dana")), "dana@example.com");
  assert.deepEqual(
    sent.filter((request) => request.kind === ACT_KIND.WORKSPACE_GITHUB_CONNECT),
    [{ kind: ACT_KIND.WORKSPACE_GITHUB_CONNECT, payload: { workspaceId: FIRST.id } }],
  );
});

const CONNECTED: Workspace = {
  ...ACME,
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme-org", active: true },
  githubInstallations: [{ installationId: 11, login: "acme-org", active: true }],
};

/** A workspace holding two GitHub accounts, the first linked first, the second suspended. */
const SEVERAL: Workspace = {
  ...CONNECTED,
  githubInstallations: [
    { installationId: 11, login: "acme-org", active: true },
    { installationId: 12, login: "acme-labs", active: false },
  ],
};

/** The Workspace page's GitHub group, found by the anchor its links have always named. */
const githubGroup = (page: HTMLElement) =>
  page.querySelector<HTMLElement>(
    `[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${SETTINGS_SECTION.GITHUB_REPOSITORIES}"]`,
  ) ?? assert.fail("no GitHub group");

/** What a row says: its name, and the line under it. */
const rowWords = (row: HTMLElement) => [
  nameOf(row),
  row.matches(".ui-settings-row")
    ? row.querySelector('[id$="description"]')?.textContent
    : row.querySelector("small")?.textContent,
];

/** What every row of the Integrations group says, in order. */
const integrationRows = (page: HTMLElement) =>
  [...githubGroup(page).querySelectorAll<HTMLElement>(ROWS)].map(rowWords);

/** The words of every button a row draws. */
const rowButtons = (row: HTMLElement) =>
  [...row.querySelectorAll("button")].map((each) => each.textContent);

/** The row's ⋯, which opens its menu. */
const ellipsisOn = (row: HTMLElement) =>
  row.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ??
  assert.fail("the row draws no ⋯");

/** The connects and disconnects sent, by their payloads. */
const githubSent = () =>
  sent.flatMap((request) =>
    request.kind === ACT_KIND.WORKSPACE_GITHUB_CONNECT ||
    request.kind === ACT_KIND.WORKSPACE_GITHUB_DISCONNECT
      ? [[request.kind, request.payload]]
      : [],
  );

/** The words GitHub's row says to a member once an account is connected. */
const MANAGED_ON_GITHUB = "Accounts and repositories are managed on GitHub.";

test("an owner or an admin of a connected workspace sees GitHub's row, led by its mark, with Add repository, one Manage on GitHub, and no menu, and every account connected under it", async () => {
  for (const role of [WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]) {
    const { page } = await mount({ ...SEVERAL, role });
    const group = githubGroup(page);
    const row = rowNamed(group, "GitHub");
    act(() => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });

    assert.equal(group.querySelector("h2")?.textContent, "Workspace connections");
    assert.equal(
      row.querySelector(".ui-settings-row-mark")?.innerHTML,
      renderToStaticMarkup(createElement(ProviderMark, { provider: INTEGRATION_PROVIDER.GITHUB })),
    );
    assert.deepEqual(
      rowButtons(row),
      ["Add repository", "Manage on GitHub"],
      `a ${role}'s controls`,
    );
    assert.equal(document.querySelector('[role="menu"]'), null, "GitHub's row has no menu");
    assert.deepEqual(integrationRows(page), [
      ["GitHub", undefined],
      ["acme-org", "Connected"],
      ["acme-labs", "Suspended or removed on GitHub."],
    ]);
    assert.equal(
      rowNamed(group, "acme-labs").querySelector('[data-state="attention"]')?.textContent,
      "Suspended or removed on GitHub.",
    );
    for (const name of ["acme-org", "acme-labs"]) {
      const account = rowNamed(group, name);
      assert.equal(
        account.querySelector(".ui-avatar[data-shape='tile']")?.textContent,
        "A",
        `${name}'s tile`,
      );
      assert.equal(
        account.querySelector<HTMLImageElement>(".ui-avatar-picture")?.getAttribute("src"),
        `https://github.com/${name}.png?size=32`,
        `${name}'s picture is its own on GitHub`,
      );
      assert.deepEqual(rowButtons(account), [], `${name} offers nothing to press`);
    }
    for (const root of roots.splice(0)) act(() => root.unmount());
  }
});

test("Manage on GitHub opens GitHub through the same connect as Connect, and nothing on the page disconnects GitHub", async () => {
  const { page } = await mount(SEVERAL);

  act(() => button(rowNamed(page, "GitHub"), "Manage on GitHub").click());
  await settle();

  assert.equal(page.textContent?.includes("Disconnect"), false);
  assert.deepEqual(githubSent(), [
    [ACT_KIND.WORKSPACE_GITHUB_CONNECT, { workspaceId: SEVERAL.id }],
  ]);
});

test("a service from before several connections names one GitHub account alone, which is listed as the only one", async () => {
  const { githubInstallations: _dropped, ...legacy } = CONNECTED;
  const { page } = await mount(legacy);

  assert.deepEqual(integrationRows(page), [
    ["GitHub", undefined],
    ["acme-org", "Connected"],
  ]);
  assert.deepEqual(rowButtons(rowNamed(page, "GitHub")), ["Add repository", "Manage on GitHub"]);
});

test("Escape in a member's menu hands focus back to its ⋯", async () => {
  const { page } = await mount(ACME);
  const ellipsis = ellipsisOn(memberNamed(page, "Sam"));

  act(() => ellipsis.click());
  const firstFocused = document.activeElement?.textContent;
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });

  assert.equal(firstFocused, "Copy link");
  assert.equal(document.activeElement, ellipsis);
  assert.equal(ellipsis.getAttribute("aria-expanded"), "false");
});

test("a GitHub page the browser could not open is said under the row, from Manage on GitHub and Connect alike", async () => {
  refuseGitHubOpen = true;
  const managed = await mount(CONNECTED);
  act(() => button(rowNamed(managed.page, "GitHub"), "Manage on GitHub").click());
  await settle();
  const unconnected = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  act(() => button(rowNamed(unconnected.page, "GitHub"), "Connect").click());
  await settle();

  for (const { page } of [managed, unconnected]) {
    assert.equal(refusalOf(githubGroup(page)), "Vespin could not open your browser.");
  }
});

test("an owner or an admin of a workspace with no GitHub is offered Connect beside Add repository, which opens the same connect", async () => {
  for (const role of [WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]) {
    const { page } = await mount({ ...ACME, role, githubInstallations: [] });
    const row = rowNamed(page, "GitHub");

    assert.deepEqual(rowWords(row), ["GitHub", "Not connected."]);
    assert.deepEqual(rowButtons(row), ["Add repository", "Connect"]);
    assert.equal(row.querySelector('[aria-haspopup="menu"]'), null);
    assert.deepEqual(integrationRows(page), [["GitHub", "Not connected."]]);
    act(() => button(row, "Connect").click());
    await settle();
  }

  assert.deepEqual(githubSent(), [
    [ACT_KIND.WORKSPACE_GITHUB_CONNECT, { workspaceId: ACME.id }],
    [ACT_KIND.WORKSPACE_GITHUB_CONNECT, { workspaceId: ACME.id }],
  ]);
});

test("a member reads every account connected, or is told to ask an owner or admin, and is offered Add repository alone: no Manage on GitHub, Connect, or right-click menu", async () => {
  const connected = await mount({ ...SEVERAL, role: WORKSPACE_ROLE.MEMBER });
  const unconnected = await mount(ACME);

  assert.deepEqual(integrationRows(connected.page), [
    ["GitHub", MANAGED_ON_GITHUB],
    ["acme-org", "Connected"],
    ["acme-labs", "Suspended or removed on GitHub."],
  ]);
  assert.deepEqual(integrationRows(unconnected.page), [
    ["GitHub", "Not connected. Ask an owner or admin."],
  ]);
  for (const { page } of [connected, unconnected]) {
    const group = githubGroup(page);
    assert.deepEqual(rowButtons(group), ["Add repository"]);
    for (const row of group.querySelectorAll<HTMLElement>(ROWS)) {
      act(() => {
        row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      });
      assert.equal(document.querySelector('[role="menu"]'), null);
    }
  }
});

test("the repositories members added on their tokens stand under GitHub's accounts marked Token, with Remove where the service says the reader may, and a removal lists what the service answers", async () => {
  tokenRepositories = [
    { fullName: "octo-member/side", addedBy: MEMBER.userId, addedAt: 2, removable: false },
    { fullName: "acme/relay", addedBy: READER_ID, addedAt: 1, removable: true },
  ];
  const { page } = await mount(SEVERAL);
  const group = githubGroup(page);

  assert.deepEqual(
    integrationRows(page).map(([name]) => name),
    ["GitHub", "acme-org", "acme-labs", "octo-member/side", "acme/relay"],
  );
  for (const name of ["octo-member/side", "acme/relay"]) {
    assert.equal(rowNamed(group, name).querySelector(".ui-badge")?.textContent, "Token");
  }
  assert.deepEqual(rowButtons(rowNamed(group, "octo-member/side")), []);

  act(() => button(rowNamed(group, "acme/relay"), "Remove").click());
  const asked = sent.some((one) => one.kind === ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET);
  // The repository goes for every member's agents, so its removal asks first, in the accent.
  act(() => button(dialog(), "Remove").click());
  await settle();

  assert.equal(asked, false, "nothing is sent while it asks");
  assert.deepEqual(
    sent
      .filter((one) => one.kind === ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET)
      .map((one) => one.payload),
    [{ workspaceId: SEVERAL.id, repository: "acme/relay", added: false }],
  );
  assert.deepEqual(
    integrationRows(page).map(([name]) => name),
    ["GitHub", "acme-org", "acme-labs", "octo-member/side"],
  );
});

test("Add repository offers the repositories the reader's own token may push to that the workspace lists nowhere yet, and a pick adds one", async () => {
  githubRepositories = ["acme/relay"];
  tokenReach = ["octo-member/side", "octo-member/notes"];
  tokenRepositories = [
    { fullName: "octo-member/notes", addedBy: MEMBER.userId, addedAt: 1, removable: false },
  ];
  const { page } = await mount({ ...SEVERAL, role: WORKSPACE_ROLE.MEMBER });

  act(() => button(rowNamed(page, "GitHub"), "Add repository").click());
  await settle();
  const offered = [...document.querySelectorAll('[role="option"]')].map(optionWords);
  const side = document.querySelector<HTMLElement>('[role="option"]') ?? assert.fail("no option");
  act(() => side.click());
  await settle();

  assert.deepEqual(offered, [["side", "octo-member"]]);
  assert.deepEqual(
    sent
      .filter((one) => one.kind === ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET)
      .map((one) => one.payload),
    [{ workspaceId: SEVERAL.id, repository: "octo-member/side", added: true }],
  );
  assert.equal(
    rowNamed(githubGroup(page), "octo-member/side").querySelector(".ui-badge")?.textContent,
    "Token",
  );
});

test("Add repository offers the token's repositories from a service older than addable, which lists them among the picker's own", async () => {
  beforeAddable = true;
  githubRepositories = ["acme/relay"];
  tokenReach = ["octo-member/side"];
  const { page } = await mount({ ...SEVERAL, role: WORKSPACE_ROLE.MEMBER });

  act(() => button(rowNamed(page, "GitHub"), "Add repository").click());
  await settle();

  assert.deepEqual([...document.querySelectorAll('[role="option"]')].map(optionWords), [
    ["side", "octo-member"],
  ]);
});

test("with no token saved, GitHub's row offers no Add repository, to an owner, an admin, or a member", async () => {
  tokenSaved = false;
  const expected = {
    [WORKSPACE_ROLE.OWNER]: ["Manage on GitHub"],
    [WORKSPACE_ROLE.ADMIN]: ["Manage on GitHub"],
    [WORKSPACE_ROLE.MEMBER]: [],
  };
  for (const role of Object.values(WORKSPACE_ROLE)) {
    const { page } = await mount({ ...SEVERAL, role });

    assert.deepEqual(rowButtons(rowNamed(page, "GitHub")), expected[role], `a ${role}'s controls`);
  }
});

test("with a token saved and nothing left to add, Add repository still says there are no repositories", async () => {
  const { page } = await mount({ ...SEVERAL, role: WORKSPACE_ROLE.MEMBER });

  act(() => button(rowNamed(page, "GitHub"), "Add repository").click());
  await settle();

  assert.match(document.querySelector('[role="dialog"]')?.textContent ?? "", /No repositories/u);
});

/** A picker option's name and its muted owner, as the repository chip's menu draws a repository. */
function optionWords(option: Element): (string | null | undefined)[] {
  return [".ui-combobox-option-label", ".ui-combobox-option-detail"].map(
    (part) => option.querySelector(part)?.textContent,
  );
}

test("Add repository draws each repository as the repository chip's menu does, by its owner's picture and name, and a search finds it by its owner", async () => {
  githubRepositories = ["acme/relay"];
  tokenReach = [
    ...["a", "b", "c", "d", "e", "f", "g"].map((name) => `octo-member/${name}`),
    "side-org/zed",
  ];
  const { page } = await mount({ ...SEVERAL, role: WORKSPACE_ROLE.MEMBER });

  act(() => button(rowNamed(page, "GitHub"), "Add repository").click());
  await settle();
  const zed = () =>
    [...document.querySelectorAll('[role="option"]')].find(
      (one) => optionWords(one)[0] === "zed",
    ) ?? assert.fail("zed is not offered");
  const field = document.querySelector<HTMLInputElement>("input") ?? assert.fail("no search field");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, "side-org");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

  assert.deepEqual(optionWords(zed()), ["zed", "side-org"]);
  assert.equal(
    zed().querySelector("img.ui-avatar-picture")?.getAttribute("src"),
    "https://github.com/side-org.png?size=32",
  );
  assert.equal(document.querySelectorAll('[role="option"]').length, 1);
});

test("the token repositories say Reading while they are read, and a refused read says so with Retry, neither drawn as a workspace with none", async () => {
  tokenRepositories = [];
  tokenReadFails = true;
  let release: () => void = () => undefined;
  tokenReadHeld = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { page } = await mount({ ...SEVERAL, role: WORKSPACE_ROLE.MEMBER });
  const reading = page.textContent?.includes("Reading token repositories");
  release();
  await settle();
  const failed = page.textContent?.includes("The token repositories could not be read.");
  tokenReadFails = false;
  act(() => button(page, "Retry").click());
  await settle();

  assert.equal(reading, true, "a read still out says Reading");
  assert.equal(failed, true, "a refused read says so");
  assert.doesNotMatch(page.textContent ?? "", /Reading token|token repositories could not/u);
  assert.deepEqual(
    integrationRows(page).map(([name]) => name),
    ["GitHub", "acme-org", "acme-labs"],
    "the retry read a workspace with none",
  );
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
      .filter((request) => request.kind === ACT_KIND.WORKSPACE_MEMBERS_FOLLOW)
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
  const form =
    page.querySelector<HTMLFormElement>(".workspace-invite form") ?? assert.fail("no form");
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

test("the invite form's address field is named by a visible label, and, being required, is not marked Optional", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  const form =
    page.querySelector<HTMLFormElement>(".workspace-invite form") ?? assert.fail("no form");
  const address = form.querySelector("input") ?? assert.fail("no address field");
  assert.deepEqual(
    [...(address.labels ?? [])].map((each) => each.textContent),
    ["Email address"],
  );
  assert.equal(address.getAttribute("aria-required"), "true");
});

test("an address the service would refuse is said under the field, in the app's error line rather than the browser's, and nothing is sent until it is fixed", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  const form =
    page.querySelector<HTMLFormElement>(".workspace-invite form") ?? assert.fail("no form");
  const address = form.querySelector("input") ?? assert.fail("no address field");

  await invite(page, "alan", WORKSPACE_ROLE.MEMBER);

  assert.equal(
    form.querySelector('[data-slot="field-error"]')?.textContent,
    "Enter an address like name@example.com.",
  );
  assert.equal(address.getAttribute("aria-invalid"), "true");
  assert.equal(sent.filter((request) => request.kind === ACT_KIND.WORKSPACE_INVITE).length, 0);

  await invite(page, "alan@example.com", WORKSPACE_ROLE.MEMBER);

  assert.equal(address.getAttribute("aria-invalid"), null);
  assert.equal(sent.filter((request) => request.kind === ACT_KIND.WORKSPACE_INVITE).length, 1);
});

test("the owner invites an address as a role, sees it pending with its link to copy, and cancels it from its ⋯", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });

  await invite(page, "alan@example.com", WORKSPACE_ROLE.ADMIN);
  const row = invitationRows(page)[0] ?? assert.fail("no pending invitation");
  const face = row.querySelector<HTMLElement>(".actor-mark")?.dataset.kind;
  const listed = [addressOf(row)?.textContent, row.querySelector("p")?.textContent];
  act(() => button(row, "Copy invite link").click());
  await settle();
  const invitationLink = copied.slice();
  await chooseAction(row, "Cancel invitation");
  act(() => button(dialog(), "Cancel invitation").click());
  await settle();

  assert.deepEqual(invitationLink, [
    "https://vespin.dev/accept-invitation.html?id=inv-alan@example.com",
  ]);
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
      .filter(
        (request) =>
          request.kind !== ACT_KIND.WORKSPACE_MEMBERS_FOLLOW &&
          request.kind !== ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW &&
          request.kind !== ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW,
      )
      .map((request) => [request.kind, "payload" in request ? request.payload : undefined]),
    [
      [
        ACT_KIND.WORKSPACE_INVITE,
        { workspaceId: ACME.id, email: "alan@example.com", role: WORKSPACE_ROLE.ADMIN },
      ],
      [
        ACT_KIND.WORKSPACE_INVITATION_CANCEL,
        { workspaceId: ACME.id, invitationId: "inv-alan@example.com" },
      ],
    ],
  );
  assert.deepEqual(copied, ["https://vespin.dev/accept-invitation.html?id=inv-alan@example.com"]);
});

test("an invitation's role is a field chip, Member by default, whose menu checks the role and says what each may do, and the invitation is sent as the role chosen", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  const form =
    page.querySelector<HTMLFormElement>(".workspace-invite form") ?? assert.fail("no form");
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
  const form =
    page.querySelector<HTMLFormElement>(".workspace-invite form") ?? assert.fail("no form");
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

test("Canceling an invitation asks first, in the accent rather than red, and sends nothing until it is answered", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  await invite(page, "alan@example.com", WORKSPACE_ROLE.MEMBER);
  const row = invitationRows(page)[0] ?? assert.fail("no pending invitation");
  const cancels = () =>
    sent.filter((request) => request.kind === ACT_KIND.WORKSPACE_INVITATION_CANCEL).length;

  await chooseAction(row, "Cancel invitation");
  const asked = cancels();
  const answer = button(dialog(), "Cancel invitation");

  assert.equal(asked, 0, "nothing is sent while it asks");
  assert.match(dialog().textContent ?? "", /alan@example\.com/u);
  act(() => answer.click());
  await settle();
  assert.equal(cancels(), 1);
  assert.deepEqual(invitationRows(page), []);
});

test("each pending invitation's Cancel invitation stands in a group named by its address, so a reader hears which one it cancels", async () => {
  invitations = ["sam", "ada"].map((name) => ({
    id: `inv-${name}`,
    email: `${name}@example.com`,
    role: WORKSPACE_ROLE.MEMBER,
    expiresAt: "2026-10-16T12:00:00.000Z",
    acceptUrl: `https://vespin.dev/accept-invitation.html?id=inv-${name}`,
  }));
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  const named = [
    ...page.querySelectorAll<HTMLButtonElement>('button[aria-label="Cancel invitation"]'),
  ].map((cancel) => {
    const group = cancel.closest('[role="group"]');
    return document.getElementById(group?.getAttribute("aria-labelledby") ?? "")?.textContent;
  });
  assert.deepEqual(named, ["sam@example.com", "ada@example.com"]);
});

test("Cancel invitation, drawn red, sends nothing while an invitation is on its way", async () => {
  invitations = [
    {
      id: "inv-sam",
      email: "sam@example.com",
      role: WORKSPACE_ROLE.MEMBER,
      expiresAt: "2026-10-16T12:00:00.000Z",
      acceptUrl: "https://vespin.dev/accept-invitation.html?id=inv-sam",
    },
  ];
  let release: () => void = () => undefined;
  inviteHeld = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  await invite(page, "alan@example.com", WORKSPACE_ROLE.MEMBER);
  const row = invitationRows(page)[0] ?? assert.fail("no pending invitation");
  const cancel =
    row.querySelector<HTMLButtonElement>('button[aria-label="Cancel invitation"]') ??
    assert.fail("no Cancel invitation");
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
  assert.equal(page.querySelector('[role="alert"]'), null);
});

test("Invite is drawn as the form's act, its primary button", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });
  const form =
    page.querySelector<HTMLFormElement>(".workspace-invite form") ?? assert.fail("no form");
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');

  assert.equal(submit?.textContent, "Invite");
});

test("an address already invited is said under the form, and a member is offered no invitations", async () => {
  refuseInvitation = true;
  const admin = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  await invite(admin.page, "sam@example.com", WORKSPACE_ROLE.MEMBER);
  const member = await mount(ACME);
  await settle();

  assert.equal(admin.page.querySelector('[role="alert"]')?.textContent, ALREADY_INVITED_REFUSAL);
  assert.deepEqual(invitationRows(admin.page), []);
  assert.equal(member.page.querySelector(".workspace-invite"), null);
  assert.equal(
    sent.filter((request) => request.kind === ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW).length,
    1,
    "a member holds no invitations",
  );
});

test("a row's menu left open on one workspace closes when another is listed in its place", async () => {
  const { page, relist } = await mount(ACME);
  act(() => ellipsisOn(memberNamed(page, "Sam")).click());
  const opened = document.querySelector('[role="menu"]:not([data-leaving])') !== null;

  await relist({
    ...CONNECTED,
    id: "workspace-beta",
    name: "Beta",
    github: { login: "beta", active: true },
    githubInstallations: [{ installationId: 21, login: "beta", active: true }],
  });

  assert.equal(opened, true);
  assert.equal(document.querySelector('[role="menu"]:not([data-leaving])'), null);
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
  act(() =>
    root.render(
      createElement(SettingsPage, {
        title: "Workspace",
        children: createElement(WorkspacePage, { control, readerId: READER_ID }),
      }),
    ),
  );

  assert.equal(
    container.querySelector('[role="alert"]')?.textContent,
    "Your workspaces could not be read.Retry",
  );
  assert.equal(busy(container), false);
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
      acceptUrl: "https://vespin.dev/accept-invitation.html?id=inv-sam",
    },
  ];
  refuseInvitationsRead = true;
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  assert.equal(
    [...page.querySelectorAll('[role="alert"]')].some(
      (each) => each.textContent === "The invitations could not be read.Retry",
    ),
    true,
  );
  refuseInvitationsRead = false;
  const retries = buttons(page, "Retry");
  assert.equal(retries.length, 1, "the members read, which landed, offers none");
  act(() => retries[0]?.click());
  await settle();

  assert.deepEqual(
    invitationRows(page).map((row) => addressOf(row)?.textContent),
    ["sam@example.com"],
  );
});

/** The workspace Sentry installs and disconnects sent, by their payloads. */
const sentrySent = () =>
  sent.flatMap((request) =>
    request.kind === ACT_KIND.WORKSPACE_SENTRY_INSTALL ||
    request.kind === ACT_KIND.WORKSPACE_SENTRY_DISCONNECT
      ? [[request.kind, request.payload]]
      : [],
  );

const SENTRY_INSTALLED: WorkspaceSentry = {
  configured: true,
  installations: [{ installationId: "installation-1", account: "acme" }],
};

/** The line a Sentry read that did not land draws in the row's place, with Retry. */
const sentryFailure = (page: HTMLElement) =>
  [...githubGroup(page).querySelectorAll('[role="alert"]')].find(
    (each) => each.textContent === "The workspace's Sentry could not be read.Retry",
  );

test("a Disconnect still being asked is dismissed once the read finds its installation gone", async () => {
  sentry = SENTRY_INSTALLED;
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  await chooseAction(rowNamed(githubGroup(page), "Sentry"), "Disconnect");
  const asked = document.querySelector('[role="alertdialog"]') !== null;
  sentry = { configured: true, installations: [] };
  act(() => layIntegrations(ACME.id));
  await settle();

  assert.equal(asked, true);
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.deepEqual(sentrySent(), []);
});

test("Integrations draws no Sentry row where the service holds no Sentry integration", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });

  assert.equal([...githubGroup(page).querySelectorAll(ROWS)].map(nameOf).includes("Sentry"), false);
  assert.equal(sentryFailure(page), undefined);
});

test("a Sentry read that failed says so with Retry, for a member too, and Retry reads it again", async () => {
  sentry = undefined;
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.MEMBER });
  const failed = sentryFailure(page) !== undefined;

  sentry = SENTRY_INSTALLED;
  const retry = sentryFailure(page)?.querySelector("button") ?? assert.fail("no Retry");
  act(() => retry.click());
  await settle();

  assert.equal(failed, true);
  assert.equal(sentryFailure(page), undefined);
  assert.deepEqual(rowWords(rowNamed(githubGroup(page), "Sentry")), [
    "Sentry",
    "Installed for automations · acme",
  ]);
});

test("an admin installs Sentry for the workspace from its row, which opens Sentry at once", async () => {
  sentry = { configured: true, installations: [] };
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });
  const row = rowNamed(githubGroup(page), "Sentry");
  const before = rowWords(row);

  act(() => button(row, "Install for workspace").click());
  await settle();

  assert.deepEqual(before, [
    "Sentry",
    "Not installed. Install to start automations from Sentry alerts.",
  ]);
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.deepEqual(sentrySent(), [[ACT_KIND.WORKSPACE_SENTRY_INSTALL, { workspaceId: ACME.id }]]);
});

test("an installed workspace's Sentry names its organization, its ⋯ holds Disconnect, which asks first, and a member sees it read only", async () => {
  sentry = SENTRY_INSTALLED;
  const admin = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });
  const row = rowNamed(githubGroup(admin.page), "Sentry");
  const words = rowWords(row);

  await chooseAction(row, "Disconnect");
  await confirm("Disconnect");
  const after = rowWords(rowNamed(githubGroup(admin.page), "Sentry"));
  for (const root of roots.splice(0)) act(() => root.unmount());
  sentry = SENTRY_INSTALLED;
  const member = await mount({ ...ACME, role: WORKSPACE_ROLE.MEMBER });
  const memberRow = rowNamed(githubGroup(member.page), "Sentry");

  assert.deepEqual(words, ["Sentry", "Installed for automations · acme"]);
  assert.deepEqual(sentrySent(), [
    [
      ACT_KIND.WORKSPACE_SENTRY_DISCONNECT,
      { workspaceId: ACME.id, installationId: "installation-1" },
    ],
  ]);
  assert.deepEqual(after, [
    "Sentry",
    "Not installed. Install to start automations from Sentry alerts.",
  ]);
  assert.deepEqual(rowWords(memberRow), ["Sentry", "Installed for automations · acme"]);
  assert.deepEqual(rowButtons(memberRow), []);
});

const SLACK_TEAM = { id: "T0001", name: "Acme Slack" };

test("an admin connects the Slack bot, which then names its team, and disconnects it after asking; a member sees it read only", async () => {
  slackBot = { configured: true };
  const admin = await mount({ ...ACME, role: WORKSPACE_ROLE.ADMIN });
  const before = rowWords(rowNamed(githubGroup(admin.page), "Slack bot"));

  act(() => button(rowNamed(githubGroup(admin.page), "Slack bot"), "Connect Slack bot").click());
  await settle();
  const connected = rowWords(rowNamed(githubGroup(admin.page), "Slack bot"));
  await chooseAction(rowNamed(githubGroup(admin.page), "Slack bot"), "Disconnect");
  await confirm("Disconnect");
  const after = rowWords(rowNamed(githubGroup(admin.page), "Slack bot"));
  for (const root of roots.splice(0)) act(() => root.unmount());
  slackBot = { configured: true, team: SLACK_TEAM };
  const member = await mount({ ...ACME, role: WORKSPACE_ROLE.MEMBER });
  const memberRow = rowNamed(githubGroup(member.page), "Slack bot");

  assert.deepEqual(before, [
    "Slack bot",
    "Not connected. Connect Vespin's bot to message members in Slack.",
  ]);
  assert.deepEqual(connected, ["Slack bot", "Connected to Acme Slack"]);
  assert.deepEqual(after, before);
  assert.deepEqual(rowWords(memberRow), ["Slack bot", "Connected to Acme Slack"]);
  assert.deepEqual(rowButtons(memberRow), []);
});

test("in the window, each member's ⋯ offers Copy link first, then opens their profile in the workspace the page shows", async () => {
  const opened: [string, string | undefined, string | undefined][] = [];
  const { page } = await mount(ACME, [], (userId, name, workspaceId) =>
    opened.push([userId, name, workspaceId]),
  );

  assert.deepEqual(rowActions(memberNamed(page, "Sam")), ["Copy link", "Open profile"]);
  await chooseAction(memberNamed(page, "Sam"), "Open profile");

  assert.deepEqual(opened, [[MEMBER.userId, "Sam", ACME.id]]);
});

test("each member's ⋯ holds Copy link, which copies that person's link under the workspace's slug, with or without a profile to open", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  const { page } = await mount(ACME);

  assert.deepEqual(rowActions(memberNamed(page, "Sam")), ["Copy link"]);
  await chooseAction(memberNamed(page, "Sam"), "Copy link");
  await settle();

  assert.deepEqual(copied, [`https://vespin.dev/acme/person/${MEMBER.userId}`]);
  assert.match(document.body.textContent ?? "", /Link copied/u);
});

/**
 * Presses Escape in `field` with the caret in it, and reports what the window's own
 * Escape would see: whether the press arrived marked taken, which it passes by.
 */
function escapeIn(field: HTMLInputElement): { taken: boolean } {
  const seen = { taken: false };
  const listen = (event: KeyboardEvent) => {
    seen.taken = event.defaultPrevented;
  };
  window.addEventListener("keydown", listen);
  act(() => field.focus());
  act(() => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  window.removeEventListener("keydown", listen);
  return seen;
}

test("Escape in the invite email field lets go of it, its words kept, and the window never takes it to leave Settings", async () => {
  const { page } = await mount({ ...ACME, role: WORKSPACE_ROLE.OWNER });
  const address =
    page.querySelector<HTMLInputElement>(".workspace-invite form input") ??
    assert.fail("no address field");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      address,
      "alan@example.com",
    );
    address.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const seen = escapeIn(address);

  assert.equal(seen.taken, true, "the window's Escape passes a taken press by");
  assert.notEqual(document.activeElement, address, "the caret is let go");
  assert.equal(address.value, "alan@example.com");
});
