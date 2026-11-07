// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  type InstalledSkillCandidate,
  type InstalledSkillPreview,
  type InstalledSkillSummary,
  SKILL_PASTE_KIND,
  UNSUPPORTED_PREVIEW,
} from "@repo/features/installed-skill-route-wire";
import { INSTALLED_SKILL_CALL_FAILURE } from "@repo/features/installed-skill-view";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@repo/features/installed-skill-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppInstalledSkills,
  type AppStateDelivery,
  type AppWorkspaceMembers,
  NO_KEYS_HELD,
} from "@repo/host/app-state";
import type { PortActKind } from "@repo/host/contract";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge, quietHold } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { stateWith } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { ToastHost } from "../toast.js";
import { AddSkillDialog } from "./add-skill-dialog.js";
import { SKILLS_LINE } from "./skills-model.js";
import { SkillsPage } from "./skills-page.js";

/**
 * Settings › Skills and its Add skill dialog over a host answering as the
 * service would: the skills of the workspace Settings shows are held for it
 * and drawn as the host lays them, the workspace's standing before the
 * account's own, each with its source and who installed it; a member who is
 * not an owner or admin sees View alone in a workspace skill's ⋯; View
 * reads the skill's text and files; Delete asks first; and an install
 * lights its rows. In the dialog, a GitHub source's skills are
 * one list to tick, searched once it is long, the named one ticked, and
 * Install sends the ticked ones with the commit previewed; a skill's text
 * fills Name and Description from its frontmatter, Install waiting for a
 * name by the rule and a description; a paste we do not install from says
 * GitHub alone; a refusal is said in words; and Everyone in the workspace
 * is offered to every member, never in a personal workspace. Synthetic
 * names and ids.
 */

const READER = "user-ada";
const SHA = "3f9c2e1aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5";
const COMMAND = "npx skills add vercel-labs/agent-skills --skill web-design-guidelines";
const TEXT = "---\nname: pr-style\ndescription: How PRs read here.\n---\n\nLead with the change.";

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

function candidate(
  name: string,
  extra: Partial<InstalledSkillCandidate> = {},
): InstalledSkillCandidate {
  return {
    name,
    path: `skills/${name}`,
    bytes: 900,
    selected: false,
    fileCount: 1,
    problems: [],
    ...extra,
  };
}

/** A source's preview holding the skills given. */
function sourceOf(skills: readonly InstalledSkillCandidate[]): InstalledSkillPreview {
  return {
    kind: SKILL_PASTE_KIND.SOURCE,
    owner: "vercel-labs",
    repo: "agent-skills",
    ref: "main",
    sha: SHA,
    skills,
    missing: [],
  };
}

const SOURCE = sourceOf([
  candidate("web-design-guidelines", {
    description: "Review a UI against the guidelines.",
    path: "skills/web",
    bytes: 22_000,
    selected: true,
  }),
  candidate("react-best-practices"),
]);

/** The skills the test's service holds, which its host lays on the document for every workspace held. */
let stored: InstalledSkillSummary[] = [];
/** The workspaces whose skills the window holds. */
let held = new Set<string>();
/** Each held workspace's skills as the test's host lays them on the document, under the version it last delivered. */
let laid: AppInstalledSkills = NO_KEYS_HELD;
let version = 1;
/** The window's listeners to the document's deliveries. */
const listeners = new Set<(delivery: AppStateDelivery) => void>();

/** The workspace's people, which name who installed a skill. */
const MEMBERS: AppWorkspaceMembers = {
  "workspace-stage": {
    rows: {
      members: [
        {
          userId: "user-dean",
          name: "Dean",
          email: "dean@example.com",
          role: WORKSPACE_ROLE.ADMIN,
        },
      ],
    },
  },
};

/** Lays every held workspace's skills as they are stored now and delivers them, as the host does as a read moves or a write is drawn. */
function laySkills(): void {
  laid = Object.fromEntries([...held].map((workspaceId) => [workspaceId, { rows: stored }]));
  version += 1;
  for (const listener of [...listeners]) {
    listener({ version, entries: { [LIVE_READ.INSTALLED_SKILLS]: laid } });
  }
}
/** Every act the page sent, in order. */
let sent: { kind: PortActKind; payload: unknown }[] = [];
/** Whether the next install is refused, for a credential in the named skill. */
let refuseInstall = false;
/** What the next source preview answers. */
let sourcePreview: InstalledSkillPreview = SOURCE;
/** How many of the next previews the service never answers, which the port refuses. */
let unreachedPreviews = 0;

