// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskSummary } from "@luke/features/task-wire";
import type { TasksRepositoriesAnswer } from "@luke/features/tasks-view";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import type { SettingsLink } from "@luke/settings/settings-views";
import { repositoryLabel } from "@luke/ui/task-list-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { signedInAs } from "#testing/app-state";
import { onRegistry } from "#testing/copy-feedback";
import { focusByKeyboard, layWindowStyles, ringOf } from "#testing/focus-ring";
import { MemberDirectory } from "../member-directory";
import { OpenSettingsProvider } from "../open-settings";
import { OpenPersonProvider } from "../person-door";
import { TaskCrumb } from "./task-crumb";

/**
 * task-crumb.test.ts -- the line over a task's title says where the task
 * lives, "Acme › relay", and who can edit it, "3 can edit" or "Only you".
 * The workspace opens its home page, and the repository and who can edit
 * each hang their card and press nowhere. Synthetic throughout.
 */

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
  memberCount: 3,
};

/** Main's document with Sam, the reader, signed in. */
const SIGNED_IN_AS_SAM = signedInAs({
  id: "user-sam",
  email: "sam@example.com",
  name: "Sam Okafor",
});

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
const REPOSITORIES: TasksRepositoriesAnswer = {
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
  created?: Pick<TaskSummary, "createdBy" | "ownerId" | "createdAt">,
) {
  const links: SettingsLink[] = [];
  /** What the crumb's doors were asked, in order. */
  const asked: string[] = [];
  held = members;
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      onAppState: () => () => undefined,
      requestAppState: () => Promise.resolve(SIGNED_IN_AS_SAM),
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
            createElement(
              OpenPersonProvider,
              { value: (userId: string) => asked.push(`profile ${userId}`) },
              createElement(MemberDirectory, {
                workspace: shown,
                readerId: "user-sam",
                children: createElement(TaskCrumb, {
                  workspace: shown,
                  repository,
                  archived,
                  created,
                  doors: {
                    personal: false,
                    onOpenWorkspace: () => asked.push(`home ${shown.id}`),
                    repository: {
                      label: (named) => repositoryLabel(named, []),
                      pictures: false,
                      read: () => {
                        asked.push("read repositories");
                        return Promise.resolve(REPOSITORIES);
                      },
                    },
                  },
                }),
              }),
            ),
          ),
        ),
      ),
    );
    await settle();
  };
  await draw(workspace);
  const nav = () =>
    container.querySelector<HTMLElement>('nav[aria-label="Where this task is"]') ??
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

  assert.equal(nav.textContent, "AAcmerelayDSL3 can edit");
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

test("the workspace opens its home page rather than its Settings", async () => {
  const { nav, links, asked } = await crumb(ACME, "acme-corp/relay", MEMBERS);

  press(nav, "Acme");

  assert.deepEqual(asked, [`home ${ACME.id}`]);
  assert.deepEqual(links, []);
});

test("who can edit is no press: a click on the faces or the count opens nothing, Settings included", async () => {
  const { nav, links, asked } = await crumb(ACME, "acme-corp/relay", MEMBERS);
  const people =
    nav.querySelector<HTMLElement>(".task-crumb-people") ?? assert.fail("who can edit stands");

  act(() => people.click());
  act(() => people.querySelector<HTMLElement>(".actor-stack")?.click());

  assert.equal(people.textContent, "DSL3 can edit");
  assert.ok(people.closest("button, a") === null, "who can edit is no button and no link");
  assert.deepEqual(links, []);
  assert.deepEqual(asked, []);
});

test("who can edit takes the keyboard and hangs its card there, and Return or Space on it opens nothing", async () => {
  const { nav, links, asked } = await crumb(ACME, "acme-corp/relay", MEMBERS);
  const people =
    nav.querySelector<HTMLElement>(".task-crumb-people") ?? assert.fail("who can edit stands");

  const card = cardOf(people, "data-people-card");
  for (const key of ["Enter", " "]) {
    act(() => {
      people.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      people.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
    });
  }

  assert.equal(document.activeElement, people);
  assert.match(card.textContent ?? "", /Everyone in Acme/u);
  assert.deepEqual(links, []);
  assert.deepEqual(asked, []);
});

