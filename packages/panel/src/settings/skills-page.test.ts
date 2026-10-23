// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  INSTALLED_SKILL_FILES_REFUSAL,
  INSTALLED_SKILL_PROBLEM,
  type InstalledSkillPreview,
  type InstalledSkillSummary,
} from "@luke/features/installed-skill-route-wire";
import { INSTALLED_SKILL_CALL_FAILURE } from "@luke/features/installed-skill-view";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@luke/features/installed-skill-wire";
import { SKILL_PASTE_KIND } from "@luke/features/skill-paste";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActKind } from "@luke/host/contract";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { ToastHost } from "../toast.js";
import { AddSkillDialog } from "./add-skill-dialog.js";
import { SkillsPage } from "./skills-page.js";

/**
 * Settings › Skills and its Add skill dialog over a host answering as the
 * service would: the workspace's skills stand before the account's own,
 * each with its source and who installed it; a member who is not an owner
 * or admin sees a workspace skill's switch unavailable and View alone in
 * its ⋯; a switch and Update send their acts and draw the answer; View
 * reads the skill's text and files; Share asks in plain words, moves the
 * skill into the workspace, and says a taken name in the question; Remove
 * asks first; and an install lights its rows and says how to call one. In
 * the dialog, a pasted command is previewed with its skills ticked
 * where it asked for them, a skill with problems never tickable; Install
 * sends the ticked ones; a refusal is said in words; text with no
 * description asks for one; and Everyone in the workspace is offered to
 * every member, never in a personal workspace. Synthetic names and ids.
 */

const READER = "user-ada";
const SHA = "3f9c2e1aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5";
const COMMAND = "npx skills add vercel-labs/agent-skills --skill web-design-guidelines";
const TEXT = "# PR style\n\nLead with the user-visible change.";