const roots: Root[] = [];

/** What the service previews of a paste: a GitHub source's skills, a skill's text, or neither. */
function previewOf(text: string): InstalledSkillPreview {
  if (text.includes("\n")) {
    return {
      kind: SKILL_PASTE_KIND.TEXT,
      name: "pr-style",
      description: "How PRs read here.",
      bytes: text.length,
      problems: [],
    };
  }
  return text.includes("gitlab") ? UNSUPPORTED_PREVIEW : sourcePreview;
}

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  stored = [RELEASE_NOTES, PR_STYLE];
  held = new Set();
  laid = NO_KEYS_HELD;
  version = 1;
  listeners.clear();
  fakeAppBridge({
    requestAppState: () =>
      Promise.resolve(
        stateWith(
          {},
          {
            version,
            [LIVE_READ.INSTALLED_SKILLS]: laid,
            [LIVE_READ.WORKSPACE_MEMBERS]: MEMBERS,
          },
        ),
      ),
    onAppState: (listener: (delivery: AppStateDelivery) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  sent = [];
  refuseInstall = false;
  sourcePreview = SOURCE;
  unreachedPreviews = 0;
  fakeActPort({
    [ACT_KIND.INSTALLED_SKILLS_FOLLOW]: (payload) => {
      sent.push({ kind: ACT_KIND.INSTALLED_SKILLS_FOLLOW, payload });
      held.add(payload.workspaceId);
      // Note that the host lays what it read once the hold is taken, never inside it.
      void Promise.resolve().then(laySkills);
      return quietHold();
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
    [ACT_KIND.INSTALLED_SKILLS_REMOVE]: (payload) => {
      sent.push({ kind: ACT_KIND.INSTALLED_SKILLS_REMOVE, payload });
      stored = stored.filter((each) => each.id !== payload.skillId);
      laySkills();
      return Promise.resolve({ id: payload.skillId });
    },
    [ACT_KIND.INSTALLED_SKILLS_PREVIEW]: (payload) => {
      sent.push({ kind: ACT_KIND.INSTALLED_SKILLS_PREVIEW, payload });
      if (unreachedPreviews > 0) {
        unreachedPreviews -= 1;
        return Promise.reject(new Error("offline"));
      }
      return Promise.resolve(previewOf(payload.text));
    },
    [ACT_KIND.INSTALLED_SKILLS_INSTALL]: (payload) => {
      sent.push({ kind: ACT_KIND.INSTALLED_SKILLS_INSTALL, payload });
      if (refuseInstall) {
        return Promise.resolve({
          failure: INSTALLED_SKILL_CALL_FAILURE.CREDENTIAL,
          skillName: "web-design-guidelines",
        });
      }
      const made = (payload.skills ?? [payload.name ?? "pr-style"]).map((name, at) =>
        skill(name, payload.scope, { id: `33333333-3333-4333-8333-33333333333${at}` }),
      );
      // The host draws an install's skills as it answers.
      stored = [...stored, ...made];
      laySkills();
      return Promise.resolve({ skills: made });
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
  // Note that each mount reads the document afresh, over the bridge this test installed.
  act(() => root.render(withQueryClient(element)));
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
  // Note that the page stands read once the skills the host holds reach their query.
  await vi.waitFor(() =>
    assert.equal(document.body.textContent?.includes("Reading your skills"), false),
  );
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

/** Whether the dialog still says it is reading what was pasted. */
const previewReading = () => (document.body.textContent ?? "").includes(SKILLS_LINE.READING);

/** Pastes `text` into the box and waits for its preview to land. */
async function paste(text: string): Promise<void> {
  typeInto(document.querySelector("textarea") ?? assert.fail("no box"), text);
  await vi.waitFor(() => assert.equal(previewReading(), false));
}

/** The row a skill's name labels. */
const rowOf = (name: string) =>
  [...document.querySelectorAll<HTMLElement>(".ui-settings-row")].find(
    (each) => each.querySelector(".ui-settings-row-label")?.textContent === name,
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

/** The search over a long list of found skills. */
const SEARCH = 'input[aria-label="Search skills"]';

/** The dialog standing over the page. */
const dialog = (role = "dialog") =>
  document.querySelector<HTMLElement>(`[role="${role}"]`) ?? assert.fail(`no ${role}`);

const sentOf = (kind: PortActKind) =>
  sent.filter((each) => each.kind === kind).map((each) => each.payload);

test("the workspace's skills stand before the account's own, each with its source and who installed it", async () => {
  await mountPage();

  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_FOLLOW), [{ workspaceId: "workspace-stage" }]);

  const headings = [...document.querySelectorAll("h2")].map((each) => each.textContent);
  assert.deepEqual(headings, ["Stage", "Only you"]);
  const text = document.body.textContent ?? "";
  assert.match(text, /release-notes describedacme\/agent-skills @ 3f9c2e1 · by Dean/u);
  assert.match(text, /pr-style describedPasted/u);
});

test("a skill's description stands alone, its source line under it as the row's detail", async () => {
  await mountPage();

  const row = rowOf("release-notes");
  assert.equal(
    row.querySelector(".ui-settings-row-state")?.textContent,
    "acme/agent-skills @ 3f9c2e1 · by Dean",
  );
  assert.equal(
    row.querySelector(".ui-settings-row-description")?.firstChild?.textContent,
    "release-notes described",
  );
});

test("a skill's row leads with the book in the settings mark slot, and hangs the skill's card, which says whose it is and names no file", async () => {
  await mountPage();

  const row = [...document.querySelectorAll<HTMLElement>(".ui-settings-row")].find((each) =>
    each.textContent?.startsWith("release-notes"),
  );
  assert.ok(row, "the skill has its row");

  restOn(row);

  const card = document.querySelector<HTMLElement>(".ui-tooltip-card > [data-skill-card]");
  assert.equal(card?.querySelector(".ui-hover-card-name")?.textContent, "/release-notes");
  assert.equal(card?.querySelector(".ui-hover-card-sub")?.textContent, "Workspace skill");
  assert.equal(card?.querySelector('.ui-hover-card-row[data-look="detail"]'), null);
});

test("View reads the skill and draws its text as written and every file with its size", async () => {
  await mountPage();

  await choose("pr-style", "Open");
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_READ), [{ skillId: PR_STYLE.id }]);
  const shown = dialog();
  assert.equal(shown.querySelector("h2")?.textContent, "pr-style");
  // Note that the skill's text lands through a query, so it is read once drawn.
  await vi.waitFor(() =>
    assert.match(shown.querySelector("pre")?.textContent ?? "", /name: pr-style[\s\S]*# PR style/u),
  );
  assert.deepEqual(
    [...shown.querySelectorAll("dt, dd")].map((each) => each.textContent),
    ["SKILL.md", "48 B", "examples/good.md", "2.0 kB"],
  );
  act(() => button("Done", shown).click());
  assert.equal(document.querySelector('[role="dialog"]') === null, true);
});

test("Delete asks first, red for a personal skill whose files go, then takes it off the page", async () => {
  await mountPage();

  await choose("pr-style", "Delete");
  const question = dialog("alertdialog");
  assert.match(question.textContent ?? "", /Its files are deleted/u);
  act(() => button("Delete skill", question).click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_REMOVE), [{ skillId: PR_STYLE.id }]);
  await vi.waitFor(() =>
    assert.ok(!(document.body.textContent ?? "").includes("pr-style described")),
  );
});

test("Deleting a workspace skill says everyone in the workspace loses it, in the accent", async () => {
  await mountPage();

  await choose("release-notes", "Delete");
  const question = dialog("alertdialog");
  assert.match(question.textContent ?? "", /Everyone in Stage loses release-notes/u);
});

test("Add skill opens with its box focused, not the card", async () => {
  await mountPage();

  act(() => button("Add skill").click());
  await settle();
  assert.ok(document.activeElement === document.querySelector("textarea"), "the box has focus");
});

test("a personal workspace lists the account's own skills alone", async () => {
  stored = [PR_STYLE];
  await mountPage(workspace({ personal: true }));

  assert.deepEqual(
    [...document.querySelectorAll("h2")].map((each) => each.textContent),
    ["Only you"],
  );
});

test("an install lights its own rows once", async () => {
  await mountPage();

  act(() => button("Add skill").click());
  await paste(COMMAND);
  act(() => checkboxOf("react-best-practices").click());
  act(() => button("Install 2 skills").click());
  await settle();

  const lit = [...document.querySelectorAll(".ui-settings-row[data-landed]")].map(
    (each) => each.querySelector(".ui-settings-row-label")?.textContent,
  );
  assert.deepEqual(lit, ["react-best-practices", "web-design-guidelines"]);
});

test("a workspace skill a member may not remove holds View alone in its ⋯", async () => {
  stored = [{ ...RELEASE_NOTES, manageable: false }, PR_STYLE];
  await mountPage(workspace({ role: WORKSPACE_ROLE.MEMBER }));

  assert.deepEqual(menuOf("release-notes"), ["Open"]);
  assert.deepEqual(menuOf("pr-style"), ["Open", "Delete"]);
});

test("a GitHub source lists its skills to tick, the one the paste named ticked, and Install sends the ticked ones with the commit previewed", async () => {
  const installed = await mountDialog();
  await paste(COMMAND);

  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_PREVIEW), [
    { workspaceId: "workspace-stage", text: COMMAND },
  ]);
  assert.match(
    document.body.textContent ?? "",
    /web-design-guidelinesReview a UI against the guidelines\.skills\/web · 22 kB/u,
  );
  assert.equal(checkboxOf("web-design-guidelines").checked, true);
  assert.equal(checkboxOf("react-best-practices").checked, false);
  assert.equal(document.querySelector(SEARCH), null, "a short list has no search");

  act(() => primary().click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_INSTALL), [
    {
      text: COMMAND,
      workspaceId: "workspace-stage",
      scope: INSTALLED_SKILL_SCOPE.PERSONAL,
      skills: ["web-design-guidelines"],
      sha: SHA,
    },
  ]);
  assert.deepEqual(
    installed.map((each) => each.name),
    ["web-design-guidelines"],
  );
});

test("a long list is searched by name and description", async () => {
  sourcePreview = sourceOf([
    ...Array.from({ length: 8 }, (_, at) => candidate(`filler-${at}`)),
    candidate("release", { description: "Write the changelog." }),
  ]);
  await mountDialog();
  await paste("acme/skills");

  typeInto(
    document.querySelector<HTMLInputElement>(SEARCH) ?? assert.fail("no search"),
    "changelog",
  );
  await settle();
  const listed = [...document.querySelectorAll('input[type="checkbox"]')].map(
    (each) => each.closest("label")?.textContent,
  );
  assert.deepEqual(listed, ["releaseWrite the changelog.skills/release · 900 B"]);
});

test("pasted text fills Name and Description from its frontmatter, both editable, and Install waits for a name by the rule and a description", async () => {
  await mountDialog();
  await paste(TEXT);

  assert.equal(fieldOf("Name").value, "pr-style");
  assert.equal(fieldOf("When should agents use it?").value, "How PRs read here.");
  typeInto(fieldOf("Name"), "PR Style");
  assert.equal(primary().disabled, true);
  typeInto(fieldOf("Name"), "review-style");
  typeInto(fieldOf("When should agents use it?"), " ");
  assert.equal(primary().disabled, true);
  typeInto(fieldOf("When should agents use it?"), "How reviews read here.");
  assert.equal(primary().textContent, "Install review-style");

  act(() => primary().click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_INSTALL), [
    {
      text: TEXT,
      workspaceId: "workspace-stage",
      scope: INSTALLED_SKILL_SCOPE.PERSONAL,
      name: "review-style",
      description: "How reviews read here.",
    },
  ]);
});

test("a paste that is no GitHub repository says GitHub alone, and Install stays off", async () => {
  await mountDialog();
  await paste("https://gitlab.com/acme/skills");

  assert.match(document.body.textContent ?? "", /Only GitHub repositories\./u);
  assert.equal(primary().disabled, true);
});

test("a refused install says which skill and why in words, and keeps the dialog", async () => {
  refuseInstall = true;
  await mountDialog();
  await paste(COMMAND);

  act(() => primary().click());
  await settle();
  assert.match(
    document.body.textContent ?? "",
    /web-design-guidelines holds what looks like a credential\. A skill must never carry one\./u,
  );
  assert.ok(document.querySelector('[role="dialog"]'), "the dialog stands");
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
  await vi.waitFor(() => assert.equal(checkboxOf("web-design-guidelines").checked, true));
  assert.deepEqual(sentOf(ACT_KIND.INSTALLED_SKILLS_PREVIEW), [
    { workspaceId: "workspace-stage", text: COMMAND },
    { workspaceId: "workspace-stage", text: COMMAND },
  ]);
  assert.equal(checkboxOf("web-design-guidelines").checked, true);
});
