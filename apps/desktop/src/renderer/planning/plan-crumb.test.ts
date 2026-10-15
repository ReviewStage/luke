// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { PlanningRepositoriesAnswer } from "@luke/features/planning-view";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { MemberDirectory } from "../member-directory";
import { OpenSettingsProvider } from "../open-settings";
import { PlanCrumb } from "./plan-crumb";

/**
 * plan-crumb.test.ts -- the line over a plan's title says where the plan
 * lives, "Acme › acme-corp/relay", and who can edit it, "3 can edit" or
 * "Only you". The workspace opens its home page, the repository's chip
 * drops its menu and hangs its card, and who can edit opens the workspace's
 * members in Settings. Synthetic throughout.
 */

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
  memberCount: 3,
};

/** Acme as a service that counts no members answers it. */
const { memberCount: _uncounted, ...UNCOUNTED } = ACME;

const MEMBERS: readonly WorkspaceMember[] = [
  {
    userId: "user-dana",
    name: "Dana Reyes",
    email: "dana@example.com",
    role: WORKSPACE_ROLE.OWNER,
  },
  { userId: "user-sam", name: "Sam Okafor", email: "sam@example.com", role: WORKSPACE_ROLE.ADMIN },
  { userId: "user-lee", name: "Lee Park", email: "lee@example.com", role: WORKSPACE_ROLE.MEMBER },
];