test("who can edit wears the window's own ring from the keyboard, not the engine's", async () => {
  const styles = await layWindowStyles();
  const { nav } = await crumb(ACME, "acme-corp/relay", MEMBERS);
  const people =
    nav.querySelector<HTMLElement>(".task-crumb-people") ?? assert.fail("who can edit stands");
  focusByKeyboard(people);
  assert.equal(ringOf(people)?.style, "solid");
  styles.remove();
});

test("the repository says its name alone, as the sidebar does, and is no press: it drops no menu", async () => {
  const { nav, asked } = await crumb(ACME, "acme-corp/relay", MEMBERS);
  const repository =
    nav.querySelector<HTMLElement>(".task-crumb-repository") ??
    assert.fail("the crumb names the repository");

  act(() => repository.click());

  assert.equal(repository.textContent, "relay");
  assert.equal(repository.closest("button"), null);
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.deepEqual(asked, []);
});

/** The card a control hangs as the keyboard reaches it, as it hangs under a resting pointer. */
function cardOf(control: HTMLElement, mark: string): HTMLElement {
  document.documentElement.dataset.keyboard = "true";
  act(() => control.focus());
  return hungCard(mark);
}

/** The card the newest tooltip hangs, by its mark. */
function hungCard(mark: string): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLElement>(`.luke-tooltip-card > [${mark}]`)].at(-1) ??
    assert.fail(`a control hangs its ${mark} card`)
  );
}

