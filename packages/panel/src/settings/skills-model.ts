import type {
  InstalledSkillCandidate,
  InstalledSkillPreview,
  InstalledSkillSummary,
} from "@repo/features/installed-skill-route-wire";
import { SKILL_PASTE_KIND } from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillCallFailure,
  type InstalledSkillFailedView,
  type InstalledSkillInstallParams,
} from "@repo/features/installed-skill-view";
import {
  INSTALLED_SKILL_SCOPE,
  INSTALLED_SKILL_SOURCE,
  type InstalledSkillScope,
  type InstalledSkillSource,
} from "@repo/features/installed-skill-wire";
import { formatBytes } from "@repo/features/number-format";
import { SKILL_NAME_RULE } from "@repo/features/skill-file";
import { TASK_SKILL_SOURCE, type TaskSkillSource } from "@repo/features/task-wire";
import { readFailedWords } from "@repo/features/words";
import type { Workspace, WorkspaceMember } from "@repo/features/workspace-wire";
import { CONFIRM_LOSS, type ConfirmLoss, STATUS_TONE } from "@repo/ui";
import { matchesTokens, searchTokens } from "@repo/ui/search-tokens";

/**
 * skills-model.ts -- Settings › Skills and its Add skill dialog as the window draws them, judged without drawing: the rows and their lines, and what a paste would install.
 *
 * The page lists the workspace's skills, then the account's own, the same
 * split the Automations list makes, because whose a skill is decides who
 * may change it and whose agents load it. Each row says where its files
 * came from, a GitHub folder at the commit it is pinned to or a paste, and
 * who installed it. The dialog draws the service's preview of its one box:
 * a GitHub source's skills as one list to tick, or a skill's text as its
 * name and description to fill in, and what Install sends. Every refusal
 * the service names is said here in plain words, once.
 */

/** How many characters of a commit a row shows. */
const SHORT_SHA = 7;

/** How many skills a source lists before the list offers a search. */
const SEARCHED_FROM = 8;

/** What the page and the dialog say that no row's data says. */
export const SKILLS_LINE = {
  PERSONAL: "Only you",
  PASTED: "Pasted",
  NONE: "No skills installed yet.",
  READ_FAILED: "Your skills could not be read.",
  ADD_SKILL: "Add skill",
  PASTE_LABEL: "GitHub repository or SKILL.md text",
  PASTE_HINT:
    "Paste owner/repo, a GitHub link to a repository or skill folder, an npx skills add line, or a skill's SKILL.md text.",
  READING: "Reading…",
  UNSUPPORTED: "Only GitHub repositories.",
  INSTALL: "Install",
  INSTALL_FOR: "Install for",
  ONLY_YOU: "Only you",
  VIEW: "Open",
  SHARE: "Share with workspace",
  UPDATE: "Update",
  REMOVE: "Remove",
  FILES: "Files",
  VIEW_FAILED: "The skill could not be read.",
  SEARCH: "Search skills",
  NAME: "Name",
  NAME_HINT: "Lowercase words joined by hyphens, such as pr-style.",
  WHEN: "When should agents use it?",
  NO_MATCH: "No skills match.",
} as const;

/** The workspace's group heading. */
export function workspaceGroupTitle(workspace: Pick<Workspace, "name">): string {
  return workspace.name;
}

/** "Everyone in Stage": the dialog's workspace scope, named for the workspace. */
function everyoneIn(workspace: Pick<Workspace, "name">): string {
  return `Everyone in ${workspace.name}`;
}

/** Where a skill's files came from: `owner/repo @ 3f9c2e1`, or Pasted. */
function sourceLine(source: InstalledSkillSource): string {
  if (source.type === INSTALLED_SKILL_SOURCE.TEXT) return SKILLS_LINE.PASTED;
  return `${source.owner}/${source.repo} @ ${source.sha.slice(0, SHORT_SHA)}`;
}

/* ----- The page ----- */

/** One skill's row as the page draws it. */
export interface SkillRow {
  readonly skill: InstalledSkillSummary;
  /** Whose it is, which its source badge says at its end and its card's head. */
  readonly source: TaskSkillSource;
  /** Where its files came from, and who installed it where that is someone else. */
  readonly line: string;
  /** Whether it is read from GitHub, so may be updated. */
  readonly fromGitHub: boolean;
}

/** The page's two groups, the workspace's first; a group with no rows is still listed, for its heading. */
export interface SkillGroups {
  readonly workspace: readonly SkillRow[];
  readonly personal: readonly SkillRow[];
}

