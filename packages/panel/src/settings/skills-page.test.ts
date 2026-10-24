// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  INSTALLED_SKILL_FILES_REFUSAL,
  INSTALLED_SKILL_PROBLEM,
  INSTALLED_SKILL_STANDING,
  type InstalledSkillPreview,
  type InstalledSkillSummary,
  SKILL_AUDIT_RISK,
} from "@luke/features/installed-skill-route-wire";
import { INSTALLED_SKILL_CALL_FAILURE } from "@luke/features/installed-skill-view";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@luke/features/installed-skill-wire";
import { parseSkillPaste, SKILL_PASTE_KIND } from "@luke/features/skill-paste";
import { TASK_SKILL_BOUNDS } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActKind } from "@luke/host/contract";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { announcedAsAlert, mountAnnouncer } from "../testing/announcer.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { restOn } from "../testing/hint-rest.js";
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
 * the dialog, a command that names a skill is confirmed as its
 * card and Install names it; Browse them lists the rest keeping the tick,
 * a skill with problems never tickable; a skill it hands off to comes
 * along ticked, untickable, its SKILL.md read in place; what is installed
 * in the scope chosen is not counted; a name the repository lacks is said
 * and the list shown; only what would install scrolls; a refusal is said
 * in words; text folds to its size and asks when agents should use it;
 * and Everyone in the workspace is offered to every member, never in a
 * personal workspace. Synthetic names and ids.
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

/** What the service previews of a skill's text: its name from its heading, and no description. */
function textPreview(text: string): InstalledSkillPreview {
  const paste = parseSkillPaste(text);
  return {
    kind: SKILL_PASTE_KIND.TEXT,
    ...(paste.kind === SKILL_PASTE_KIND.TEXT && paste.name !== undefined
      ? { name: paste.name }
      : {}),
    bytes: new TextEncoder().encode(text).byteLength,
    problems: [INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING],
  };
}