/** The repositories Acme's GitHub reaches, as the service answers them. */
const REPOSITORIES: PlanningRepositoriesAnswer = {
  repositories: {
    installed: true,
    installationUrl: "https://github.com/apps/luke/installations/new",
    repositories: [
      {
        owner: "acme-corp",
        name: "relay",
        fullName: "acme-corp/relay",
        defaultBranch: "trunk",
        private: true,
        updatedAt: 1,
      },
    ],
  },
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  delete document.documentElement.dataset.keyboard;
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The service's answer to the members read: the members it holds, or a refusal. */
let held: readonly WorkspaceMember[] | undefined;

/**
 * The crumb drawn over a service answering the members read with `members`,
 * or refusing it; every Settings link it opened, and a way to draw it again
 * over the workspace as a later read of the workspaces answers it.
 */
async function crumb(
  workspace: Workspace,
  repository: string | null,
  members: readonly WorkspaceMember[] | undefined,
  archived = false,
) {
  const links: SettingsLink[] = [];
  /** What the crumb's doors were asked, in order. */
  const asked: string[] = [];
  held = members;
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      act: (request: Act): Promise<ActOutcome> =>
        Promise.resolve(
          request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ && held !== undefined
            ? { status: ACT_OUTCOME_STATUS.DONE, value: held }
            : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Could not read." },
        ),
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const registry = AtomRegistry.make();
  const draw = async (shown: Workspace) => {
    act(() =>
      root?.render(
        onRegistry(
          registry,
          createElement(
            OpenSettingsProvider,
            { value: (link: SettingsLink) => links.push(link) },
            createElement(MemberDirectory, {
              workspace: shown,
              readerId: "user-sam",
              children: createElement(PlanCrumb, {
                workspace: shown,
                repository,
                archived,
                doors: {
                  personal: false,
                  onOpenWorkspace: () => asked.push(`home ${shown.id}`),
                  repository: {
                    pictures: false,
                    read: () => {
                      asked.push("read repositories");
                      return Promise.resolve(REPOSITORIES);
                    },
                    onOpenGitHub: () => asked.push("open on GitHub"),
                    onNewPlanIn: (named) => asked.push(`new plan in ${named}`),
                    onChange: archived ? undefined : () => asked.push("change repository"),
                  },
                },
              }),
            }),
          ),
        ),
      ),
    );
    await settle();
  };
  await draw(workspace);
  const nav = () =>
    container.querySelector<HTMLElement>('nav[aria-label="Where this plan is"]') ??
    assert.fail("the crumb stands");
  return { nav: nav(), links, asked, redraw: draw, current: nav };
}

/** The crumb's presses by their words. */
function press(nav: HTMLElement, words: string): void {
  const button =
    [...nav.querySelectorAll("button")].find((each) => each.textContent?.endsWith(words)) ??
    assert.fail(`${words} is a press`);
  act(() => button.click());
}

test("the crumb names the plan's workspace and repository, and how many can edit it, a face for each", async () => {
  const { nav } = await crumb(ACME, "acme-corp/relay", MEMBERS);

  assert.equal(nav.textContent, "AAcmeacme-corp/relayDSL3 can edit");
  assert.equal(nav.querySelectorAll(".actor-stack .actor-mark").length, 3);
});

test("a member's face is their sign-in picture where the members read lists one, and their letter where it lists none", async () => {
  const picture = "https://lh3.googleusercontent.com/a/dana=s96-c";
  const pictured = MEMBERS.map((member) =>
    member.userId === "user-dana" ? { ...member, pictureUrl: picture } : member,
  );
  const { nav } = await crumb(ACME, "acme-corp/relay", pictured);

  const faces = [...nav.querySelectorAll(".actor-stack .actor-mark")];
  assert.deepEqual(
    faces.map((face) => face.querySelector("img")?.src ?? face.textContent),
    [picture, "S", "L"],
  );
});

test("a plan in a workspace of one says only you can edit it, and a plan with no repository names its workspace alone", async () => {
  const { nav } = await crumb({ ...ACME, memberCount: 1 }, null, [MEMBERS[0]!]);

  assert.equal(nav.textContent, "AAcmeOnly you");
});

test("members that could not be read leave the workspace's own count standing, with no faces", async () => {
  const { nav } = await crumb(ACME, "acme-corp/relay", undefined);

  assert.match(nav.textContent ?? "", /3 can edit$/u);
  assert.equal(nav.querySelector(".actor-stack"), null);
});

test("the workspace opens its home page rather than its Settings, and who can edit opens its members", async () => {
  const { nav, links, asked } = await crumb(ACME, "acme-corp/relay", MEMBERS);

  press(nav, "Acme");
  press(nav, "can edit");

  assert.deepEqual(asked, [`home ${ACME.id}`]);
  assert.deepEqual(links, [
    { page: SETTINGS_VIEW.WORKSPACE, workspaceId: ACME.id, section: SETTINGS_SECTION.MEMBERS },
  ]);
});

/** The menu standing open, by its items' words. */
function menuItems(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')];
}

test("the repository is a chip whose press drops Open on GitHub, New plan in this repository, and Change repository, each doing what it says", async () => {
  const { nav, asked } = await crumb(ACME, "acme-corp/relay", MEMBERS);
  const chip =
    nav.querySelector<HTMLButtonElement>(".plan-crumb-repository") ??
    assert.fail("the repository is a chip");

  assert.equal(chip.textContent, "acme-corp/relay");
  for (const words of ["Open on GitHub", "New plan in this repository", "Change repository"]) {
    act(() => chip.click());
    const item =
      menuItems().find((each) => each.textContent === words) ??
      assert.fail(`the menu offers ${words}`);
    act(() => item.click());
  }

  assert.deepEqual(asked, ["open on GitHub", "new plan in acme-corp/relay", "change repository"]);
});

/** The card a control hangs as the keyboard reaches it, as it hangs under a resting pointer. */
function cardOf(control: HTMLElement, mark: string): HTMLElement {
  document.documentElement.dataset.keyboard = "true";
  act(() => control.focus());
  return (
    [...document.querySelectorAll<HTMLElement>(`.tooltip-card > [${mark}]`)].at(-1) ??
    assert.fail(`the control hangs its ${mark} card`)
  );
}

test("the repository's card says the workspace's GitHub account it comes through and, once read, its default branch; the workspace's card says who shares it", async () => {
  const connected = { ...ACME, github: { login: "acme-corp", active: true } };
  const { nav, asked } = await crumb(connected, "acme-corp/relay", MEMBERS);
  const chip =
    nav.querySelector<HTMLElement>(".plan-crumb-repository") ??
    assert.fail("the repository is a chip");
  const workspace =
    nav.querySelector<HTMLElement>("button.plan-crumb-item") ??
    assert.fail("the workspace is a press");

  const before = cardOf(chip, "data-repository-card").textContent;
  await settle();
  const repository = cardOf(chip, "data-repository-card");
  const team = cardOf(workspace, "data-workspace-card");

  assert.equal(before, "acme-corp/relayThrough acme-corp on GitHub · Acme");
  assert.equal(
    repository.textContent,
    "acme-corp/relayThrough acme-corp on GitHub · AcmeDefault branch trunk",
  );
  assert.equal(team.querySelector(".card-sub")?.textContent, "3 members");
  assert.deepEqual(asked, ["read repositories"]);
});

test("an archived plan's repository menu offers no Change repository", async () => {
  const { nav } = await crumb(ACME, "acme-corp/relay", MEMBERS, true);
  const chip =
    nav.querySelector<HTMLButtonElement>(".plan-crumb-repository") ??
    assert.fail("the repository is a chip");
  act(() => chip.click());

  assert.deepEqual(
    menuItems().map((item) => item.textContent),
    ["Open on GitHub", "New plan in this repository"],
  );
});

test("a workspace whose members are counted nowhere and could not be read says nothing of who can edit, rather than only you", async () => {
  const { nav } = await crumb(UNCOUNTED, "acme-corp/relay", undefined);

  assert.equal(nav.textContent, "AAcmeacme-corp/relay");
});

test("an archived plan counts the workspace's members rather than who can edit it, until it is unarchived", async () => {
  const { nav } = await crumb(ACME, "acme-corp/relay", MEMBERS, true);

  assert.match(nav.textContent ?? "", /3 members$/u);
});

test("a member leaving, as the workspace's count says, reads the members again, so a former member's face goes", async () => {
  const page = await crumb(ACME, "acme-corp/relay", MEMBERS);

  held = MEMBERS.slice(0, 2);
  await page.redraw({ ...ACME, memberCount: 2 });

  assert.equal(page.current().textContent, "AAcmeacme-corp/relayDS2 can edit");
});

test("a member joining while the members read again fails leaves the new count standing alone, rather than the earlier faces as if nobody joined", async () => {
  const page = await crumb(ACME, "acme-corp/relay", MEMBERS);

  held = undefined;
  await page.redraw({ ...ACME, memberCount: 4 });

  assert.equal(page.current().textContent, "AAcmeacme-corp/relay4 can edit");
  assert.equal(page.current().querySelector(".actor-stack"), null);
});
