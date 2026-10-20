/**
 * task-issue-tools.ts -- the issues an agent links to a task, unlinks, and relates, as `create_task` and `update_task` take them: each named as a person would paste it, and read from its provider before it is linked.
 *
 * An agent names an issue as it reads one: a GitHub issue as
 * `owner/name#N`, `#N` of the task's own repository, or a link to its
 * page, and a Linear issue by its key, `ENG-123`, or a link to its page,
 * each with the keyword the task's pull requests write of it, `closes`
 * where none is named. The words are read into what New task names an issue
 * by (`taskIssueChoiceSchema`), and the issue is read through the
 * workspace's own GitHub installation or Linear connection as the task page's
 * link reads it (`tasks/task-issue-links.ts`), so what is kept is the
 * provider's and never the agent's. A link, an unlink, or a relation the
 * agent names an issue the task does not link by is refused with nothing
 * written, as is an issue its provider does not answer for; every refusal is
 * words the model can act on.
 */

import {
  linkTaskIssue,
  type NewTaskIssueLink,
  relateTaskIssue,
  type TaskIssueLink,
  unlinkTaskIssue,
} from "@luke/database/models/task-issue-store";
import { githubIssueRefIn } from "@luke/features/github-repositories-wire";
import { linearIssueIdentifierIn } from "@luke/features/linear-wire";
import {
  sameIssueChoice,
  TASK_ISSUE_PROVIDER,
  type TaskIssueChoice,
  type TaskIssueRelation,
  taskIssueRelationSchema,
} from "@luke/features/task-issue-wire";
import { TASK_BOUNDS } from "@luke/features/task-wire";
import { describeWire } from "@luke/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { HOSTED_API_ERROR } from "../http/http.js";
import type { HostedRefusal } from "../http/http-effect.js";
import { linkedIssue } from "../tasks/task-issue-links.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";

/** The most characters one issue's name may spell: a link to its page with room to spare. */
const MAX_ISSUE_NAME_CHARS = 500;

/** How an issue is named to a tool, in the words its schema describes. */
const ISSUE_NAMED =
  "A GitHub issue as owner/name#N, #N of the task's repository, or a link to it; or a Linear " +
  "issue by its key (ENG-123) or a link to it.";

/** One issue as a tool takes it: its name, and the keyword the task's pull requests write of it. */
const TASK_ISSUE_ITEM = Schema.Struct({
  issue: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(MAX_ISSUE_NAME_CHARS)),
    ISSUE_NAMED,
  ),
  relation: Schema.optionalKey(
    describeWire(
      taskIssueRelationSchema,
      "closes where the task does the whole issue, so its pull request settles it as it merges; " +
        "part_of where it does only some. closes where left out.",
    ),
  ),
});

export type TaskIssueItem = typeof TASK_ISSUE_ITEM.Type;

/** Issues to link, as `create_task` and `update_task` take them. */
export const TASK_ISSUES_TO_LINK = describeWire(
  Schema.Array(TASK_ISSUE_ITEM).check(Schema.isMaxLength(TASK_BOUNDS.MAX_ISSUES)),
  `Issues to link, at most ${TASK_BOUNDS.MAX_ISSUES} to a task, each read from GitHub or Linear ` +
    "through the workspace's own connection, with which keyword its pull requests write of it.",
);

/** Issues the task links to let go, by name. */
export const TASK_ISSUES_TO_UNLINK = describeWire(
  Schema.Array(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(MAX_ISSUE_NAME_CHARS)),
  ).check(Schema.isMaxLength(TASK_BOUNDS.MAX_ISSUES)),
  `Issues the task links to unlink, each named as ${AGENT_TOOL.READ_TASK} answers its key, or as ` +
    "a link to it; the issue itself stays as it is.",
);

/** Links of the task whose keyword changes, by name. */
export const TASK_ISSUES_TO_RELATE = describeWire(
  Schema.Array(
    Schema.Struct({
      issue: describeWire(
        Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(MAX_ISSUE_NAME_CHARS)),
        `An issue the task links, named as ${AGENT_TOOL.READ_TASK} answers its key, or as a link to it.`,
      ),
      relation: describeWire(taskIssueRelationSchema, "closes or part_of."),
    }),
  ).check(Schema.isMaxLength(TASK_BOUNDS.MAX_ISSUES)),
  "Issues the task links whose keyword changes: closes, or part_of.",
);