/** mattpocock/skills with grill-me named: it hands off to grilling, ships scripts, and is rated. */
const GRILL: Extract<InstalledSkillPreview, { kind: typeof SKILL_PASTE_KIND.SOURCE }> = {
  kind: SKILL_PASTE_KIND.SOURCE,
  owner: "mattpocock",
  repo: "skills",
  ref: "main",
  sha: SHA,
  missing: [],
  skills: [
    {
      name: "grill-me",
      description: "A relentless interview to sharpen a plan.",
      path: "skills/grill-me",
      fileCount: 2,
      bytes: 410,
      selected: true,
      problems: [],
      references: ["grilling"],
      hasScripts: true,
      markdown: "# Grill me\n\nHand off to `grilling`.",
      audit: {
        ath: { risk: SKILL_AUDIT_RISK.SAFE },
        snyk: { risk: SKILL_AUDIT_RISK.HIGH },
      },
    },
    {
      name: "grilling",
      description: "Runs the interview.",
      path: "skills/grilling",
      fileCount: 3,
      bytes: 6000,
      selected: false,
      problems: [],
    },
    {
      name: "tdd",
      path: "skills/tdd",
      fileCount: 1,
      bytes: 900,
      selected: false,
      problems: [],
    },
  ],
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
/** What the next source preview answers. */
let sourcePreview: InstalledSkillPreview = SOURCE;
/** How many of the next file reads go unanswered. */
let unansweredFiles = 0;
/** How many of the next previews the service never answers, which the port refuses. */
let unreachedPreviews = 0;

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  stored = [RELEASE_NOTES, PR_STYLE];
  sent = [];
  refuseInstall = false;
  missingNames = [];
  nameTaken = false;
  sourcePreview = SOURCE;
  unansweredFiles = 0;
  unreachedPreviews = 0;
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
      if (unreachedPreviews > 0) {
        unreachedPreviews -= 1;
        return Promise.reject(new Error("offline"));
      }
      return Promise.resolve(
        /^(?:npx|https:)/u.test(payload.text)
          ? { ...sourcePreview, missing: missingNames }
          : textPreview(payload.text),
      );
    },
    [ACT_KIND.INSTALLED_SKILLS_PREVIEW_FILE]: (payload) => {
      sent.push({ kind: ACT_KIND.INSTALLED_SKILLS_PREVIEW_FILE, payload });
      if (unansweredFiles > 0) {
        unansweredFiles -= 1;
        return Promise.resolve({ failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED });
      }
      return Promise.resolve({ markdown: "# Grilling" });
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

async function mountDialog(
  shown = workspace(),
  onClose: () => void = () => undefined,
): Promise<InstalledSkillSummary[]> {
  const installed: InstalledSkillSummary[] = [];
  mount(
    createElement(AddSkillDialog, {
      workspace: shown,
      onInstalled: (made) => installed.push(...made),
      onClose,
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

/** The dialog's act at the foot's end, whatever it names. */
const primary = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((each) =>
    each.textContent?.startsWith("Install"),
  ) ?? assert.fail("no Install button");

/** A field of the text screen, by its label. */
const fieldOf = (label: string) =>
  [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].find(
    (each) => each.labels?.[0]?.textContent === label,
  ) ?? assert.fail(`no ${label} field`);

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
  assert.deepEqual(headings, ["Stage", "Only you"]);
  const text = document.body.textContent ?? "";
  assert.match(
    text,
    /release-notes described · acme\/agent-skills @ 3f9c2e1 · by Dean\. Follows your workspace\.Workspace/u,
  );
  assert.match(text, /pr-style described · pastedOnly you/u);
  assert.match(text, /\.agents\/skills.*only agents started afterwards/u);
});

test("the workspace's skills each say they follow the workspace, and the account's own say nothing the page's head does not", async () => {
  await mountPage();

  assert.match(rowOf("release-notes").textContent ?? "", /Follows your workspace\./u);
  assert.doesNotMatch(rowOf("pr-style").textContent ?? "", /Follows your/u);
});

test("an empty workspace group says it follows the workspace", async () => {
  stored = [PR_STYLE];
  await mountPage();

  assert.match(
    document.body.textContent ?? "",
    /No skills installed yet\. Follows your workspace\./u,
  );
});

test("a skill's row leads with the book in the settings mark slot, and hangs the skill's card, which says whose it is and names no file", async () => {
  await mountPage();

  const row = [...document.querySelectorAll<HTMLElement>(".luke-settings-row")].find((each) =>
    each.textContent?.startsWith("release-notes"),
  );
  assert.ok(row, "the skill has its row");
  assert.ok(row.querySelector(".luke-settings-row-mark svg"), "the row leads with a book");

  restOn(row);

  const card = document.querySelector<HTMLElement>(".luke-tooltip-card > [data-skill-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "/release-notes");
  assert.equal(card?.querySelector(".luke-hover-card-corner")?.textContent, "Workspace");
  assert.equal(card?.querySelector('.luke-hover-card-row[data-look="detail"]'), null);
});

test("a GitHub skill whose folder moved offers Update in its ⋯, which updates it and goes", async () => {
  await mountPage();

  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_CHECK_UPDATE), [
    { workspaceId: "workspace-stage", skillId: RELEASE_NOTES.id },
  ]);
  assert.deepEqual(menuOf("release-notes"), ["Open", "Update", "Remove"]);
  await choose("release-notes", "Update");
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_UPDATE), [
    { workspaceId: "workspace-stage", skillId: RELEASE_NOTES.id },
  ]);
  assert.deepEqual(menuOf("release-notes"), ["Open", "Remove"]);
});

test("the account's own skill offers Share with workspace, which asks in plain words and moves it there", async () => {
  await mountPage();

  assert.deepEqual(menuOf("pr-style"), ["Open", "Share with workspace", "Remove"]);
  await choose("pr-style", "Share with workspace");
  const question = dialog("alertdialog");
  assert.match(question.textContent ?? "", /Share pr-style with Stage\?/u);
  assert.match(
    question.textContent ?? "",
    /Everyone in Stage will get pr-style\. It leaves your personal skills\./u,
  );
  act(() => button("Share with workspace", question).click());
  await settle();

  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_SHARE), [
    { workspaceId: "workspace-stage", skillId: PR_STYLE.id },
  ]);
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  const [, shared, personal] = [...document.querySelectorAll("section")];
  assert.match(
    shared?.textContent ?? "",
    /pr-style described · pasted · by you\. Follows your workspace\.Workspace/u,
  );
  assert.match(personal?.textContent ?? "", /No skills installed yet\./u);
});