/** Who installed a skill as its line names them: by name where the members say, you for the reader, nobody once gone. */
function installerOf(
  skill: InstalledSkillSummary,
  readerId: string | undefined,
  members: readonly WorkspaceMember[] | undefined,
): string | undefined {
  if (skill.installedBy === null) return undefined;
  if (skill.installedBy === readerId) return "you";
  return members?.find((each) => each.userId === skill.installedBy)?.name;
}

/** One skill's row: its source and its line, where its files came from then who installed it. */
function rowOf(
  skill: InstalledSkillSummary,
  readerId: string | undefined,
  members: readonly WorkspaceMember[] | undefined,
): SkillRow {
  const workspace = skill.scope === INSTALLED_SKILL_SCOPE.WORKSPACE;
  const installer = workspace ? installerOf(skill, readerId, members) : undefined;
  return {
    skill,
    source: workspace ? TASK_SKILL_SOURCE.WORKSPACE : TASK_SKILL_SOURCE.PERSONAL,
    line:
      installer === undefined
        ? sourceLine(skill.source)
        : `${sourceLine(skill.source)} · by ${installer}`,
    fromGitHub: skill.source.type === INSTALLED_SKILL_SOURCE.GITHUB,
  };
}

/**
 * The skills as the page groups them: the workspace's, then the account's
 * own, each by name. A personal skill's installer is always the reader, so
 * only a workspace row names who installed it.
 */
export function skillGroups(
  skills: readonly InstalledSkillSummary[],
  readerId: string | undefined,
  members: readonly WorkspaceMember[] | undefined,
): SkillGroups {
  const sorted = [...skills].sort((one, other) => one.name.localeCompare(other.name));
  const rows = sorted.map((skill) => rowOf(skill, readerId, members));
  return {
    workspace: rows.filter((row) => row.skill.scope === INSTALLED_SKILL_SCOPE.WORKSPACE),
    personal: rows.filter((row) => row.skill.scope === INSTALLED_SKILL_SCOPE.PERSONAL),
  };
}

/* ----- A row's menu ----- */

/** What a row's ⋯ may hold. */
export const SKILL_ACTION = {
  VIEW: "view",
  SHARE: "share",
  UPDATE: "update",
  REMOVE: "remove",
} as const;

export type SkillAction = (typeof SKILL_ACTION)[keyof typeof SKILL_ACTION];

/**
 * What a row's ⋯ holds: View for every row, since anyone who sees a skill
 * may read it, Share with workspace for the account's own skill outside a
 * personal workspace, and Update for a GitHub skill; then, a rule apart,
 * Remove. A row the account may not change holds View alone.
 */
export function skillActions(
  row: SkillRow,
  workspace: Pick<Workspace, "personal">,
): readonly (readonly SkillAction[])[] {
  const { skill } = row;
  if (!skill.manageable) return [[SKILL_ACTION.VIEW]];
  const shareable = skill.scope === INSTALLED_SKILL_SCOPE.PERSONAL && workspace.personal !== true;
  const acts = [
    SKILL_ACTION.VIEW,
    ...(shareable ? [SKILL_ACTION.SHARE] : []),
    ...(row.fromGitHub ? [SKILL_ACTION.UPDATE] : []),
  ];
  return [acts, [SKILL_ACTION.REMOVE]];
}

/**
 * What Remove asks first: the skill and its files are deleted, past undoing,
 * so a personal skill's question is red; a workspace skill is every member's
 * agents', so it says whose and asks in the accent, as any act on others does.
 */
export function removeQuestion(
  skill: Pick<InstalledSkillSummary, "name" | "scope">,
  workspace: Pick<Workspace, "name">,
): {
  readonly title: string;
  readonly body: string;
  readonly verb: string;
  readonly running: string;
  readonly loss: ConfirmLoss;
} {
  const shared = skill.scope === INSTALLED_SKILL_SCOPE.WORKSPACE;
  return {
    title: `Remove ${skill.name}?`,
    body: shared
      ? `${everyoneIn(workspace)} loses ${skill.name}: agents they start afterwards no longer load it, and its files are deleted.`
      : "Its files are deleted, and agents started afterwards no longer load it. Installing it again takes the paste again.",
    verb: "Remove skill",
    running: "Removing",
    loss: shared ? CONFIRM_LOSS.AFFECTS_OTHERS : CONFIRM_LOSS.IRREVERSIBLE,
  };
}

