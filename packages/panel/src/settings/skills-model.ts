import {
  INSTALLED_SKILL_FILES_REFUSAL,
  INSTALLED_SKILL_PROBLEM,
  INSTALLED_SKILL_STANDING,
  type InstalledSkillCandidate,
  type InstalledSkillFilesRefusal,
  type InstalledSkillPreview,
  type InstalledSkillProblem,
  type InstalledSkillStanding,
  type InstalledSkillSummary,
  SKILL_AUDIT_RISK,
  type SkillAuditRisk,
} from "@luke/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillCallFailure,
  type InstalledSkillInstallParams,
} from "@luke/features/installed-skill-view";
import {
  INSTALLED_SKILL_BOUNDS,
  INSTALLED_SKILL_SCOPE,
  INSTALLED_SKILL_SOURCE,
  type InstalledSkillScope,
  type InstalledSkillSource,
} from "@luke/features/installed-skill-wire";
import { formatBytes, formatExactBytes } from "@luke/features/number-format";
import {
  readSkillFile,
  SKILL_FILE_BOUNDS,
  SKILL_KEY,
  SKILL_NAME_RULE,
} from "@luke/features/skill-file";
import {
  ALL_SKILLS,
  SKILL_PASTE_KIND,
  SKILL_PASTE_UNSUPPORTED,
  type SkillPaste,
  type SkillPasteUnsupportedReason,
} from "@luke/features/skill-paste";
import {
  TASK_SKILL_BOUNDS,
  TASK_SKILL_SOURCE,
  type TaskSkillSource,
} from "@luke/features/task-wire";
import { andList, countWords, readFailedWords, TERM } from "@luke/features/words";
import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { STATUS_TONE, type StatusTone } from "@luke/ui";

/**
 * skills-model.ts -- Settings › Skills and its Add skill dialog as the window draws them, judged without drawing: the rows and their lines, and what a paste would install.
 *
 * The page lists the workspace's skills, then the account's own, the same
 * split the Automations list makes, because whose a skill is decides who
 * may change it and whose agents load it. Each row says where its files
 * came from, a GitHub folder at the commit it is pinned to or a paste, and
 * who installed it. The dialog reads its one box twice: at once, with
 * `parseSkillPaste`, so the member sees what they pasted was understood,
 * and then from the service's preview, which reads GitHub. What it draws
 * of a preview follows `npx skills add`: the screen, the choice and the
 * skills it pulls in, where a skill of each name already stands in the
 * scope chosen, the button's words, and the list's order, groups, and
 * search. Every refusal the service names is said here in plain words, once.
 */

/** How many characters of a commit a row and the dialog show. */
const SHORT_SHA = 7;