test("a share the workspace already has the name for is refused in the question, and the skill stays the account's own", async () => {
  nameTaken = true;
  await mountPage();

  await choose("pr-style", "Share with workspace");
  act(() => button("Share with workspace", dialog("alertdialog")).click());
  await settle();

  assert.match(
    dialog("alertdialog").textContent ?? "",
    /Stage already has a skill named pr-style\. Remove one of them first\./u,
  );
  assert.match(rowOf("pr-style").textContent ?? "", /pastedOnly you/u);
});

test("Share is never offered in a personal workspace", async () => {
  stored = [PR_STYLE];
  await mountPage(workspace({ personal: true }));

  assert.deepEqual(menuOf("pr-style"), ["Open", "Remove"]);
});

test("View reads the skill and draws its text as written and every file with its size", async () => {
  await mountPage();

  await choose("pr-style", "Open");
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_READ), [{ skillId: PR_STYLE.id }]);
  const shown = dialog();
  assert.equal(shown.querySelector("h2")?.textContent, "pr-style");
  assert.match(shown.querySelector("pre")?.textContent ?? "", /name: pr-style[\s\S]*# PR style/u);
  assert.deepEqual(
    [...shown.querySelectorAll("dt, dd")].map((each) => each.textContent),
    ["SKILL.md", "48 B", "examples/good.md", "2.0 kB"],
  );
  act(() => button("Done", shown).click());
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test("Remove asks first, red for a personal skill whose files go, then takes it off the page", async () => {
  await mountPage();

  await choose("pr-style", "Remove");
  const question = dialog("alertdialog");
  assert.equal(button("Remove", question).dataset.variant, "danger");
  assert.match(question.textContent ?? "", /Its files are deleted/u);
  act(() => button("Remove", question).click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_REMOVE), [{ skillId: PR_STYLE.id }]);
  assert.ok(!(document.body.textContent ?? "").includes("pr-style described"));
});

test("Removing a workspace skill says everyone in the workspace loses it, in the accent", async () => {
  await mountPage();

  await choose("release-notes", "Remove");
  const question = dialog("alertdialog");
  assert.match(question.textContent ?? "", /Everyone in Stage loses release-notes/u);
  assert.notEqual(button("Remove", question).dataset.variant, "danger");
});

test("Add skill opens with its box focused, not the card", async () => {
  await mountPage();

  act(() => button("Add skill").click());
  await settle();
  assert.ok(document.activeElement === document.querySelector("textarea"), "the box has focus");
});

test("an install lights its own rows once and says which skills and how to call one", async () => {
  await mountPage();

  act(() => button("Add skill").click());
  await paste(COMMAND);
  act(() => button("Browse them").click());
  act(() => checkboxOf("react-best-practices").click());
  act(() => button("Install 2 skills").click());
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
  assert.deepEqual(menuOf("release-notes"), ["Open"]);
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_CHECK_UPDATE), []);
});

test("a personal workspace lists the account's own skills alone", async () => {
  stored = [PR_STYLE];
  await mountPage(workspace({ personal: true }));

  assert.deepEqual(
    [...document.querySelectorAll("h2")].map((each) => each.textContent),
    ["Only you"],
  );
});

test("a command that names a skill is confirmed as its card, with no list, and Install names it and sends it", async () => {
  const installed = await mountDialog();
  await paste(COMMAND);

  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_PREVIEW), [
    { workspaceId: "workspace-stage", text: COMMAND },
  ]);
  const text = document.body.textContent ?? "";
  assert.match(text, /Add web-design-guidelines/u);
  assert.match(text, /From vercel-labs\/agent-skills @ 3f9c2e1/u);
  assert.match(text, /4 files · 22 kB · skills\/web/u);
  assert.match(text, /2 other skills in this repository/u);
  assert.equal(document.querySelector("textarea"), null);
  assert.equal(document.querySelector('input[type="checkbox"]'), null);

  act(() => primary().click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_INSTALL), [
    {
      text: COMMAND,
      workspaceId: "workspace-stage",
      scope: INSTALLED_SKILL_SCOPE.PERSONAL,
      skills: ["web-design-guidelines"],
    },
  ]);
  assert.deepEqual(
    installed.map((each) => each.name),
    ["web-design-guidelines"],
  );
});