/** What Share with workspace asks first: it moves the skill, so it says who gains it and that it leaves the account's own. */
export function shareQuestion(
  skillName: string,
  workspace: Pick<Workspace, "name">,
): {
  readonly title: string;
  readonly body: string;
  readonly verb: string;
  readonly running: string;
} {
  return {
    title: `Share ${skillName} with ${workspace.name}?`,
    body: `${everyoneIn(workspace)} will get ${skillName}. It leaves your personal skills.`,
    verb: SKILLS_LINE.SHARE,
    running: "Sharing",
  };
}

/**
 * A skill's `SKILL.md` as Markdown that draws it as written: one fenced
 * block, its fence a backtick longer than any run of them in the text, so
 * nothing inside can close it early, and its trailing newlines left out so
 * the block ends on its last line.
 */
export function fencedSkillFile(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map((run) => run[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}markdown\n${text.replace(/\n+$/u, "")}\n${fence}`;
}

/* ----- Words for what went wrong ----- */

/** What a failed call says, each after the skill it names where the service named one. */
const FAILURE_WORDS = {
  [INSTALLED_SKILL_CALL_FAILURE.UNANSWERED]: () => "The service could not be reached. Try again.",
  [INSTALLED_SKILL_CALL_FAILURE.NOT_FOUND]: () =>
    "That skill or workspace is no longer yours to reach.",
  [INSTALLED_SKILL_CALL_FAILURE.NOT_PERMITTED]: () =>
    "Only whoever installed this skill, or the workspace's owners and admins, can change it.",
  [INSTALLED_SKILL_CALL_FAILURE.INVALID]: () =>
    "The skill could not be installed. Check what you pasted.",
  [INSTALLED_SKILL_CALL_FAILURE.NAME_TAKEN]: (skill: string) =>
    `${skill} is already installed there. Remove it first, or install for the other scope.`,
  [INSTALLED_SKILL_CALL_FAILURE.UNREACHABLE]: () =>
    "That repository or branch could not be reached on GitHub. A private repository needs the workspace's GitHub connected.",
  [INSTALLED_SKILL_CALL_FAILURE.GITHUB_UNANSWERED]: () =>
    "GitHub didn't answer, or is limiting requests. Try again later.",
  [INSTALLED_SKILL_CALL_FAILURE.NO_SKILL_FILE]: (skill: string) =>
    `${skill} has no SKILL.md in its folder.`,
  [INSTALLED_SKILL_CALL_FAILURE.SKILL_FILE_INVALID]: (skill: string) =>
    `${skill} needs a valid name and a description in its SKILL.md.`,
  [INSTALLED_SKILL_CALL_FAILURE.TOO_LARGE]: (skill: string) => `${skill} is too large to install.`,
  [INSTALLED_SKILL_CALL_FAILURE.CREDENTIAL]: (skill: string) =>
    `${skill} holds what looks like a credential. A skill must never carry one.`,
} as const satisfies Record<InstalledSkillCallFailure, (skill: string) => string>;

/** What a failed call says, naming the skill where the service did. */
export function failureLine(
  failed: Pick<InstalledSkillFailedView, "failure" | "skillName">,
): string {
  return FAILURE_WORDS[failed.failure](failed.skillName ?? "This skill");
}

/** Why a share was refused: a name the workspace already holds is said for that workspace, the rest as any call says them. */
export function shareFailureLine(
  failed: Pick<InstalledSkillFailedView, "failure" | "skillName">,
  skillName: string,
  workspace: Pick<Workspace, "name">,
): string {
  if (failed.failure === INSTALLED_SKILL_CALL_FAILURE.NAME_TAKEN) {
    return `${workspace.name} already has a skill named ${skillName}. Remove one of them first.`;
  }
  return failureLine(failed);
}

/* ----- The dialog ----- */

/** The line under the box. */
export interface DetectedLine {
  readonly text: string;
  readonly tone: typeof STATUS_TONE.NEUTRAL | typeof STATUS_TONE.ATTENTION;
}

/** The failures of a preview that asking again may get past: the service was not reached, or GitHub did not answer. */
const RETRYABLE_FAILURES: ReadonlySet<InstalledSkillCallFailure> = new Set([
  INSTALLED_SKILL_CALL_FAILURE.UNANSWERED,
  INSTALLED_SKILL_CALL_FAILURE.GITHUB_UNANSWERED,
]);

/** Whether a failed preview offers Retry. */
export function previewRetries(failed: { readonly failure: InstalledSkillCallFailure }): boolean {
  return RETRYABLE_FAILURES.has(failed.failure);
}

/**
 * What the line under the box says of a preview, or of its wait: why it
 * failed, a paste we do not install from, or a repository with no skill;
 * nothing where the preview has something to show.
 */
export function previewLine(
  view: InstalledSkillPreview | InstalledSkillFailedView | undefined,
): DetectedLine | undefined {
  if (view === undefined) return { text: SKILLS_LINE.READING, tone: STATUS_TONE.NEUTRAL };
  if ("failure" in view) {
    const text =
      view.failure === INSTALLED_SKILL_CALL_FAILURE.UNANSWERED
        ? readFailedWords("that paste")
        : failureLine(view);
    return { text, tone: STATUS_TONE.ATTENTION };
  }
  if (view.kind === SKILL_PASTE_KIND.UNSUPPORTED) {
    return { text: SKILLS_LINE.UNSUPPORTED, tone: STATUS_TONE.ATTENTION };
  }
  if (view.kind !== SKILL_PASTE_KIND.SOURCE || view.skills.length > 0) return undefined;
  return { text: `No skills found in ${view.owner}/${view.repo}.`, tone: STATUS_TONE.ATTENTION };
}

/** The skills ticked as a preview lands: the ones the paste named, or the one skill there is. */
export function initialTicks(preview: InstalledSkillPreview | undefined): ReadonlySet<string> {
  if (preview?.kind !== SKILL_PASTE_KIND.SOURCE) return new Set();
  return new Set(preview.skills.filter((each) => each.selected).map((each) => each.name));
}

/** Whether a source's list offers a search, as it does once it is long. */
export function searchesSkills(skills: readonly InstalledSkillCandidate[]): boolean {
  return skills.length > SEARCHED_FROM;
}

/** The skills the search shows: each word of it in the name or the description, in any case. */
export function shownSkills(
  skills: readonly InstalledSkillCandidate[],
  query: string,
): readonly InstalledSkillCandidate[] {
  const tokens = searchTokens(query);
  return skills.filter((each) => matchesTokens([each.name, each.description ?? ""], tokens));
}

/** Where a found skill is and how large: "skills/review · 1.2 kB". */
export function candidateFacts(candidate: InstalledSkillCandidate): string {
  const where = candidate.path === "" ? "repository root" : candidate.path;
  return `${where} · ${formatBytes(candidate.bytes)}`;
}

/** The primary button's words: what Install will do. */
export function installLabel(install: readonly string[]): string {
  const [only] = install;
  if (only === undefined) return SKILLS_LINE.INSTALL;
  return install.length === 1 ? `Install ${only}` : `Install ${install.length} skills`;
}

/** The scopes the dialog offers: the account's own, and the workspace's to any member outside a personal workspace. */
export function installScopes(
  workspace: Workspace,
): readonly { readonly value: InstalledSkillScope; readonly label: string }[] {
  const mine = { value: INSTALLED_SKILL_SCOPE.PERSONAL, label: SKILLS_LINE.ONLY_YOU };
  if (workspace.personal === true) return [mine];
  return [mine, { value: INSTALLED_SKILL_SCOPE.WORKSPACE, label: everyoneIn(workspace) }];
}

/** A skill's text's name and description as the dialog's fields hold them. */
export interface TextFill {
  readonly name: string;
  readonly description: string;
}

/** The fields as a text's preview lands: what its frontmatter declares, else empty. */
export function textFill(preview: InstalledSkillPreview | undefined): TextFill {
  if (preview?.kind !== SKILL_PASTE_KIND.TEXT) return { name: "", description: "" };
  return { name: preview.name ?? "", description: preview.description ?? "" };
}

/**
 * The install the dialog's state asks for, or nothing while it would
 * install nothing: a source with nothing ticked, text whose name breaks
 * the rule or whose description is empty, or a preview not yet in. The
 * paste goes again whole, since the service reads it afresh, with the
 * commit the preview pinned.
 */
export function installRequest(state: {
  readonly workspaceId: string;
  readonly text: string;
  readonly scope: InstalledSkillScope;
  readonly preview: InstalledSkillPreview | undefined;
  readonly ticked: ReadonlySet<string>;
  readonly fill: TextFill;
}): InstalledSkillInstallParams | undefined {
  const { workspaceId, text, scope, preview, ticked, fill } = state;
  const base = { text, workspaceId, scope };
  if (preview?.kind === SKILL_PASTE_KIND.SOURCE) {
    const skills = preview.skills.filter((each) => ticked.has(each.name)).map((each) => each.name);
    return skills.length === 0 ? undefined : { ...base, skills, sha: preview.sha };
  }
  if (preview?.kind !== SKILL_PASTE_KIND.TEXT) return undefined;
  const name = fill.name.trim();
  const description = fill.description.trim();
  if (!SKILL_NAME_RULE.test(name) || description === "") return undefined;
  return { ...base, name, description };
}