/** Why an issue was not linked, unlinked, or related, in words the model can act on. */
export const TASK_ISSUE_REFUSAL = {
  UNNAMED: (named: string) =>
    `Not run: ${JSON.stringify(named)} names no issue. ${ISSUE_NAMED} Name each once.`,
  NOT_FOUND: (named: string) =>
    `Not run: no issue ${JSON.stringify(named)} could be read through the workspace's GitHub ` +
    "installation, which must reach its repository and be granted Issues, or its Linear.",
  LINEAR: (named: string) =>
    `Not run: the workspace's Linear could not read ${JSON.stringify(named)}: none is ` +
    "connected, its grant was refused, or it holds no such issue.",
  NOT_LINKED: (named: string) =>
    `Not run: the task links no issue ${JSON.stringify(named)}; ${AGENT_TOOL.READ_TASK} names ` +
    "the issues it links.",
  FULL: `Not run: a task links at most ${TASK_BOUNDS.MAX_ISSUES} issues; unlink one first.`,
  UNREAD:
    "Not run: GitHub or Linear did not answer for an issue, or the store could not be reached. " +
    "The call may be made again.",
} as const;

/** The issue words name, as New task names one, with the relation given; nothing for words that name none. */
function issueChoiceOf(
  named: string,
  repository: string | null,
  relation?: TaskIssueItem["relation"],
): TaskIssueChoice | undefined {
  const related = relation === undefined ? undefined : { relation };
  const github = githubIssueRefIn(named, repository);
  if (github !== undefined) return { provider: TASK_ISSUE_PROVIDER.GITHUB, ...github, ...related };
  const linear = linearIssueIdentifierIn(named);
  return linear === undefined
    ? undefined
    : { provider: TASK_ISSUE_PROVIDER.LINEAR, id: linear, ...related };
}

/** Whether a link of the task is the issue a choice names: the same number of the same repository, or the same Linear key. */
function linkNamed(link: TaskIssueLink, choice: TaskIssueChoice): boolean {
  if (choice.provider === TASK_ISSUE_PROVIDER.LINEAR) {
    return link.provider === TASK_ISSUE_PROVIDER.LINEAR && link.key.toUpperCase() === choice.id;
  }
  return (
    link.provider === TASK_ISSUE_PROVIDER.GITHUB &&
    link.number === choice.number &&
    link.repository?.toLowerCase() === choice.repository.toLowerCase()
  );
}

/** Each item's words read as the issue it names, each named once; the refusal's words for the first that names none or names one twice. */
export function issueChoicesOf(
  items: readonly TaskIssueItem[],
  repository: string | null,
): Result.Result<readonly TaskIssueChoice[], string> {
  const choices: TaskIssueChoice[] = [];
  for (const item of items) {
    const choice = issueChoiceOf(item.issue, repository, item.relation);
    if (choice === undefined || choices.some((each) => sameIssueChoice(each, choice))) {
      return Result.fail(TASK_ISSUE_REFUSAL.UNNAMED(item.issue));
    }
    choices.push(choice);
  }
  return Result.succeed(choices);
}

/** A provider's refusal of an issue in the model's words. */
function readRefusalWords(refusal: HostedRefusal, named: string): string {
  if (refusal.error === HOSTED_API_ERROR.NOT_FOUND) return TASK_ISSUE_REFUSAL.NOT_FOUND(named);
  if (refusal.error === HOSTED_API_ERROR.LINEAR_UNAVAILABLE) {
    return TASK_ISSUE_REFUSAL.LINEAR(named);
  }
  return TASK_ISSUE_REFUSAL.UNREAD;
}

/**
 * Every issue the choices name, read from its provider through the
 * workspace, in order, before anything is written; the refusal's words for
 * the first its provider does not answer for.
 */
export const readIssueChoices = (
  organizationId: string,
  items: readonly TaskIssueItem[],
  choices: readonly TaskIssueChoice[],
) =>
  Effect.gen(function* () {
    const read: NewTaskIssueLink[] = [];
    for (const [index, choice] of choices.entries()) {
      const one = yield* Effect.result(linkedIssue(organizationId, choice));
      if (Result.isFailure(one)) {
        return Result.fail(readRefusalWords(one.failure, items[index]?.issue ?? ""));
      }
      read.push(one.success);
    }
    return Result.succeed<readonly NewTaskIssueLink[]>(read);
  });

/** A task's links as a tool answers them: what each is called, its page, and the keyword its pull requests write. */
export function issuesAnswered(links: readonly TaskIssueLink[]) {
  return links.map(({ provider, key, title, url, relation }) => ({
    provider,
    key,
    title,
    url,
    relation,
  }));
}

/** What a task's change asks of its links, as `update_task` names it. */
export interface TaskIssueChangesAsked {
  readonly linkIssues?: readonly TaskIssueItem[] | undefined;
  readonly unlinkIssues?: readonly string[] | undefined;
  readonly relateIssues?: readonly { issue: string; relation: TaskIssueRelation }[] | undefined;
}