test("Browse them lists every skill by name keeping the tick, one with problems never tickable, and Change opens the box with the paste", async () => {
  await mountDialog();
  await paste(COMMAND);

  act(() => button("Browse them").click());
  assert.match(document.body.textContent ?? "", /Add skills from vercel-labs\/agent-skills/u);
  const names = [...document.querySelectorAll('[aria-label="Skills found"] label')].map(
    (each) => each.textContent?.split(/[A-Z]/u)[0],
  );
  assert.deepEqual(names, ["leaky", "react-best-practices", "web-design-guidelines"]);
  assert.equal(checkboxOf("web-design-guidelines").checked, true);
  assert.equal(checkboxOf("leaky").disabled, true);
  assert.match(document.body.textContent ?? "", /Holds what looks like a credential/u);

  act(() => checkboxOf("react-best-practices").click());
  assert.equal(primary().textContent, "Install 2 skills");

  act(() => button("Change").click());
  assert.equal(document.querySelector("textarea")?.value, COMMAND);
});

test("a skill that hands off to another brings it along ticked, which can be unticked, with its scripts and ratings shown and its SKILL.md opened in place", async () => {
  sourcePreview = GRILL;
  await mountDialog();
  await paste(COMMAND);

  const text = document.body.textContent ?? "";
  assert.match(text, /Also installing grilling/u);
  assert.match(text, /grill-me hands off to it/u);
  assert.match(text, /scripts/u);
  assert.match(text, /Gen safe·Snyk high risk/u);
  assert.equal(primary().textContent, "Install 2 skills");

  act(() => checkboxOf("Also installing grilling").click());
  assert.equal(primary().textContent, "Install grill-me");
  act(() => checkboxOf("Also installing grilling").click());

  const views = () =>
    [...document.querySelectorAll("button")].filter((each) => each.textContent === "View SKILL.md");
  act(() => views()[0]?.click());
  assert.equal(
    document.querySelector('[aria-label="grill-me\'s SKILL.md"]')?.textContent,
    "# Grill me\n\nHand off to `grilling`.",
  );
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_PREVIEW_FILE), []);

  act(() => views()[0]?.click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_PREVIEW_FILE), [
    {
      workspaceId: "workspace-stage",
      owner: "mattpocock",
      repo: "skills",
      sha: SHA,
      path: "skills/grilling",
    },
  ]);
  assert.equal(
    document.querySelector('[aria-label="grilling\'s SKILL.md"]')?.textContent,
    "# Grilling",
  );

  act(() => primary().click());
  await settle();
  assert.deepEqual(
    (sentOf(ACT_KIND.INSTALLED_SKILLS_INSTALL)[0] as { skills: string[] } | undefined)?.skills,
    ["grill-me", "grilling"],
  );
});

test("a GitHub link to a skill's folder pasted alone is previewed as its repository, not read as text", async () => {
  const link = "https://github.com/vercel-labs/agent-skills/tree/main/skills/web";
  await mountDialog();
  await paste(link);

  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_PREVIEW), [
    { workspaceId: "workspace-stage", text: link },
  ]);
  assert.match(document.body.textContent ?? "", /Add web-design-guidelines/u);
  assert.equal(primary().textContent, "Install web-design-guidelines");
});

test("a browsed skill's SKILL.md opens beside its box, and a read that failed is asked again", async () => {
  sourcePreview = GRILL;
  unansweredFiles = 1;
  await mountDialog();
  await paste(COMMAND);
  act(() => button("Browse them").click());

  const view = () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].filter(
      (each) => each.textContent === "View SKILL.md" || each.textContent === "Hide SKILL.md",
    )[2] ?? assert.fail("no View for tdd");
  act(() => view().click());
  await settle();
  assert.match(document.body.textContent ?? "", /The service could not be reached/u);
  act(() => view().click());
  act(() => view().click());
  await settle();
  assert.equal(sentOf(ACT_KIND.INSTALLED_SKILLS_PREVIEW_FILE).length, 2);
  assert.equal(document.querySelector('[aria-label="tdd\'s SKILL.md"]')?.textContent, "# Grilling");
  assert.equal(checkboxOf("tdd").checked, false);
});