/** The card a control hangs under a resting pointer. */
function restedCard(control: HTMLElement, mark: string): HTMLElement {
  act(() => {
    control.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  return hungCard(mark);
}

test("the repository's card says the workspace's GitHub account it comes through and, once read, its default branch; the workspace's card says who shares it", async () => {
  const connected = { ...ACME, github: { login: "acme-corp", active: true } };
  const { nav, asked } = await crumb(connected, "acme-corp/relay", MEMBERS);
  const crumbed =
    nav.querySelector<HTMLElement>(".task-crumb-repository") ??
    assert.fail("the crumb names the repository");
  const workspace =
    nav.querySelector<HTMLElement>("button.task-crumb-item") ??
    assert.fail("the workspace is a press");

  const before = restedCard(crumbed, "data-repository-card").textContent;
  await settle();
  const repository = restedCard(crumbed, "data-repository-card");
  const team = cardOf(workspace, "data-workspace-card");

  assert.equal(before, "acme-corp/relayThrough acme-corp on GitHub · Acme");
  assert.equal(
    repository.textContent,
    "acme-corp/relayThrough acme-corp on GitHub · AcmeDefault branch trunk",
  );
  assert.equal(team.querySelector(".card-sub")?.textContent, "3 members");
  assert.deepEqual(asked, ["read repositories"]);
});

test("a plan moved to another workspace on the same repository reads its default branch again, through that workspace's GitHub", async () => {
  const connected = { ...ACME, github: { login: "acme-corp", active: true } };
  const stage = { ...connected, id: "workspace-stage", name: "Stage" };
  const page = await crumb(connected, "acme-corp/relay", MEMBERS);
  const crumbed = () =>
    page.current().querySelector<HTMLElement>(".task-crumb-repository") ??
    assert.fail("the crumb names the repository");

  restedCard(crumbed(), "data-repository-card");
  await settle();
  await page.redraw(stage);
  const moved = restedCard(crumbed(), "data-repository-card");
  await settle();

  assert.match(moved.textContent ?? "", /· Stage/u);
  assert.deepEqual(page.asked, ["read repositories", "read repositories"]);
});

test("a workspace whose members are counted nowhere and could not be read says nothing of who can edit, rather than only you", async () => {
  const { nav } = await crumb(UNCOUNTED, "acme-corp/relay", undefined);

  assert.equal(nav.textContent, "AAcmerelay");
});

test("an archived plan counts the workspace's members rather than who can edit it, until it is unarchived", async () => {
  const { nav } = await crumb(ACME, "acme-corp/relay", MEMBERS, true);

  assert.match(nav.textContent ?? "", /3 members$/u);
});

test("a member leaving, as the workspace's count says, reads the members again, so a former member's face goes", async () => {
  const page = await crumb(ACME, "acme-corp/relay", MEMBERS);

  held = MEMBERS.slice(0, 2);
  await page.redraw({ ...ACME, memberCount: 2 });

  assert.equal(page.current().textContent, "AAcmerelayDS2 can edit");
});

test("a member joining while the members read again fails leaves the new count standing alone, rather than the earlier faces as if nobody joined", async () => {
  const page = await crumb(ACME, "acme-corp/relay", MEMBERS);

  held = undefined;
  await page.redraw({ ...ACME, memberCount: 4 });

  assert.equal(page.current().textContent, "AAcmerelay4 can edit");
  assert.equal(page.current().querySelector(".actor-stack"), null);
});

test("the task's creator leads the faces and the people card, which says who created it and marks their row", async () => {
  const created = {
    createdBy: { userId: "user-lee", name: "Lee Park" },
    ownerId: "user-lee",
    createdAt: 1,
  };
  const { nav } = await crumb(ACME, "acme-corp/relay", MEMBERS, false, created);

  const faces = [...nav.querySelectorAll(".actor-stack .actor-mark")];
  assert.deepEqual(
    faces.map((face) => face.textContent),
    ["L", "D", "S"],
  );
  const people =
    nav.querySelector<HTMLElement>(".task-crumb-people") ?? assert.fail("who can edit");
  act(() => {
    people.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector("[data-people-card]") ?? assert.fail("the people card");
  assert.match(card.textContent ?? "", /Created by L Lee Park · /u);
  assert.deepEqual(
    [...card.querySelectorAll(".task-crumb-people-list li")].map(
      (row) =>
        `${row.querySelector(".task-crumb-person")?.textContent}: ${row.querySelector(".task-crumb-role")?.textContent}`,
    ),
    ["Lee Park: Creator · Member", "Dana Reyes: Owner", "Sam Okafor: Admin"],
  );
});

test("the reader's own task says it was created by you, and a task whose creator nobody names says nothing of it", async () => {
  const mine = {
    createdBy: { userId: "user-sam", name: "Sam Okafor" },
    ownerId: "user-sam",
    createdAt: 1,
  };
  const said = async (created?: Pick<TaskSummary, "createdBy" | "ownerId" | "createdAt">) => {
    const { nav } = await crumb(ACME, "acme-corp/relay", MEMBERS, false, created);
    const people =
      nav.querySelector<HTMLElement>(".task-crumb-people") ?? assert.fail("who can edit");
    act(() => {
      people.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    const card = document.querySelector("[data-people-card]") ?? assert.fail("the people card");
    const line = card.querySelector(".task-crumb-created")?.textContent ?? undefined;
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    return line?.replace(/ · .*$/u, "");
  };

  assert.equal(await said(mine), "Created by S you");
  assert.equal(await said(undefined), undefined);
});

test("a task the list names by its owner's id alone is the reader's own where that id is theirs, though the members could not be read", async () => {
  const { nav } = await crumb(ACME, "acme-corp/relay", undefined, false, {
    ownerId: "user-sam",
    createdAt: 1,
  });
  const people =
    nav.querySelector<HTMLElement>(".task-crumb-people") ?? assert.fail("who can edit");
  act(() => {
    people.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const line = document.querySelector("[data-people-card] .task-crumb-created")?.textContent;
  assert.equal(line?.replace(/ · .*$/u, ""), "Created by S you");
});

test("each member in the card of who can edit opens their page, while the faces and the count stay put", async () => {
  const { nav, asked } = await crumb(ACME, "acme-corp/relay", MEMBERS);
  const people =
    nav.querySelector<HTMLElement>(".task-crumb-people") ?? assert.fail("who can edit stands");
  const card = cardOf(people, "data-people-card");

  act(() => people.click());
  const rows = [...card.querySelectorAll<HTMLButtonElement>("button.task-crumb-person-row")];
  act(() => rows[1]?.click());

  assert.equal(rows.length, MEMBERS.length);
  assert.deepEqual(asked, [`profile ${MEMBERS[1]?.userId}`]);
});
