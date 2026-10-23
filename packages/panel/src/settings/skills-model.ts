import {
  INSTALLED_SKILL_FILES_REFUSAL,
  INSTALLED_SKILL_PROBLEM,
  type InstalledSkillCandidate,
  type InstalledSkillFilesRefusal,
  type InstalledSkillPreview,
  type InstalledSkillProblem,
  type InstalledSkillSummary,
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
import { SKILL_FILE_BOUNDS, SKILL_NAME_RULE } from "@luke/features/skill-file";
import {
  SKILL_PASTE_KIND,
  SKILL_PASTE_UNSUPPORTED,
  type SkillPaste,
  type SkillPasteUnsupportedReason,
} from "@luke/features/skill-paste";
import { TASK_SKILL_BOUNDS } from "@luke/features/task-wire";
import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";

/**
 * skills-model.ts -- Settings › Skills and its Add skill dialog as the window draws them, judged without drawing: the rows and their lines, and what a paste would install.
 *
 * The page lists the workspace's skills, then the account's own, the same
 * split the Automations list makes, because whose a skill is decides who
 * may change it and whose agents load it. Each row says where its files
 * came from, a GitHub folder at the commit it is pinned to or a paste, and
 * who installed it. The dialog reads its one box twice: at once, with
 * `parseSkillPaste`, so the member sees what they pasted was understood,
 * and then from the service's preview, which reads GitHub. Every refusal
 * the service names is said here in plain words, once.
 */

/** How many characters of a commit a row and the dialog show. */
const SHORT_SHA = 7;

const BYTES_PER_KB = 1024;

/** What the page and the dialog say that no row's data says. */
export const SKILLS_LINE = {
  /** Above the rows: where the rest come from, and when a change reaches an agent. */
  ABOUT:
    "Repository skills come from each repository's .agents/skills folder. Changes here reach only agents started afterwards.",
  PERSONAL: "Personal",
  WORKSPACE_BADGE: "Workspace",
  PERSONAL_BADGE: "Personal",
  PASTED: "pasted",
  NONE: "No skills installed yet.",
  READ_FAILED: "Your skills could not be read.",
  PASTE_LABEL: "Paste an npx skills add command or a skill's text",
  READING: "Reading…",
  INSTALL_FOR: "Install for",
  JUST_ME: "Just me",
  VIEW: "View",
  SHARE: "Share with workspace",
  UPDATE: "Update",
  REMOVE: "Remove",
  FILES: "Files",
  VIEW_FAILED: "The skill could not be read.",
} as const;

/** The workspace's group heading. */
export function workspaceGroupTitle(workspace: Pick<Workspace, "name">): string {
  return workspace.name;
}

/** "Everyone in Stage": the dialog's workspace scope, named for the workspace. */
export function everyoneIn(workspace: Pick<Workspace, "name">): string {
  return `Everyone in ${workspace.name}`;
}

/** A size as a line says it: bytes under a kilobyte, kilobytes to one place under ten, else whole. */
export function sizeText(bytes: number): string {
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  const kb = bytes / BYTES_PER_KB;
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
}

/** "1 file", "4 files". */
function filesText(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

/** Where a skill's files came from: `owner/repo @ 3f9c2e1`, or Pasted. */
export function sourceLine(source: InstalledSkillSource): string {
  if (source.type === INSTALLED_SKILL_SOURCE.TEXT) return SKILLS_LINE.PASTED;
  return `${source.owner}/${source.repo} @ ${source.sha.slice(0, SHORT_SHA)}`;
}

/* ----- The page ----- */

/** One skill's row as the page draws it. */
export interface SkillRow {
  readonly skill: InstalledSkillSummary;
  /** The badge beside its name. */
  readonly badge: string;
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

/** One skill's row: its badge and its line, the source then who installed it. */
function rowOf(
  skill: InstalledSkillSummary,
  readerId: string | undefined,
  members: readonly WorkspaceMember[] | undefined,
): SkillRow {
  const workspace = skill.scope === INSTALLED_SKILL_SCOPE.WORKSPACE;
  const installer = workspace ? installerOf(skill, readerId, members) : undefined;
  return {
    skill,
    badge: workspace ? SKILLS_LINE.WORKSPACE_BADGE : SKILLS_LINE.PERSONAL_BADGE,
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
  if (names.length <= NAMED_INSTALLS) return names.join(" and ");
  const named = names.slice(0, NAMED_INSTALLS).join(", ");
  return `${named}, and ${names.length - NAMED_INSTALLS} more`;
}

/**
 * What the page says once an install lands: which skills, one or two by
 * name and the rest counted, and, under it, how to call the first one a
 * member can call, since that is what they will want to do next. Nothing
 * where nothing was installed.
 */
export function installedNotice(
  made: readonly Pick<InstalledSkillSummary, "name" | "userInvocable">[],
): { readonly words: string; readonly detail?: string } | undefined {
  if (made.length === 0) return undefined;
  const words = `Installed ${namesText(made.map((each) => each.name))}`;
  const callable = made.find((each) => each.userInvocable);
  return callable === undefined
    ? { words }
    : { words, detail: `Type /${callable.name} in any new agent` };
}

/* ----- Words for what went wrong ----- */

/** Why a skill's files were refused, after its name. */
const FILES_REFUSAL_WORDS = {
  [INSTALLED_SKILL_FILES_REFUSAL.NO_SKILL_FILE]: "has no SKILL.md in its folder.",
  [INSTALLED_SKILL_FILES_REFUSAL.DUPLICATE_PATH]: "holds two files at one path.",
  [INSTALLED_SKILL_FILES_REFUSAL.TOO_MANY_FILES]: `holds more than ${INSTALLED_SKILL_BOUNDS.MAX_FILES} files.`,
  [INSTALLED_SKILL_FILES_REFUSAL.TOO_LARGE]: `is larger than ${sizeText(INSTALLED_SKILL_BOUNDS.MAX_TOTAL_BYTES)} altogether.`,
  [INSTALLED_SKILL_FILES_REFUSAL.SKILL_FILE_INVALID]:
    "needs a valid name and a description in its SKILL.md.",
  [INSTALLED_SKILL_FILES_REFUSAL.SKILL_FILE_TOO_LARGE]: `has a SKILL.md larger than ${sizeText(SKILL_FILE_BOUNDS.MAX_FILE_BYTES)}.`,
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

/** What keeps a found skill from installing, as a short phrase. */
const PROBLEM_WORDS = {
  [INSTALLED_SKILL_PROBLEM.NAME_MISSING]: "No name",
  [INSTALLED_SKILL_PROBLEM.NAME_INVALID]: "Name must be lowercase words joined by hyphens",
  [INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING]: "No description",
  [INSTALLED_SKILL_PROBLEM.DESCRIPTION_TOO_LONG]: `Description over ${TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS} characters`,
  [INSTALLED_SKILL_PROBLEM.FRONTMATTER_UNCLOSED]: "Frontmatter never closed",
  [INSTALLED_SKILL_PROBLEM.TOO_LARGE]: `SKILL.md over ${sizeText(SKILL_FILE_BOUNDS.MAX_FILE_BYTES)}`,
  [INSTALLED_SKILL_PROBLEM.CREDENTIAL_SHAPED]: "Holds what looks like a credential",
  [INSTALLED_SKILL_PROBLEM.TOO_MANY_FILES]: `More than ${INSTALLED_SKILL_BOUNDS.MAX_FILES} files`,
  [INSTALLED_SKILL_PROBLEM.FILES_TOO_LARGE]: `Over ${sizeText(INSTALLED_SKILL_BOUNDS.MAX_TOTAL_BYTES)} of files`,
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

/** How a line under the box reads: understood, a wait, or a problem. */
export const DETECTED_TONE = {
  DETECTED: "detected",
  WAITING: "waiting",
  PROBLEM: "problem",
} as const;

export type DetectedTone = (typeof DETECTED_TONE)[keyof typeof DETECTED_TONE];

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
      return { text: UNSUPPORTED_WORDS[paste.reason], tone: DETECTED_TONE.PROBLEM };
    case SKILL_PASTE_KIND.SOURCE:
      return {
        text: `GitHub ${paste.owner}/${paste.repo} · ${SKILLS_LINE.READING}`,
        tone: DETECTED_TONE.WAITING,
      };
    case SKILL_PASTE_KIND.TEXT:
      return {
        text: `Skill text${paste.name === undefined ? "" : ` · ${paste.name}`} · ${SKILLS_LINE.READING}`,
        tone: DETECTED_TONE.WAITING,
      };
  }
}

/** "3 skills", "1 skill". */
function skillsText(count: number): string {
  return count === 1 ? "1 skill" : `${count} skills`;
}

/** What the service's preview says the box would install, as the line under it. */
export function previewLine(preview: InstalledSkillPreview): DetectedLine | undefined {
  switch (preview.kind) {
    case SKILL_PASTE_KIND.EMPTY:
      return undefined;
    case SKILL_PASTE_KIND.UNSUPPORTED:
      return { text: UNSUPPORTED_WORDS[preview.reason], tone: DETECTED_TONE.PROBLEM };
    case SKILL_PASTE_KIND.SOURCE: {
      const where = `${preview.owner}/${preview.repo} @ ${preview.sha.slice(0, SHORT_SHA)}`;
      if (preview.skills.length === 0) {
        return { text: `No skills found in ${where}.`, tone: DETECTED_TONE.PROBLEM };
      }
      return {
        text: `Detected: ${skillsText(preview.skills.length)} in ${where}`,
        tone: DETECTED_TONE.DETECTED,
      };
    }
    case SKILL_PASTE_KIND.TEXT:
      return {
        text: `Detected: skill text${preview.name === undefined ? "" : ` · ${preview.name}`} · ${sizeText(preview.bytes)}`,
        tone: DETECTED_TONE.DETECTED,
      };
  }
}

/** The line under a found skill: what it does and how large it is, or what keeps it from installing. */
export function candidateLine(candidate: InstalledSkillCandidate): string {
  if (candidate.problems.length > 0) return problemsLine(candidate.problems);
  const size = `${filesText(candidate.fileCount)}, ${sizeText(candidate.bytes)}`;
  return candidate.description === undefined ? size : `${candidate.description} · ${size}`;
}

/** "Not in the repository: x, y", for names the paste asked for that no folder holds. */
export function missingLine(missing: readonly string[]): string | undefined {
  return missing.length === 0 ? undefined : `Not in the repository: ${missing.join(", ")}`;
}

/** Whether a found skill may be ticked: one with problems never installs. */
export function tickable(candidate: InstalledSkillCandidate): boolean {
  return candidate.problems.length === 0;
}

/** The skills ticked as a preview lands: those the paste asked for that may install. */
export function initialTicks(preview: InstalledSkillPreview): ReadonlySet<string> {
  if (preview.kind !== SKILL_PASTE_KIND.SOURCE) return new Set();
  return new Set(
    preview.skills.filter((each) => each.selected && tickable(each)).map((each) => each.name),
  );
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
  const mine = { value: INSTALLED_SKILL_SCOPE.PERSONAL, label: SKILLS_LINE.JUST_ME };
  if (workspace.personal === true) return [mine];
  return [mine, { value: INSTALLED_SKILL_SCOPE.WORKSPACE, label: everyoneIn(workspace) }];
}

/** What the member typed beside a skill's text: a name where it has none, a description where it has none. */
export interface TextFill {
  readonly name: string;
  readonly description: string;
}

/** Which of a skill's text's fields the dialog asks for, from the service's preview of it. */
export function textFields(preview: InstalledSkillPreview): {
  readonly name: boolean;
  readonly description: boolean;
} {
  if (preview.kind !== SKILL_PASTE_KIND.TEXT) return { name: false, description: false };
  return {
    name: preview.problems.includes(INSTALLED_SKILL_PROBLEM.NAME_MISSING),
    description: preview.problems.includes(INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING),
  };
}

/** The problems a typed name or description mends, which no longer keep the text from installing. */
const FILLED_PROBLEMS: ReadonlySet<InstalledSkillProblem> = new Set([
  INSTALLED_SKILL_PROBLEM.NAME_MISSING,
  INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING,
]);

/** What still keeps a skill's text from installing once the member's fields are read. */
export function textProblems(
  problems: readonly InstalledSkillProblem[],
  fill: TextFill,
): readonly InstalledSkillProblem[] {
  const name = fill.name.trim();
  const description = fill.description.trim();
  const left = problems.filter((problem) => !FILLED_PROBLEMS.has(problem));
  if (problems.includes(INSTALLED_SKILL_PROBLEM.NAME_MISSING)) {
    if (name === "") left.push(INSTALLED_SKILL_PROBLEM.NAME_MISSING);
    else if (!SKILL_NAME_RULE.test(name)) left.push(INSTALLED_SKILL_PROBLEM.NAME_INVALID);
  }
  if (problems.includes(INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING)) {
    if (description === "") left.push(INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING);
    else if (description.length > TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS) {
      left.push(INSTALLED_SKILL_PROBLEM.DESCRIPTION_TOO_LONG);
    }
  }
  return left;
}

/**
 * The install the dialog's state asks for, or nothing while it would
 * install nothing: a source with no skill ticked, text with a problem left,
 * or a preview not yet in. The paste goes again whole, since the service
 * reads it afresh; a source names the skills ticked, and text the name and
 * description the member typed where it lacks them.
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
    const skills = preview.skills
      .filter((each) => tickable(each) && ticked.has(each.name))
      .map((each) => each.name);
    return skills.length === 0 ? undefined : { ...base, skills };
  }
  if (preview?.kind !== SKILL_PASTE_KIND.TEXT) return undefined;
  if (textProblems(preview.problems, fill).length > 0) return undefined;
  const asks = textFields(preview);
  return {
    ...base,
    ...(asks.name ? { name: fill.name.trim() } : undefined),
    ...(asks.description ? { description: fill.description.trim() } : undefined),
  };
}