/** What the page and the dialog say that no row's data says. */
export const SKILLS_LINE = {
  /** Above the rows: where the rest come from, and when a change reaches an agent. */
  ABOUT:
    "Repository skills come from each repository's .agents/skills folder. Changes here reach only agents started afterwards.",
  PERSONAL: "Only you",
  PASTED: "pasted",
  NONE: "No skills installed yet.",
  READ_FAILED: "Your skills could not be read.",
  ADD_SKILL: "Add skill",
  PASTE_LABEL: "Command, GitHub link, or SKILL.md text",
  PASTE_HINT:
    "Paste an npx skills add command, a GitHub link to a repository or skill folder, or a skill's SKILL.md text.",
  READING: "Reading…",
  INSTALLED: "Installed",
  UPDATE_AVAILABLE: "Update available",
  INSTALL: "Install",
  INSTALL_FOR: "Install for",
  ONLY_YOU: "Only you",
  VIEW: "Open",
  SHARE: "Share with workspace",
  UPDATE: "Update",
  REMOVE: "Remove",
  FILES: "Files",
  VIEW_FAILED: "The skill could not be read.",
  CHANGE: "Change",
  EDIT: "Edit",
  BROWSE: "Browse them",
  SEARCH: "Search skills",
  SELECT_ALL: "Select all",
  VIEW_SKILL_FILE: "View SKILL.md",
  HIDE_SKILL_FILE: "Hide SKILL.md",
  NAME: "Name",
  WHEN: "When should agents use it?",
  DECLARED: "Set in the text's frontmatter. Edit the text to change it.",
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

/** "1 file", "4 files". */
function filesText(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
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
  /** Whether it is read from GitHub, so may have an update. */
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

/** A list with one skill put in place of the one of its id, or the list as it was. */
export function withSkill(
  skills: readonly InstalledSkillSummary[],
  changed: InstalledSkillSummary,
): readonly InstalledSkillSummary[] {
  return skills.map((each) => (each.id === changed.id ? changed : each));
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
 * personal workspace, and Update where a GitHub skill's folder moved; then,
 * a rule apart, Remove. A row the account may not change holds View alone.
 */
export function skillActions(
  row: SkillRow,
  state: {
    readonly workspace: Pick<Workspace, "personal">;
    readonly updateAvailable: boolean;
  },
): readonly (readonly SkillAction[])[] {
  const { skill } = row;
  if (!skill.manageable) return [[SKILL_ACTION.VIEW]];
  const shareable =
    skill.scope === INSTALLED_SKILL_SCOPE.PERSONAL && state.workspace.personal !== true;
  const acts = [
    SKILL_ACTION.VIEW,
    ...(shareable ? [SKILL_ACTION.SHARE] : []),
    ...(state.updateAvailable && row.fromGitHub ? [SKILL_ACTION.UPDATE] : []),
  ];
  return [acts, [SKILL_ACTION.REMOVE]];
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
    verb: "Share",
    running: "Sharing…",
  };
}

/** Why a share was refused: a name the workspace already holds is said for that workspace, the rest as any call says them. */
export function shareFailureLine(
  failed: { readonly failure: InstalledSkillCallFailure },
  skillName: string,
  workspace: Pick<Workspace, "name">,
): string {
  if (failed.failure === INSTALLED_SKILL_CALL_FAILURE.NAME_TAKEN) {
    return `${workspace.name} already has a skill named ${skillName}. Remove one of them first.`;
  }
  return failureLine(failed);
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

/* ----- After an install ----- */

/** How many installed skills the notice names before it counts the rest. */
const NAMED_INSTALLS = 2;

/** "grill-me", "grill-me and grilling", "grill-me, grilling, and 3 more". */
function namesText(names: readonly string[]): string {
  const more = names.length - NAMED_INSTALLS;
  return andList(more <= 0 ? names : [...names.slice(0, NAMED_INSTALLS), `${more} more`]);
}

/**
 * What the page says once an install lands: which skills, one or two by
 * name and the rest counted, and, under it, how to call the first one a
 * member can call, since that is what they will want to do next. Nothing
 * where nothing was installed. Note that a workspace's skill is offered
 * only to agents in that workspace, while a personal one follows its owner
 * into every workspace, so the hint names the workspace for the first.
 */
export function installedNotice(
  made: readonly Pick<InstalledSkillSummary, "name" | "userInvocable" | "scope">[],
  workspace: Pick<Workspace, "name">,
): { readonly words: string; readonly detail?: string } | undefined {
  if (made.length === 0) return undefined;
  const words = `Installed ${namesText(made.map((each) => each.name))}`;
  const callable = made.find((each) => each.userInvocable);
  if (callable === undefined) return { words };
  const where = callable.scope === INSTALLED_SKILL_SCOPE.WORKSPACE ? ` in ${workspace.name}` : "";
  return { words, detail: `Type /${callable.name} in any new agent${where}` };
}

/* ----- Words for what went wrong ----- */

/** Why a skill's files were refused, after its name. */
const FILES_REFUSAL_WORDS = {
  [INSTALLED_SKILL_FILES_REFUSAL.NO_SKILL_FILE]: "has no SKILL.md in its folder.",
  [INSTALLED_SKILL_FILES_REFUSAL.DUPLICATE_PATH]: "holds two files at one path.",
  [INSTALLED_SKILL_FILES_REFUSAL.TOO_MANY_FILES]: `holds more than ${INSTALLED_SKILL_BOUNDS.MAX_FILES} files.`,
  [INSTALLED_SKILL_FILES_REFUSAL.TOO_LARGE]: `is larger than ${formatExactBytes(INSTALLED_SKILL_BOUNDS.MAX_TOTAL_BYTES)} altogether.`,
  [INSTALLED_SKILL_FILES_REFUSAL.SKILL_FILE_INVALID]:
    "needs a valid name and a description in its SKILL.md.",
  [INSTALLED_SKILL_FILES_REFUSAL.SKILL_FILE_TOO_LARGE]: `has a SKILL.md larger than ${formatExactBytes(SKILL_FILE_BOUNDS.MAX_FILE_BYTES)}.`,
  [INSTALLED_SKILL_FILES_REFUSAL.CREDENTIAL_SHAPED]:
    "holds what looks like a credential. A skill must never carry one.",
} as const satisfies Record<InstalledSkillFilesRefusal, string>;

/** Why a call has no answer, where that is all there is to say. */
const FAILURE_WORDS = {
  [INSTALLED_SKILL_CALL_FAILURE.UNANSWERED]: "Luke couldn't reach the service. Try again.",
  [INSTALLED_SKILL_CALL_FAILURE.NOT_FOUND]: "That skill or workspace is no longer yours to reach.",
  [INSTALLED_SKILL_CALL_FAILURE.NOT_PERMITTED]:
    "Only whoever installed this skill, or the workspace's owners and admins, can change it.",
  [INSTALLED_SKILL_CALL_FAILURE.INVALID]: "Luke couldn't install that. Check what you pasted.",
  [INSTALLED_SKILL_CALL_FAILURE.NAME_TAKEN]: "A skill of that name is already installed there.",
  [INSTALLED_SKILL_CALL_FAILURE.FILES_REFUSED]: "The skill's files were refused.",
  [INSTALLED_SKILL_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]:
    "Luke can't reach that repository on GitHub. A private one needs the workspace's GitHub connected.",
  [INSTALLED_SKILL_CALL_FAILURE.REF_NOT_FOUND]:
    "That branch, tag, or commit isn't in the repository.",
  [INSTALLED_SKILL_CALL_FAILURE.GITHUB_UNANSWERED]:
    "GitHub didn't answer, or is limiting requests. Try again in a minute.",
} as const satisfies Record<InstalledSkillCallFailure, string>;

/** What a failed call says: a taken name and refused files name the skill where the service did. */
export function failureLine(failed: {
  readonly failure: InstalledSkillCallFailure;
  readonly skillName?: string;
  readonly skillRefusal?: InstalledSkillFilesRefusal;
}): string {
  const { failure, skillName, skillRefusal } = failed;
  if (failure === INSTALLED_SKILL_CALL_FAILURE.NAME_TAKEN && skillName !== undefined) {
    return `A skill named ${skillName} is already installed there. Remove it first, or install for the other scope.`;
  }
  if (failure === INSTALLED_SKILL_CALL_FAILURE.FILES_REFUSED && skillRefusal !== undefined) {
    return `${skillName ?? "The skill"} ${FILES_REFUSAL_WORDS[skillRefusal]}`;
  }
  return FAILURE_WORDS[failure];
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

/** What a failed preview says under the box: a paste not reached says it could not be read, as every read does, and the rest say why in their own words. */
export function previewFailureLine(failed: {
  readonly failure: InstalledSkillCallFailure;
  readonly skillName?: string;
  readonly skillRefusal?: InstalledSkillFilesRefusal;
}): string {
  return failed.failure === INSTALLED_SKILL_CALL_FAILURE.UNANSWERED
    ? readFailedWords("that paste")
    : failureLine(failed);
}

/** What keeps a found skill from installing, as a short phrase. */
const PROBLEM_WORDS = {
  [INSTALLED_SKILL_PROBLEM.NAME_MISSING]: "No name",
  [INSTALLED_SKILL_PROBLEM.NAME_INVALID]: "Name must be lowercase words joined by hyphens",
  [INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING]: "No description",
  [INSTALLED_SKILL_PROBLEM.DESCRIPTION_TOO_LONG]: `Description over ${TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS} characters`,
  [INSTALLED_SKILL_PROBLEM.FRONTMATTER_UNCLOSED]: "Frontmatter never closed",
  [INSTALLED_SKILL_PROBLEM.TOO_LARGE]: `SKILL.md over ${formatExactBytes(SKILL_FILE_BOUNDS.MAX_FILE_BYTES)}`,
  [INSTALLED_SKILL_PROBLEM.CREDENTIAL_SHAPED]: "Holds what looks like a credential",
  [INSTALLED_SKILL_PROBLEM.TOO_MANY_FILES]: `More than ${INSTALLED_SKILL_BOUNDS.MAX_FILES} files`,
  [INSTALLED_SKILL_PROBLEM.FILES_TOO_LARGE]: `Over ${formatExactBytes(INSTALLED_SKILL_BOUNDS.MAX_TOTAL_BYTES)} of files`,
} as const satisfies Record<InstalledSkillProblem, string>;

/** A skill's problems, joined into one line. */
export function problemsLine(problems: readonly InstalledSkillProblem[]): string {
  return problems.map((problem) => PROBLEM_WORDS[problem]).join(" · ");
}

/** Why a paste is no source Luke installs from. */
const UNSUPPORTED_WORDS = {
  [SKILL_PASTE_UNSUPPORTED.GITLAB]: "Only GitHub sources for now.",
  [SKILL_PASTE_UNSUPPORTED.AZURE_DEVOPS]: "Only GitHub sources for now.",
  [SKILL_PASTE_UNSUPPORTED.OTHER_HOST]: "Only GitHub sources for now.",
  [SKILL_PASTE_UNSUPPORTED.SSH]: "Only GitHub sources for now. Paste the repository as owner/repo.",
  [SKILL_PASTE_UNSUPPORTED.LOCAL_PATH]:
    "Only GitHub sources for now. Paste the skill's text instead.",
  [SKILL_PASTE_UNSUPPORTED.DOWNLOAD_URL]: "Only GitHub sources for now.",
  [SKILL_PASTE_UNSUPPORTED.OTHER_COMMAND]: "Only a skills add command installs a skill.",
  [SKILL_PASTE_UNSUPPORTED.NO_SOURCE]: "That command names no repository.",
  [SKILL_PASTE_UNSUPPORTED.UNREADABLE_SOURCE]: "Luke can't read a GitHub repository from that.",
} as const satisfies Record<SkillPasteUnsupportedReason, string>;

/* ----- The dialog ----- */

/** How a line under the box reads, of the status tones: understood, a wait, or a problem. */
export type DetectedTone =
  | typeof STATUS_TONE.COMPLETE
  | typeof STATUS_TONE.NEUTRAL
  | typeof STATUS_TONE.ATTENTION;

/** The line under the box. */
export interface DetectedLine {
  readonly text: string;
  readonly tone: DetectedTone;
}

/**
 * What the box was read as the moment it changed, before the service says
 * more: the repository a command names, the name a skill's text declares,
 * or why it is nothing Luke installs. Nothing for an empty box.
 */
export function pastedLine(paste: SkillPaste): DetectedLine | undefined {
  switch (paste.kind) {
    case SKILL_PASTE_KIND.EMPTY:
      return undefined;
    case SKILL_PASTE_KIND.UNSUPPORTED:
      return { text: UNSUPPORTED_WORDS[paste.reason], tone: STATUS_TONE.ATTENTION };
    case SKILL_PASTE_KIND.SOURCE:
      return {
        text: `Reading ${paste.owner}/${paste.repo}…`,
        tone: STATUS_TONE.NEUTRAL,
      };
    case SKILL_PASTE_KIND.TEXT:
      return {
        text: `Skill text${paste.name === undefined ? "" : ` · ${paste.name}`} · ${SKILLS_LINE.READING}`,
        tone: STATUS_TONE.NEUTRAL,
      };
  }
}

/** What a preview that leaves nothing to show says under the box: no skill in the repository, or a source Luke does not read. */
export function previewLine(preview: InstalledSkillPreview): DetectedLine | undefined {
  if (preview.kind === SKILL_PASTE_KIND.UNSUPPORTED) {
    return { text: UNSUPPORTED_WORDS[preview.reason], tone: STATUS_TONE.ATTENTION };
  }
  if (preview.kind !== SKILL_PASTE_KIND.SOURCE || preview.skills.length > 0) return undefined;
  return {
    text: `No skills found in ${preview.owner}/${preview.repo} @ ${preview.sha.slice(0, SHORT_SHA)}.`,
    tone: STATUS_TONE.ATTENTION,
  };
}

/** Whether a change to the box came at once, as a paste does, rather than a keystroke at a time; only then does the box fold away once previewed. */
export function pastedAtOnce(previous: string, next: string): boolean {
  return next.length - previous.length > 1;
}

/** Which of the dialog's screens it stands on. */
export const ADD_SKILL_SCREEN = {
  /** The box alone: nothing previewed yet, or a preview with nothing to install. */
  PASTE: "paste",
  /** The skills the paste named, as cards to confirm: the `skills` tool's "Selected N skills", with no picker. */
  CONFIRM: "confirm",
  /** Every skill the repository holds, to search and tick, nothing ticked the paste did not name. */
  BROWSE: "browse",
  /** A skill's own text, its name and description. */
  TEXT: "text",
} as const;

export type AddSkillScreen = (typeof ADD_SKILL_SCREEN)[keyof typeof ADD_SKILL_SCREEN];

/**
 * The screen a preview is drawn on, as `npx skills add` decides between
 * "Selected N skills" and its picker: a paste that named skills, or a
 * repository with one, is confirmed as cards; one that named none, named
 * every one (`--skill '*'`), or named one the repository does not hold is
 * browsed, since the tool lists what there is to pick from. A member who
 * asked to browse the rest browses.
 */
export function addSkillScreen(
  preview: InstalledSkillPreview | undefined,
  paste: SkillPaste,
  browsing: boolean,
): AddSkillScreen {
  if (preview?.kind === SKILL_PASTE_KIND.TEXT) return ADD_SKILL_SCREEN.TEXT;
  if (preview?.kind !== SKILL_PASTE_KIND.SOURCE || preview.skills.length === 0) {
    return ADD_SKILL_SCREEN.PASTE;
  }
  const everyOne = paste.kind === SKILL_PASTE_KIND.SOURCE && paste.skills === ALL_SKILLS;
  const named = preview.skills.some((each) => each.selected);
  const confirms = named && !everyOne && preview.missing.length === 0 && !browsing;
  return confirms ? ADD_SKILL_SCREEN.CONFIRM : ADD_SKILL_SCREEN.BROWSE;
}

/** The dialog's title on each screen: the one skill a paste named, or the repository browsed. */
export function addSkillTitle(
  screen: AddSkillScreen,
  preview: InstalledSkillPreview | undefined,
): string {
  if (preview?.kind !== SKILL_PASTE_KIND.SOURCE) return SKILLS_LINE.ADD_SKILL;
  if (screen === ADD_SKILL_SCREEN.BROWSE) return `Add skills from ${preview.owner}/${preview.repo}`;
  const named = preview.skills.filter((each) => each.selected);
  const [only] = named;
  if (screen !== ADD_SKILL_SCREEN.CONFIRM || only === undefined) return SKILLS_LINE.ADD_SKILL;
  return named.length === 1 ? `Add ${only.name}` : `Add ${named.length} skills`;
}

/** The one line the box folds into once previewed: where the skills come from, or the text's size. */
export function previewSourceLine(screen: AddSkillScreen, preview: InstalledSkillPreview): string {
  if (preview.kind === SKILL_PASTE_KIND.TEXT) return `Pasted text · ${formatBytes(preview.bytes)}`;
  if (preview.kind !== SKILL_PASTE_KIND.SOURCE) return "";
  const where = `${preview.owner}/${preview.repo} @ ${preview.sha.slice(0, SHORT_SHA)}`;
  return screen === ADD_SKILL_SCREEN.BROWSE
    ? `${where} · ${countWords(preview.skills.length, TERM.SKILL)}`
    : `From ${where}`;
}

/** "No skill named grill-mee in mattpocock/skills. Pick from its 38 skills.", for names the paste asked for that no folder holds. */
export function missingLine(preview: InstalledSkillPreview): string | undefined {
  if (preview.kind !== SKILL_PASTE_KIND.SOURCE || preview.missing.length === 0) return undefined;
  const names = preview.missing.join(", ");
  const noun = preview.missing.length === 1 ? "skill" : "skills";
  return `No ${noun} named ${names} in ${preview.owner}/${preview.repo}. Pick from its ${countWords(preview.skills.length, TERM.SKILL)}.`;
}

/** "36 other skills in this repository", under the cards. */
export function othersLine(count: number): string {
  return `${count} other ${count === 1 ? "skill" : "skills"} in this repository`;
}

/** What a found skill holds and where: "2 files · 0.4 kB · skills/productivity/grill-me". */
export function candidateFacts(candidate: InstalledSkillCandidate): string {
  const where = candidate.path === "" ? "repository root" : candidate.path;
  return `${filesText(candidate.fileCount)} · ${formatBytes(candidate.bytes)} · ${where}`;
}

/** Whether a found skill may be ticked at all: one with problems never installs. */
function tickable(candidate: InstalledSkillCandidate): boolean {
  return candidate.problems.length === 0;
}

/** The skill of its name already installed in a scope, by how an install there would meet it; nothing where none is. */
function standingIn(
  candidate: InstalledSkillCandidate,
  scope: InstalledSkillScope,
): InstalledSkillStanding | undefined {
  return candidate.installed?.find((each) => each.scope === scope)?.standing;
}

/**
 * Whether a found skill would install into a scope. Note that the store
 * keeps one skill of a name in each scope and refuses a second whatever its
 * source, so any skill of its name there keeps it out: one already current
 * needs nothing, one whose folder moved is brought up to date from the
 * Skills page's Update, and another source's holds the name.
 */
export function installable(
  candidate: InstalledSkillCandidate,
  scope: InstalledSkillScope,
): boolean {
  return tickable(candidate) && standingIn(candidate, scope) === undefined;
}

/** One mark beside a found skill's name. */
export interface SkillMark {
  readonly text: string;
  readonly tone: StatusTone;
}

/** The skills.sh partners the `skills` tool names, by the key skills.sh answers under. */
const SKILL_AUDIT_PARTNER = {
  GEN: "ath",
  SOCKET: "socket",
  SNYK: "snyk",
} as const;

/** Each known partner's name, in the order the `skills` tool lists them. */
const PARTNER_NAMES: ReadonlyMap<string, string> = new Map([
  [SKILL_AUDIT_PARTNER.GEN, "Gen"],
  [SKILL_AUDIT_PARTNER.SOCKET, "Socket"],
  [SKILL_AUDIT_PARTNER.SNYK, "Snyk"],
]);

/** A partner's rating in a word or two. */
const RISK_WORDS = {
  [SKILL_AUDIT_RISK.SAFE]: "safe",
  [SKILL_AUDIT_RISK.LOW]: "low risk",
  [SKILL_AUDIT_RISK.MEDIUM]: "medium risk",
  [SKILL_AUDIT_RISK.HIGH]: "high risk",
  [SKILL_AUDIT_RISK.CRITICAL]: "critical risk",
  [SKILL_AUDIT_RISK.UNKNOWN]: "unrated",
} as const satisfies Record<SkillAuditRisk, string>;

/** The ratings marked as a warning. */
const WARNING_RISKS: ReadonlySet<SkillAuditRisk> = new Set([
  SKILL_AUDIT_RISK.HIGH,
  SKILL_AUDIT_RISK.CRITICAL,
]);

/** One partner's rating as the card says it: "Snyk high risk", a warning where it is high or critical. */
export interface AuditPart {
  readonly text: string;
  readonly warn: boolean;
}

/**
 * skills.sh's ratings of a skill, each partner's in a word or two: Gen,
 * Socket, and Snyk first as the `skills` tool lists them, any other by its
 * key after. Advisory only: a rating never keeps a skill from installing.
 */
export function auditParts(candidate: InstalledSkillCandidate): readonly AuditPart[] {
  const audit = candidate.audit;
  if (audit === undefined) return [];
  const known = [...PARTNER_NAMES.keys()];
  const keys = Object.keys(audit).sort((one, other) => {
    const rank = (key: string) => (known.includes(key) ? known.indexOf(key) : known.length);
    return rank(one) - rank(other) || one.localeCompare(other);
  });
  return keys.flatMap((key) => {
    const rating = audit[key];
    if (rating === undefined) return [];
    const partner = PARTNER_NAMES.get(key) ?? key;
    return [
      { text: `${partner} ${RISK_WORDS[rating.risk]}`, warn: WARNING_RISKS.has(rating.risk) },
    ];
  });
}

/** The scope a taken name is taken in, as the Skills page heads its group. */
function scopeName(scope: InstalledSkillScope, workspace: Pick<Workspace, "name">): string {
  return scope === INSTALLED_SKILL_SCOPE.WORKSPACE
    ? workspaceGroupTitle(workspace)
    : SKILLS_LINE.PERSONAL;
}

/**
 * The marks beside a found skill's name for the scope chosen: where a skill
 * of its name already stands there, and whether it ships scripts. Its
 * ratings are `auditParts`, drawn beside them.
 */
export function candidateMarks(
  candidate: InstalledSkillCandidate,
  scope: InstalledSkillScope,
  workspace: Pick<Workspace, "name">,
): readonly SkillMark[] {
  const marks: SkillMark[] = [];
  const standing = standingIn(candidate, scope);
  if (standing === INSTALLED_SKILL_STANDING.CURRENT) {
    marks.push({ text: SKILLS_LINE.INSTALLED, tone: STATUS_TONE.COMPLETE });
  } else if (standing === INSTALLED_SKILL_STANDING.UPDATE) {
    marks.push({ text: SKILLS_LINE.UPDATE_AVAILABLE, tone: STATUS_TONE.WORKING });
  } else if (standing === INSTALLED_SKILL_STANDING.TAKEN) {
    marks.push({
      text: `Name taken in ${scopeName(scope, workspace)}`,
      tone: STATUS_TONE.ATTENTION,
    });
  }
  if (candidate.hasScripts === true) marks.push({ text: "scripts", tone: STATUS_TONE.NEUTRAL });
  return marks;
}

/** What a found skill's card or row says under it where it will not install: its problems, or what to do instead. */
export function candidateNote(
  candidate: InstalledSkillCandidate,
  scope: InstalledSkillScope,
): DetectedLine | undefined {
  if (!tickable(candidate)) {
    return { text: problemsLine(candidate.problems), tone: STATUS_TONE.ATTENTION };
  }
  const standing = standingIn(candidate, scope);
  if (standing === INSTALLED_SKILL_STANDING.UPDATE) {
    return { text: "Update it from the Skills page instead.", tone: STATUS_TONE.NEUTRAL };
  }
  if (standing === INSTALLED_SKILL_STANDING.TAKEN) {
    return {
      text: `Another skill named ${candidate.name} is installed there. Remove it first, or install for the other scope.`,
      tone: STATUS_TONE.NEUTRAL,
    };
  }
  return undefined;
}

/**
 * What the member chose: the skills they ticked, and the ones a ticked
 * skill pulls in that they unticked. Both are kept whatever the scope, so
 * switching Install for and back, or browsing and back, loses no choice.
 */
export interface SkillTicks {
  readonly ticked: ReadonlySet<string>;
  readonly declined: ReadonlySet<string>;
}

/** The choice as a preview lands: the skills the paste asked for that may install, and nothing declined. */
export function initialTicks(preview: InstalledSkillPreview | undefined): SkillTicks {
  const ticked =
    preview?.kind === SKILL_PASTE_KIND.SOURCE
      ? preview.skills.filter((each) => each.selected && tickable(each)).map((each) => each.name)
      : [];
  return { ticked: new Set(ticked), declined: new Set() };
}

/** What Install would do with the member's choice. */
export interface InstallPlan {
  /** The skills it sends, in order: the ticked ones, then those they pull in. */
  readonly install: readonly string[];
  /** Each skill a ticked skill's references reach that is not itself ticked, by the skill that hands off to it first. */
  readonly pulled: ReadonlyMap<string, string>;
}

/**
 * The skills the member's choice installs into a scope. A ticked skill
 * pulls in every other skill of the repository its `SKILL.md` names, and
 * each of those the skills it names in turn, unless the member unticked
 * it; a skill that will not install there is listed as reached but neither
 * sent nor followed further. The `skills` tool has no such step: a skill
 * that hands off to another works only with it, so it comes along, ticked
 * and in sight.
 */
export function installPlan(
  skills: readonly InstalledSkillCandidate[],
  ticks: SkillTicks,
  scope: InstalledSkillScope,
): InstallPlan {
  const byName = new Map(skills.map((each) => [each.name, each]));
  const roots = skills.filter((each) => ticks.ticked.has(each.name) && installable(each, scope));
  const install = roots.map((each) => each.name);
  const pulled = new Map<string, string>();
  const queue = [...roots];
  // Note that a for-of over an array reads its length at every step, so what is pushed is visited too.
  for (const from of queue) {
    for (const name of from.references ?? []) {
      const to = byName.get(name);
      if (to === undefined || ticks.ticked.has(name) || pulled.has(name)) continue;
      pulled.set(name, from.name);
      if (ticks.declined.has(name) || !installable(to, scope)) continue;
      install.push(name);
      queue.push(to);
    }
  }
  return { install, pulled };
}

/**
 * The choice once one skill is ticked or unticked. Ticking one a ticked
 * skill pulls in takes back its untick; unticking one a ticked skill still
 * pulls in records the untick, so it stays out.
 */
export function withTick(
  skills: readonly InstalledSkillCandidate[],
  ticks: SkillTicks,
  scope: InstalledSkillScope,
  name: string,
  on: boolean,
): SkillTicks {
  const ticked = new Set(ticks.ticked);
  const declined = new Set(ticks.declined);
  if (on) {
    declined.delete(name);
    if (!installPlan(skills, { ticked, declined }, scope).install.includes(name)) ticked.add(name);
  } else {
    ticked.delete(name);
    if (installPlan(skills, { ticked, declined }, scope).install.includes(name)) declined.add(name);
  }
  return { ticked, declined };
}

/**
 * The choice once every one of some skills is ticked, or every one
 * unticked: Select all over what the search shows. Note that Select all
 * ticks each skill itself, so one it shows that another pulls in stays
 * ticked when that other is unticked later.
 */
export function withEvery(
  skills: readonly InstalledSkillCandidate[],
  ticks: SkillTicks,
  scope: InstalledSkillScope,
  names: readonly string[],
  on: boolean,
): SkillTicks {
  if (!on) return names.reduce((held, name) => withTick(skills, held, scope, name, false), ticks);
  const ticked = new Set([...ticks.ticked, ...names]);
  const declined = new Set([...ticks.declined].filter((name) => !names.includes(name)));
  return { ticked, declined };
}

/** Select all's box over the skills shown that may install: ticked once every one is, mixed while some are. */
export function everyTicked(
  names: readonly string[],
  install: readonly string[],
): { readonly checked: boolean; readonly mixed: boolean } {
  const ticked = names.filter((name) => install.includes(name)).length;
  return {
    checked: names.length > 0 && ticked === names.length,
    mixed: ticked > 0 && ticked < names.length,
  };
}

/** The primary button's words: what Install will do. */
export function installLabel(install: readonly string[]): string {
  const [only] = install;
  if (only === undefined) return SKILLS_LINE.INSTALL;
  return install.length === 1 ? `Install ${only}` : `Install ${install.length} skills`;
}

/** One skill a confirmed skill pulls in, and the skill that hands off to it. */
export interface PulledSkill {
  readonly candidate: InstalledSkillCandidate;
  readonly by: string;
}

/** What the confirm screen shows: a card for each skill the paste named, the skills they pull in, and how many more the repository holds. */
export interface ConfirmView {
  readonly cards: readonly InstalledSkillCandidate[];
  readonly pulled: readonly PulledSkill[];
  readonly others: number;
}

/** The confirm screen's cards for a source's preview and the plan the choice makes. */
export function confirmView(
  skills: readonly InstalledSkillCandidate[],
  plan: InstallPlan,
): ConfirmView {
  const cards = skills.filter((each) => each.selected);
  const pulled = [...plan.pulled].flatMap(([name, by]) => {
    const candidate = skills.find((each) => each.name === name);
    return candidate === undefined || candidate.selected ? [] : [{ candidate, by }];
  });
  return { cards, pulled, others: skills.length - cards.length - pulled.length };
}

/** Why a pulled-in skill comes along, under its name: "grill-me hands off to it · Runs the interview". */
export function pulledLine(pulled: PulledSkill): string {
  const why = `${pulled.by} hands off to it`;
  return pulled.candidate.description === undefined
    ? why
    : `${why} · ${pulled.candidate.description}`;
}

/** The heading of skills no plugin manifest groups, where others are grouped. */
const UNGROUPED = "Other";

/** One heading of the browse list and the skills under it; no heading where the repository groups none. */
export interface SkillListGroup {
  readonly title: string | undefined;
  readonly skills: readonly InstalledSkillCandidate[];
}

/** Whether a skill answers the search: its name or its description holds the words, in any case. */
function answers(candidate: InstalledSkillCandidate, query: string): boolean {
  const words = query.trim().toLocaleLowerCase();
  if (words === "") return true;
  return (
    candidate.name.toLocaleLowerCase().includes(words) ||
    (candidate.description?.toLocaleLowerCase().includes(words) ?? false)
  );
}

/**
 * The browse list as the `skills` tool's picker sorts it: by name, and
 * under the plugin a `.claude-plugin` manifest groups each in only where the
 * repository groups any, the rest under Other, last; never by folder. A
 * group the search leaves empty is left out.
 */
export function skillList(
  skills: readonly InstalledSkillCandidate[],
  query: string,
): readonly SkillListGroup[] {
  const shown = skills
    .filter((each) => answers(each, query))
    .sort((one, other) => one.name.localeCompare(other.name));
  if (!skills.some((each) => each.group !== undefined)) {
    return shown.length === 0 ? [] : [{ title: undefined, skills: shown }];
  }
  const groups = new Map<string, InstalledSkillCandidate[]>();
  for (const each of shown) {
    const title = each.group ?? UNGROUPED;
    groups.set(title, [...(groups.get(title) ?? []), each]);
  }
  return [...groups.entries()]
    .sort(([one], [other]) =>
      one === UNGROUPED ? 1 : other === UNGROUPED ? -1 : one.localeCompare(other),
    )
    .map(([title, grouped]) => ({ title, skills: grouped }));
}

/** The problem a refused file names, where the preview has a word for it. */
const REFUSAL_PROBLEM: Partial<Record<InstalledSkillFilesRefusal, InstalledSkillProblem>> = {
  [INSTALLED_SKILL_FILES_REFUSAL.CREDENTIAL_SHAPED]: INSTALLED_SKILL_PROBLEM.CREDENTIAL_SHAPED,
  [INSTALLED_SKILL_FILES_REFUSAL.TOO_MANY_FILES]: INSTALLED_SKILL_PROBLEM.TOO_MANY_FILES,
  [INSTALLED_SKILL_FILES_REFUSAL.TOO_LARGE]: INSTALLED_SKILL_PROBLEM.FILES_TOO_LARGE,
  [INSTALLED_SKILL_FILES_REFUSAL.SKILL_FILE_TOO_LARGE]: INSTALLED_SKILL_PROBLEM.TOO_LARGE,
};

/**
 * A source's preview once an install refused one of its skills' files:
 * that skill carries the problem, so it can no longer be ticked. Note that
 * the preview reads every skill's `SKILL.md` but only the asked-for skills'
 * other files, which spares a large repository's read limit; the install
 * reads them all, so a refusal there is how a problem in a skill nobody
 * asked for first shows. A refusal the preview has no word for leaves it as
 * it was.
 */
export function withRefusal(
  preview: InstalledSkillPreview,
  failed: { readonly skillName?: string; readonly skillRefusal?: InstalledSkillFilesRefusal },
): InstalledSkillPreview {
  const problem =
    failed.skillRefusal === undefined ? undefined : REFUSAL_PROBLEM[failed.skillRefusal];
  if (preview.kind !== SKILL_PASTE_KIND.SOURCE || problem === undefined) return preview;
  return {
    ...preview,
    skills: preview.skills.map((each) =>
      each.name === failed.skillName && !each.problems.includes(problem)
        ? { ...each, problems: [...each.problems, problem] }
        : each,
    ),
  };
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

/** The fields as a text's preview lands: its name and description, or one suggested from its heading, else empty. */
export function textFill(preview: InstalledSkillPreview | undefined): TextFill {
  if (preview?.kind !== SKILL_PASTE_KIND.TEXT) return { name: "", description: "" };
  return { name: preview.name ?? "", description: preview.description ?? "" };
}

/** Which of a text's name and description its own frontmatter declares. */
export interface TextDeclares {
  readonly name: boolean;
  readonly description: boolean;
}

/**
 * Which fields a skill's text declares itself. Note that the service
 * refuses a name or description that contradicts the text's own
 * frontmatter, so a declared one is shown as it stands and changed by
 * editing the text; one the text lacks, a name suggested from its heading
 * among them, is the member's to type.
 */
export function textDeclares(paste: SkillPaste): TextDeclares {
  if (paste.kind !== SKILL_PASTE_KIND.TEXT) return { name: false, description: false };
  const keys = readSkillFile(paste.markdown)?.keys;
  const declared = (key: string) => (keys?.get(key)?.trim() ?? "") !== "";
  return { name: declared(SKILL_KEY.NAME), description: declared(SKILL_KEY.DESCRIPTION) };
}

/** The problems of a name, and of a description, which the member's own field answers where the text declares neither. */
const NAME_PROBLEMS: ReadonlySet<InstalledSkillProblem> = new Set([
  INSTALLED_SKILL_PROBLEM.NAME_MISSING,
  INSTALLED_SKILL_PROBLEM.NAME_INVALID,
]);
const DESCRIPTION_PROBLEMS: ReadonlySet<InstalledSkillProblem> = new Set([
  INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING,
  INSTALLED_SKILL_PROBLEM.DESCRIPTION_TOO_LONG,
]);

/** What still keeps a skill's text from installing once the member's fields are read in place of what the text lacks. */
export function textProblems(
  problems: readonly InstalledSkillProblem[],
  fill: TextFill,
  declares: TextDeclares,
): readonly InstalledSkillProblem[] {
  const name = fill.name.trim();
  const description = fill.description.trim();
  const left = problems.filter(
    (problem) =>
      !(!declares.name && NAME_PROBLEMS.has(problem)) &&
      !(!declares.description && DESCRIPTION_PROBLEMS.has(problem)),
  );
  if (!declares.name) {
    if (name === "") left.push(INSTALLED_SKILL_PROBLEM.NAME_MISSING);
    else if (!SKILL_NAME_RULE.test(name)) left.push(INSTALLED_SKILL_PROBLEM.NAME_INVALID);
  }
  if (!declares.description) {
    if (description === "") left.push(INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING);
    else if (description.length > TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS) {
      left.push(INSTALLED_SKILL_PROBLEM.DESCRIPTION_TOO_LONG);
    }
  }
  return left;
}

/**
 * The install the dialog's state asks for, or nothing while it would
 * install nothing: a source whose plan installs nothing, text with a
 * problem left, or a preview not yet in. The paste goes again whole, since
 * the service reads it afresh; a source names the skills the plan
 * installs, and text the name and description the member's fields hold
 * where the text declares neither.
 */
export function installRequest(state: {
  readonly workspaceId: string;
  readonly text: string;
  readonly scope: InstalledSkillScope;
  readonly preview: InstalledSkillPreview | undefined;
  readonly install: readonly string[];
  readonly fill: TextFill;
  readonly declares: TextDeclares;
}): InstalledSkillInstallParams | undefined {
  const { workspaceId, text, scope, preview, install, fill, declares } = state;
  const base = { text, workspaceId, scope };
  if (preview?.kind === SKILL_PASTE_KIND.SOURCE) {
    return install.length === 0 ? undefined : { ...base, skills: [...install] };
  }
  if (preview?.kind !== SKILL_PASTE_KIND.TEXT) return undefined;
  if (textProblems(preview.problems, fill, declares).length > 0) return undefined;
  return {
    ...base,
    ...(declares.name ? undefined : { name: fill.name.trim() }),
    ...(declares.description ? undefined : { description: fill.description.trim() }),
  };
}