function skill(
  name: string,
  scope: InstalledSkillSummary["scope"],
  extra: Partial<InstalledSkillSummary> = {},
): InstalledSkillSummary {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    scope,
    name,
    description: `${name} described`,
    userInvocable: true,
    source: { type: INSTALLED_SKILL_SOURCE.TEXT },
    enabled: true,
    installedBy: READER,
    manageable: true,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

const RELEASE_NOTES = skill("release-notes", INSTALLED_SKILL_SCOPE.WORKSPACE, {
  id: "11111111-1111-4111-8111-111111111111",
  installedBy: "user-dean",
  source: {
    type: INSTALLED_SKILL_SOURCE.GITHUB,
    owner: "acme",
    repo: "agent-skills",
    path: "skills/release-notes",
    ref: "main",
    sha: SHA,
  },
});
const PR_STYLE = skill("pr-style", INSTALLED_SKILL_SCOPE.PERSONAL, {
  id: "22222222-2222-4222-8222-222222222222",
});

const SOURCE: InstalledSkillPreview = {
  kind: SKILL_PASTE_KIND.SOURCE,
  owner: "vercel-labs",
  repo: "agent-skills",
  ref: "main",
  sha: SHA,
  missing: [],
  skills: [
    {
      name: "web-design-guidelines",
      path: "skills/web",
      fileCount: 4,
      bytes: 22_000,
      selected: true,
      problems: [],
    },
    {
      name: "react-best-practices",
      path: "skills/react",
      fileCount: 1,
      bytes: 900,
      selected: false,
      problems: [],
    },
    {
      name: "leaky",
      path: "skills/leaky",
      fileCount: 1,
      bytes: 300,
      selected: false,
      problems: [INSTALLED_SKILL_PROBLEM.CREDENTIAL_SHAPED],
    },
  ],
};

const TEXT_PREVIEW: InstalledSkillPreview = {
  kind: SKILL_PASTE_KIND.TEXT,
  name: "pr-style",
  bytes: 48,
  problems: [INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING],
};

/** The skills the test's service holds. */
let stored: InstalledSkillSummary[] = [];
/** Every act the page sent, in order. */
let sent: { kind: PortActKind; payload: unknown }[] = [];
/** Whether the next install is refused, for a credential in the named skill. */
let refuseInstall = false;
/** The names the next source preview says no folder holds. */
let missingNames: string[] = [];
/** Whether the workspace already holds a skill of the shared one's name. */
let nameTaken = false;

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  stored = [RELEASE_NOTES, PR_STYLE];
  sent = [];
  refuseInstall = false;
  missingNames = [];
  nameTaken = false;
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () =>
      Promise.resolve([
        {
          userId: "user-dean",
          name: "Dean",
          email: "dean@example.com",
          role: WORKSPACE_ROLE.ADMIN,
        },
      ]),
    [ACT_KIND.INSTALLED_SKILLS_LIST]: (payload) => {
      sent.push({ kind: ACT_KIND.INSTALLED_SKILLS_LIST, payload });
      return Promise.resolve({ skills: stored });
    },
    [ACT_KIND.INSTALLED_SKILLS_CHECK_UPDATE]: (payload) => {
      sent.push({ kind: ACT_KIND.INSTALLED_SKILLS_CHECK_UPDATE, payload });
      return Promise.resolve({ available: true, latestSha: "b".repeat(40) });
    },
    [ACT_KIND.INSTALLED_SKILLS_SET_ENABLED]: (payload) => {
      sent.push({ kind: ACT_KIND.INSTALLED_SKILLS_SET_ENABLED, payload });
      const changed = stored.find((each) => each.id === payload.skillId) ?? assert.fail("no skill");
      return Promise.resolve({ skill: { ...changed, enabled: payload.enabled } });
    },
    [ACT_KIND.INSTALLED_SKILLS_UPDATE]: (payload) => {
      sent.push({ kind: ACT_KIND.INSTALLED_SKILLS_UPDATE, payload });
      return Promise.resolve({ skill: RELEASE_NOTES, changed: true });
    },
    [ACT_KIND.INSTALLED_SKILLS_READ]: (payload) => {
      sent.push({ kind: ACT_KIND.INSTALLED_SKILLS_READ, payload });
      return Promise.resolve({
        id: payload.skillId,
        skillFile: "---\nname: pr-style\n---\n# PR style",
        files: [
          { path: "SKILL.md", bytes: 48 },
          { path: "examples/good.md", bytes: 2_048 },
        ],
      });
    },
    [ACT_KIND.INSTALLED_SKILLS_SHARE]: (payload) => {
      sent.push({ kind: ACT_KIND.INSTALLED_SKILLS_SHARE, payload });
      if (nameTaken) return Promise.resolve({ failure: INSTALLED_SKILL_CALL_FAILURE.NAME_TAKEN });
      const shared = stored.find((each) => each.id === payload.skillId) ?? assert.fail("no skill");
      return Promise.resolve({ skill: { ...shared, scope: INSTALLED_SKILL_SCOPE.WORKSPACE } });
    },
    [ACT_KIND.INSTALLED_SKILLS_REMOVE]: (payload) => {
      sent.push({ kind: ACT_KIND.INSTALLED_SKILLS_REMOVE, payload });
      stored = stored.filter((each) => each.id !== payload.skillId);
      return Promise.resolve({ id: payload.skillId });
    },
    [ACT_KIND.INSTALLED_SKILLS_PREVIEW]: (payload) => {
      sent.push({ kind: ACT_KIND.INSTALLED_SKILLS_PREVIEW, payload });
      return Promise.resolve(
        payload.text.startsWith("npx") ? { ...SOURCE, missing: missingNames } : TEXT_PREVIEW,
      );
    },
    [ACT_KIND.INSTALLED_SKILLS_INSTALL]: (payload) => {
      sent.push({ kind: ACT_KIND.INSTALLED_SKILLS_INSTALL, payload });
      if (refuseInstall) {
        return Promise.resolve({
          failure: INSTALLED_SKILL_CALL_FAILURE.FILES_REFUSED,
          skillName: "web-design-guidelines",
          skillRefusal: INSTALLED_SKILL_FILES_REFUSAL.TOO_MANY_FILES,
        });
      }
      return Promise.resolve({
        skills: (payload.skills ?? ["web-design-guidelines"]).map((name, at) =>
          skill(name, payload.scope, { id: `33333333-3333-4333-8333-33333333333${at}` }),
        ),
      });
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

function workspace(extra: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace-stage",
    name: "Stage",
    role: WORKSPACE_ROLE.OWNER,
    github: null,
    ...extra,
  };
}

function mount(element: React.ReactElement): void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
}

async function mountPage(shown = workspace()): Promise<void> {
  mount(
    createElement(
      Fragment,
      null,
      createElement(SkillsPage, {
        control: {
          workspaces: [shown],
          workspaceId: shown.id,
          onLeft: () => undefined,
          listFailed: false,
          onRetryList: () => undefined,
        },
        readerId: READER,
        pause: () => Promise.resolve(),
      }),
      createElement(ToastHost),
    ),
  );
  await settle();
}