test("a skill already installed for the scope chosen is marked and not counted, and Everyone in the workspace counts it again", async () => {
  sourcePreview = {
    ...GRILL,
    skills: GRILL.skills.map((each) =>
      each.name === "grilling"
        ? {
            ...each,
            installed: [
              {
                id: "33333333-3333-4333-8333-333333333333",
                scope: INSTALLED_SKILL_SCOPE.PERSONAL,
                standing: INSTALLED_SKILL_STANDING.CURRENT,
              },
            ],
          }
        : each,
    ),
  };
  await mountDialog();
  await paste(COMMAND);

  assert.match(document.body.textContent ?? "", /Also installing grillingInstalled/u);
  assert.equal(checkboxOf("Also installing grilling").disabled, true);
  assert.equal(primary().textContent, "Install grill-me");
  act(() => button("Everyone in Stage").click());
  assert.equal(primary().textContent, "Install 2 skills");
});

test("a named skill the repository lacks is said plainly, and every skill it holds is listed to pick from", async () => {
  missingNames = ["web-design-guide"];
  await mountDialog();
  await paste(COMMAND);

  assert.match(
    document.body.textContent ?? "",
    /No skill named web-design-guide in vercel-labs\/agent-skills\. Pick from its 3 skills\./u,
  );
  assert.ok(checkboxOf("react-best-practices"));
  assert.ok(document.querySelector('input[aria-label="Search skills"], input[type="search"]'));
});

test("only what a paste would install scrolls: the box's folded line, the search, and Install for stay on the card however many it holds", async () => {
  missingNames = Array.from({ length: 40 }, (_, at) => `absent-${at}`);
  await mountDialog();
  await paste(COMMAND);

  const scrolled = (element: Element | null | undefined) =>
    (element ?? assert.fail("not drawn")).closest(".luke-scroll-area") !== null;
  assert.equal(scrolled(document.querySelector('[aria-label="Skills found"]')), true);
  assert.equal(scrolled(checkboxOf("web-design-guidelines")), true);
  assert.equal(scrolled(button("Change")), false);
  assert.equal(scrolled(document.querySelector('input[aria-label="Search skills"]')), false);
  assert.equal(scrolled(checkboxOf("Select all")), false);
  const lines = [...document.querySelectorAll('[role="status"], .settings-state')];
  assert.equal(
    scrolled(lines.find((each) => each.textContent?.startsWith("No skills named absent-0"))),
    true,
  );
  assert.equal(scrolled(button("Everyone in Stage")), false);
  assert.equal(scrolled(primary()), false);
});

test("a refused install says which skill and why in words, keeps the dialog, and marks that skill so it no longer installs", async () => {
  refuseInstall = true;
  await mountDialog();
  mountAnnouncer();
  await paste(COMMAND);

  act(() => primary().click());
  await settle();
  assert.match(
    document.body.textContent ?? "",
    /web-design-guidelines holds more than 64 files\./u,
  );
  assert.equal(
    announcedAsAlert(),
    "More than 64 files",
    "the skill's mark is announced as an alert",
  );
  assert.match(document.body.textContent ?? "", /More than 64 files/u);
  assert.equal(primary().textContent, "Install");
  assert.equal(primary().disabled, true);
});

test("pasted text folds to its size, its name suggested and editable, and asks when agents should use it before Install", async () => {
  await mountDialog();
  await paste(TEXT);

  const text = document.body.textContent ?? "";
  assert.match(text, /Pasted text · 46 B/u);
  assert.equal(fieldOf("Name").value, "pr-style");
  assert.equal(primary().textContent, "Install pr-style");
  assert.equal(primary().disabled, true);
  typeInto(fieldOf("When should agents use it?"), "How PRs read here.");
  act(() => primary().click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_INSTALL), [
    {
      text: TEXT,
      workspaceId: "workspace-stage",
      scope: INSTALLED_SKILL_SCOPE.PERSONAL,
      name: "pr-style",
      description: "How PRs read here.",
    },
  ]);
});

