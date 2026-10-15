// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { onRegistry } from "#testing/copy-feedback";
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

/** The crumb drawn over a service answering the members read with `members`, or refusing it; every Settings link it opened. */
async function crumb(
  workspace: Workspace,
  repository: string | null,
  members: readonly WorkspaceMember[] | undefined,
): Promise<{ nav: HTMLElement; links: SettingsLink[] }> {
  const links: SettingsLink[] = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      act: (request: Act): Promise<ActOutcome> =>
        Promise.resolve(
          request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ && members !== undefined
            ? { status: ACT_OUTCOME_STATUS.DONE, value: members }
            : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Could not read." },
        ),
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          OpenSettingsProvider,
          { value: (link: SettingsLink) => links.push(link) },
          createElement(PlanCrumb, { workspace, repository }),
        ),
      ),
    ),
  );
  await settle();
  const nav =
    container.querySelector<HTMLElement>('nav[aria-label="Where this plan is"]') ??
    assert.fail("the crumb stands");
  return { nav, links };
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
  assert.equal(nav.querySelectorAll(".plan-crumb-faces .sidebar-avatar").length, 3);
});

test("a plan in a workspace of one says only you can edit it, and a plan with no repository names its workspace alone", async () => {
  const { nav } = await crumb({ ...ACME, memberCount: 1 }, null, [MEMBERS[0]!]);

  assert.equal(nav.textContent, "AAcmeOnly you");
});

test("members that could not be read leave the workspace's own count standing, with no faces", async () => {
  const { nav } = await crumb(ACME, "acme-corp/relay", undefined);

  assert.match(nav.textContent ?? "", /3 can edit$/u);
  assert.equal(nav.querySelector(".plan-crumb-faces"), null);
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