async function mountDialog(shown = workspace()): Promise<InstalledSkillSummary[]> {
  const installed: InstalledSkillSummary[] = [];
  mount(
    createElement(AddSkillDialog, {
      workspace: shown,
      onInstalled: (made) => installed.push(...made),
      onClose: () => undefined,
      pause: () => Promise.resolve(),
    }),
  );
  await settle();
  return installed;
}

const button = (words: string, within: ParentNode = document) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === words,
  ) ?? assert.fail(`no ${words} button`);

const switchOf = (name: string) =>
  document.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="Use ${name}"]`) ??
  assert.fail(`no switch for ${name}`);

const checkboxOf = (name: string) =>
  [...document.querySelectorAll<HTMLLabelElement>("label")]
    .find((each) => each.textContent?.startsWith(name))
    ?.querySelector<HTMLInputElement>('input[type="checkbox"]') ??
  assert.fail(`no box for ${name}`);

function typeInto(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  act(() => {
    // Note that the value goes through the element's own setter, as typing does, so React hears it.
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function paste(text: string): Promise<void> {
  typeInto(document.querySelector("textarea") ?? assert.fail("no box"), text);
  await settle();
}

/** The row a skill's name labels. */
const rowOf = (name: string) =>
  [...document.querySelectorAll<HTMLElement>(".luke-settings-row")].find(
    (each) => each.querySelector(".luke-settings-row-label")?.textContent === name,
  ) ?? assert.fail(`no row for ${name}`);

/** The ⋯ of a skill's row, none where it draws none. */
const moreOf = (name: string) =>
  rowOf(name).querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');

/** What a skill's ⋯ offers, opened and closed again. */
function menuOf(name: string): (string | null)[] {
  const more = moreOf(name) ?? assert.fail(`no ⋯ for ${name}`);
  act(() => more.click());
  const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
  act(() => more.click());
  return items;
}

/** Chooses `words` in a skill's ⋯, and lets what it asked settle. */
async function choose(name: string, words: string): Promise<void> {
  const more = moreOf(name) ?? assert.fail(`no ⋯ for ${name}`);
  act(() => more.click());
  act(() =>
    (
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === words,
      ) ?? assert.fail(`no ${words} in the ⋯`)
    ).click(),
  );
  await settle();
}

/** The dialog standing over the page. */
const dialog = (role = "dialog") =>
  document.querySelector<HTMLElement>(`[role="${role}"]`) ?? assert.fail(`no ${role}`);

const sentOf = (kind: PortActKind) =>
  sent.filter((each) => each.kind === kind).map((each) => each.payload);

test("the workspace's skills stand before the account's own, each with its source and who installed it", async () => {
  await mountPage();

  const headings = [...document.querySelectorAll("h2")].map((each) => each.textContent);
  assert.deepEqual(headings, ["Stage", "Personal"]);
  const text = document.body.textContent ?? "";
  assert.match(text, /release-notesWorkspace/u);
  assert.match(text, /release-notes described · acme\/agent-skills @ 3f9c2e1 · by Dean/u);
  assert.match(text, /pr-stylePersonal/u);
  assert.match(text, /pr-style described · pasted/u);
  assert.match(text, /\.agents\/skills.*only agents started afterwards/u);
});

test("a GitHub skill whose folder moved offers Update in its ⋯, which updates it and goes", async () => {
  await mountPage();

  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_CHECK_UPDATE), [
    { workspaceId: "workspace-stage", skillId: RELEASE_NOTES.id },
  ]);
  assert.deepEqual(menuOf("release-notes"), ["View", "Update", "Remove"]);
  await choose("release-notes", "Update");
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_UPDATE), [
    { workspaceId: "workspace-stage", skillId: RELEASE_NOTES.id },
  ]);
  assert.deepEqual(menuOf("release-notes"), ["View", "Remove"]);
});

test("the account's own skill offers Share with workspace, which asks in plain words and moves it there", async () => {
  await mountPage();

  assert.deepEqual(menuOf("pr-style"), ["View", "Share with workspace", "Remove"]);
  await choose("pr-style", "Share with workspace");
  const question = dialog("alertdialog");
  assert.match(question.textContent ?? "", /Share pr-style with Stage\?/u);
  assert.match(
    question.textContent ?? "",
    /Everyone in Stage will get pr-style\. It leaves your personal skills\./u,
  );
  act(() => button("Share", question).click());
  await settle();

  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_SHARE), [
    { workspaceId: "workspace-stage", skillId: PR_STYLE.id },
  ]);
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  const [, shared, personal] = [...document.querySelectorAll("section")];
  assert.match(shared?.textContent ?? "", /pr-styleWorkspace/u);
  assert.match(personal?.textContent ?? "", /No skills installed yet\./u);
});

test("a share the workspace already has the name for is refused in the question, and the skill stays the account's own", async () => {
  nameTaken = true;
  await mountPage();

  await choose("pr-style", "Share with workspace");
  act(() => button("Share", dialog("alertdialog")).click());
  await settle();

  assert.match(
    dialog("alertdialog").textContent ?? "",
    /Stage already has a skill named pr-style\. Remove one of them first\./u,
  );
  assert.match(rowOf("pr-style").textContent ?? "", /pr-stylePersonal/u);
});

test("Share is never offered in a personal workspace", async () => {
  stored = [PR_STYLE];
  await mountPage(workspace({ personal: true }));

  assert.deepEqual(menuOf("pr-style"), ["View", "Remove"]);
});

test("View reads the skill and draws its text as written and every file with its size", async () => {
  await mountPage();

  await choose("pr-style", "View");
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_READ), [{ skillId: PR_STYLE.id }]);
  const shown = dialog();
  assert.equal(shown.querySelector("h2")?.textContent, "pr-style");
  assert.match(shown.querySelector("pre")?.textContent ?? "", /name: pr-style[\s\S]*# PR style/u);
  assert.deepEqual(
    [...shown.querySelectorAll("dt, dd")].map((each) => each.textContent),
    ["SKILL.md", "48 B", "examples/good.md", "2.0 KB"],
  );
  act(() => button("Close", shown).click());
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test("Remove asks first, then takes the skill off the page", async () => {
  await mountPage();

  await choose("pr-style", "Remove");
  act(() => button("Remove", dialog("alertdialog")).click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_REMOVE), [{ skillId: PR_STYLE.id }]);
  assert.ok(!(document.body.textContent ?? "").includes("pr-style described"));
});

test("an install lights its own rows once and says which skills and how to call one", async () => {
  await mountPage();

  act(() => button("Add skill").click());
  await paste(COMMAND);
  act(() => checkboxOf("react-best-practices").click());
  act(() => button("Install").click());
  await settle();

  const lit = [...document.querySelectorAll(".luke-settings-row[data-landed]")].map(
    (each) => each.querySelector(".luke-settings-row-label")?.textContent,
  );
  assert.deepEqual(lit, ["react-best-practices", "web-design-guidelines"]);
  const toast = document.querySelector('[aria-label="Notifications"]')?.textContent ?? "";
  assert.match(toast, /Installed web-design-guidelines and react-best-practices/u);
  assert.match(toast, /Type \/web-design-guidelines in any new agent/u);
});

test("a switch turns its skill off and draws the service's answer", async () => {
  await mountPage();

  act(() => switchOf("pr-style").click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_SET_ENABLED), [
    { skillId: PR_STYLE.id, enabled: false },
  ]);
  assert.equal(switchOf("pr-style").getAttribute("aria-checked"), "false");
});

test("a workspace skill a member may not change draws its switch unavailable and View alone in its ⋯, and asks no update", async () => {
  stored = [{ ...RELEASE_NOTES, manageable: false }, PR_STYLE];
  await mountPage(workspace({ role: WORKSPACE_ROLE.MEMBER }));

  assert.equal(switchOf("release-notes").disabled, true);
  assert.equal(switchOf("pr-style").disabled, false);
  assert.deepEqual(menuOf("release-notes"), ["View"]);
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_CHECK_UPDATE), []);
});

test("a personal workspace lists the account's own skills alone", async () => {
  stored = [PR_STYLE];
  await mountPage(workspace({ personal: true }));

  assert.deepEqual(
    [...document.querySelectorAll("h2")].map((each) => each.textContent),
    ["Personal"],
  );
});

test("a pasted command is previewed with the skills it asked for ticked, one with problems never tickable, and Install sends the ticked ones", async () => {
  const installed = await mountDialog();
  await paste(COMMAND);

  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_PREVIEW), [
    { workspaceId: "workspace-stage", text: COMMAND },
  ]);
  assert.match(
    document.body.textContent ?? "",
    /Detected: 3 skills in vercel-labs\/agent-skills @ 3f9c2e1/u,
  );
  assert.equal(checkboxOf("web-design-guidelines").checked, true);
  assert.equal(checkboxOf("react-best-practices").checked, false);
  assert.equal(checkboxOf("leaky").disabled, true);
  assert.match(document.body.textContent ?? "", /Holds what looks like a credential/u);

  act(() => checkboxOf("react-best-practices").click());
  act(() => button("Install").click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_INSTALL), [
    {
      text: COMMAND,
      workspaceId: "workspace-stage",
      scope: INSTALLED_SKILL_SCOPE.PERSONAL,
      skills: ["web-design-guidelines", "react-best-practices"],
    },
  ]);
  assert.deepEqual(
    installed.map((each) => each.name),
    ["web-design-guidelines", "react-best-practices"],
  );
});

test("only the found skills and the names missing among them scroll: the box, its line, and Install for stay on the card however many either holds", async () => {
  missingNames = Array.from({ length: 40 }, (_, at) => `absent-${at}`);
  await mountDialog();
  await paste(COMMAND);

  const scrolled = (element: Element | null | undefined) =>
    (element ?? assert.fail("not drawn")).closest(".luke-scroll-area") !== null;
  assert.equal(scrolled(document.querySelector('[aria-label="Skills found"]')), true);
  assert.equal(scrolled(checkboxOf("web-design-guidelines")), true);
  assert.equal(scrolled(document.querySelector("textarea")), false);
  const lines = [...document.querySelectorAll('[role="status"], .settings-state')];
  assert.equal(scrolled(lines.find((each) => each.textContent?.startsWith("Detected:"))), false);
  assert.equal(
    scrolled(lines.find((each) => each.textContent?.startsWith("Not in the repository: absent-0"))),
    true,
  );
  assert.equal(scrolled(button("Everyone in Stage")), false);
  assert.equal(scrolled(button("Install")), false);
});

test("a refused install says which skill and why in words, keeps the dialog, and marks that skill so it can no longer be ticked", async () => {
  refuseInstall = true;
  await mountDialog();
  await paste(COMMAND);

  act(() => button("Install").click());
  await settle();
  assert.match(
    document.body.textContent ?? "",
    /web-design-guidelines holds more than 64 files\./u,
  );
  assert.ok(document.querySelector("textarea"));
  assert.equal(checkboxOf("web-design-guidelines").disabled, true);
  assert.equal(checkboxOf("web-design-guidelines").checked, false);
  assert.equal(button("Install").disabled, true);
});

test("text with no description asks for one before Install, and sends it", async () => {
  await mountDialog();
  await paste(TEXT);

  assert.match(document.body.textContent ?? "", /Detected: skill text · pr-style/u);
  assert.equal(button("Install").disabled, true);
  const description =
    [...document.querySelectorAll<HTMLInputElement>("input")].find(
      (each) => each.labels?.[0]?.textContent === "Description",
    ) ?? assert.fail("no description field");
  typeInto(description, "How PRs read here.");
  act(() => button("Install").click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_INSTALL), [
    {
      text: TEXT,
      workspaceId: "workspace-stage",
      scope: INSTALLED_SKILL_SCOPE.PERSONAL,
      description: "How PRs read here.",
    },
  ]);
});

test("a source on another host says only GitHub for now and asks the service nothing", async () => {
  await mountDialog();
  await paste("npx skills add https://gitlab.com/acme/skills");

  assert.match(document.body.textContent ?? "", /Only GitHub sources for now\./u);
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_PREVIEW), []);
});

test("Everyone in the workspace is offered to a member and installs there, and not in a personal workspace", async () => {
  await mountDialog(workspace({ role: WORKSPACE_ROLE.MEMBER }));
  await paste(COMMAND);
  act(() => button("Everyone in Stage").click());
  act(() => button("Install").click());
  await settle();
  assert.equal(
    (sentOf(ACT_KIND.INSTALLED_SKILLS_INSTALL)[0] as { scope: string } | undefined)?.scope,
    INSTALLED_SKILL_SCOPE.WORKSPACE,
  );

  for (const root of roots.splice(0)) act(() => root.unmount());
  await mountDialog(workspace({ personal: true }));
  assert.ok(!(document.body.textContent ?? "").includes("Everyone in Stage"));
});

test("a description typed for one paste is never sent with the next", async () => {
  await mountDialog();
  await paste(TEXT);
  const description = () =>
    [...document.querySelectorAll<HTMLInputElement>("input")].find(
      (each) => each.labels?.[0]?.textContent === "Description",
    ) ?? assert.fail("no description field");
  typeInto(description(), "How PRs read here.");

  await paste("# Review style\n\nAsk for tests.");
  assert.equal(description().value, "");
  assert.equal(button("Install").disabled, true);
});