test("the When-to-use box stops at the description cap and counts toward it", async () => {
  await mountDialog();
  await paste(TEXT);

  const box = fieldOf("When should agents use it?");
  assert.equal(
    box instanceof HTMLTextAreaElement && box.maxLength,
    TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS,
  );
  assert.equal(document.querySelector(".luke-length-counter"), null);
  typeInto(box, "x".repeat(Math.ceil(TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS * 0.9)));
  await settle();
  assert.match(
    document.querySelector(".luke-length-counter")?.textContent ?? "",
    new RegExp(`/${TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS}$`, "u"),
  );
});

test("a name with a bad shape is marked invalid and says why on the Name field alone", async () => {
  await mountDialog();
  await paste(TEXT);
  typeInto(fieldOf("When should agents use it?"), "How PRs read here.");
  assert.equal(fieldOf("Name").getAttribute("aria-invalid"), null, "a good name is not marked");

  typeInto(fieldOf("Name"), "PR Style");
  await settle();
  const name = fieldOf("Name");
  const error = name.closest('[data-slot="field"]')?.querySelector('[data-slot="field-error"]');
  assert.equal(name.getAttribute("aria-invalid"), "true");
  assert.equal(error?.textContent, "Name must be lowercase words joined by hyphens");
  assert.ok(
    name
      .getAttribute("aria-describedby")
      ?.split(" ")
      .includes(error?.id ?? "missing"),
  );
  assert.equal(fieldOf("When should agents use it?").getAttribute("aria-invalid"), null);
  assert.equal(
    document.querySelectorAll('[data-slot="field-error"]:not(:empty)').length,
    1,
    "the problem is said once, on its field, not again under both",
  );
  assert.equal(primary().disabled, true);
});

test("a When-to-use that runs past the cap is marked invalid and says so on its own field alone", async () => {
  await mountDialog();
  await paste(TEXT);

  const box = fieldOf("When should agents use it?");
  typeInto(box, "x".repeat(TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS + 1));
  await settle();
  const error = box.closest('[data-slot="field"]')?.querySelector('[data-slot="field-error"]');
  assert.equal(box.getAttribute("aria-invalid"), "true");
  assert.equal(
    error?.textContent,
    `Description over ${TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS} characters`,
  );
  assert.ok(
    box
      .getAttribute("aria-describedby")
      ?.split(" ")
      .includes(error?.id ?? "missing"),
  );
  assert.equal(fieldOf("Name").getAttribute("aria-invalid"), null);
  assert.equal(document.querySelectorAll('[data-slot="field-error"]:not(:empty)').length, 1);
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
  act(() => primary().click());
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
  typeInto(fieldOf("When should agents use it?"), "How PRs read here.");

  act(() => button("Edit").click());
  await paste("# Review style\n\nAsk for tests.");
  assert.equal(fieldOf("When should agents use it?").value, "");
  assert.equal(fieldOf("Name").value, "review-style");
  assert.equal(primary().disabled, true);
});

/** Presses Escape in the dialog's box, as a member does with the caret in it. */
function escapeInBox(): void {
  act(() => {
    (
      document.querySelector("textarea") ??
      document.querySelector('[role="dialog"]') ??
      assert.fail("no box")
    ).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

test("Escape with pasted text in the box holds the dialog open, and the next one closes it", async () => {
  let closed = 0;
  await mountDialog(workspace(), () => {
    closed += 1;
  });
  await paste(TEXT);
  escapeInBox();
  assert.equal(closed, 0, "pasted text is held, not put away");
  assert.ok(document.querySelector('[role="dialog"]'), "the dialog stands");

  escapeInBox();
  assert.equal(closed, 1, "the next Escape puts it away");
});

test("a preview the service never answers says it could not be read, and Retry asks again", async () => {
  unreachedPreviews = 1;
  await mountDialog();
  await paste(COMMAND);

  const text = document.body.textContent ?? "";
  assert.match(text, /That paste could not be read\./u);
  assert.doesNotMatch(text, /Reading/u, "a failed preview is no longer being read");

  act(() => button("Retry").click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_PREVIEW), [
    { workspaceId: "workspace-stage", text: COMMAND },
    { workspaceId: "workspace-stage", text: COMMAND },
  ]);
  assert.match(document.body.textContent ?? "", /Add web-design-guidelines/u);
});