/** A task's links to change, every issue to link read already: the links to let go and to relate, by id, and the issues to link. */
export interface TaskIssueChanges {
  readonly unlink: readonly string[];
  readonly relate: readonly { readonly linkId: string; readonly relation: TaskIssueRelation }[];
  readonly link: readonly NewTaskIssueLink[];
}

/** Whether a change of a task's links changes nothing, every one already standing. */
export function issueChangesStand(changes: TaskIssueChanges): boolean {
  return changes.unlink.length === 0 && changes.relate.length === 0 && changes.link.length === 0;
}

/** The link of the task the words name, or the refusal's words where they name none or one it does not link. */
function namedLink(
  links: readonly TaskIssueLink[],
  named: string,
  repository: string | null,
): Result.Result<TaskIssueLink, string> {
  const choice = issueChoiceOf(named, repository);
  if (choice === undefined) return Result.fail(TASK_ISSUE_REFUSAL.UNNAMED(named));
  const link = links.find((each) => linkNamed(each, choice));
  return link === undefined
    ? Result.fail(TASK_ISSUE_REFUSAL.NOT_LINKED(named))
    : Result.succeed(link);
}

/**
 * The change a call asks of a task's links, against the links it holds,
 * `#N` naming an issue it links of the repository it stands on now and an
 * issue to link of the one it stands on once the call changes it:
 * each issue to unlink or relate found among them, each issue to link that
 * it does not link yet read from its provider, and one it links already
 * related where the call names another keyword for it; or the refusal's
 * words, nothing written, where any is named wrong, read for none, or the
 * task would link more than a task may.
 */
export const issueChangesOf = (
  organizationId: string,
  links: readonly TaskIssueLink[],
  repositories: { readonly standing: string | null; readonly changed: string | null },
  asked: TaskIssueChangesAsked,
) =>
  Effect.gen(function* () {
    const unlink: string[] = [];
    for (const named of asked.unlinkIssues ?? []) {
      const link = namedLink(links, named, repositories.standing);
      if (Result.isFailure(link)) return Result.fail(link.failure);
      if (!unlink.includes(link.success.id)) unlink.push(link.success.id);
    }
    const relate: { linkId: string; relation: TaskIssueRelation }[] = [];
    const relating = (link: TaskIssueLink, relation: TaskIssueRelation) => {
      if (relation !== link.relation && !unlink.includes(link.id)) {
        relate.push({ linkId: link.id, relation });
      }
    };
    for (const { issue, relation } of asked.relateIssues ?? []) {
      const link = namedLink(links, issue, repositories.standing);
      if (Result.isFailure(link)) return Result.fail(link.failure);
      relating(link.success, relation);
    }
    const linkItems = asked.linkIssues ?? [];
    const choices = issueChoicesOf(linkItems, repositories.changed);
    if (Result.isFailure(choices)) return Result.fail(choices.failure);
    const fresh: { item: TaskIssueItem; choice: TaskIssueChoice }[] = [];
    for (const [index, choice] of choices.success.entries()) {
      const item = linkItems[index];
      if (item === undefined) continue;
      const standing = links.find((each) => linkNamed(each, choice));
      if (standing === undefined) fresh.push({ item, choice });
      else if (choice.relation !== undefined) relating(standing, choice.relation);
    }
    if (links.length - unlink.length + fresh.length > TASK_BOUNDS.MAX_ISSUES) {
      return Result.fail(TASK_ISSUE_REFUSAL.FULL);
    }
    const read = yield* readIssueChoices(
      organizationId,
      fresh.map(({ item }) => item),
      fresh.map(({ choice }) => choice),
    );
    if (Result.isFailure(read)) return Result.fail(read.failure);
    return Result.succeed<TaskIssueChanges>({ unlink, relate, link: read.success });
  });

/**
 * A task's links changed as asked, as its member: the links let go first,
 * then the keywords, then the issues linked, each refused as the store
 * refuses it; one linked meanwhile by another hand stands as it is.
 */
export const writeIssueChanges = (userId: string, taskId: string, changes: TaskIssueChanges) =>
  Effect.gen(function* () {
    for (const linkId of changes.unlink) yield* unlinkTaskIssue(userId, taskId, linkId);
    for (const { linkId, relation } of changes.relate) {
      yield* relateTaskIssue(userId, taskId, linkId, relation);
    }
    for (const link of changes.link) {
      yield* linkTaskIssue(userId, taskId, link).pipe(
        Effect.catchTag("TaskIssueLinked", () => Effect.succeed(Option.none())),
      );
    }
  });
