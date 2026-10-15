// @vitest-environment jsdom

import assert from "node:assert/strict";
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
 * lives, "Acme › relay", and who can edit it, "3 can edit" or "Only you",
 * and its presses open that workspace's Settings. Synthetic throughout.
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

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
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
              children: createElement(PlanCrumb, { workspace: shown, repository, archived }),
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
  return { nav: nav(), links, redraw: draw, current: nav };
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

test("the workspace opens its Settings page, and who can edit opens its members", async () => {
  const { nav, links } = await crumb(ACME, "acme-corp/relay", MEMBERS);

  press(nav, "Acme");
  press(nav, "can edit");

  assert.deepEqual(links, [
    { page: SETTINGS_VIEW.WORKSPACE, workspaceId: ACME.id },
    { page: SETTINGS_VIEW.WORKSPACE, workspaceId: ACME.id, section: SETTINGS_SECTION.MEMBERS },
  ]);
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
