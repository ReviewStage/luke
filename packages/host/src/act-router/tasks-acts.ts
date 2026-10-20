import type { CodingAgentMessagesAnswerView } from "@luke/features/coding-agent-view";
import type {
  CodeLines,
  TasksCommentActParams,
  TasksCommentAnswer,
  TasksCommentStartParams,
  TasksCommentsAnswer,
  TasksCommentsParams,
  TasksFileAnswer,
  TasksFileParams,
  TasksIssueAnswer,
  TasksIssueParams,
  TasksMessagesParams,
  TasksPageAnswer,
  TasksPageParams,
  TasksPageSourceAnswer,
  TasksPagesAnswer,
  TasksPagesParams,
  TasksPictureAnswer,
  TasksPictureKeepAnswer,
  TasksPictureKeepParams,
  TasksPictureParams,
  TasksPullRequestAnswer,
  TasksPullRequestParams,
  TasksRevisionAnswer,
  TasksRevisionParams,
  TasksRevisionsAnswer,
  TasksRevisionsParams,
  TasksSetStandingParams,
  TasksSkillsAnswer,
  TasksSkillsParams,
  TasksTreeAnswer,
  TasksTreeParams,
} from "@luke/features/tasks-view";
import { Effect } from "effect";
import { ACT, ACT_KIND } from "../acts.js";
import { ActRefused, type ActRows, type ActSender } from "./router.js";

/**
 * tasks-acts.ts -- the Tasks tab's reads of a task's content, and a task's status and priority: the panel's asks of the host about what one task holds.
 *
 * The task list and the open task's lifecycle ride the act port
 * (`act-port/tasks-procedures.ts`).
 *
 * The one check these rows make is who asked. Only a panel draws the
 * Tasks tab, and the takeover and the hidden voice window draw no task, so
 * every row refuses them. What the host does with an ask — which task is
 * active, what the service answers — is the host's to
 * decide, and comes back as the panel's own answer. Nothing is held here.
 */
export interface TasksActsDependencies {
  host: {
    tasksSetStanding(params: TasksSetStandingParams): Effect.Effect<boolean>;
    tasksWorkEarlier(): Effect.Effect<void>;
    tasksConversationEarlier(): Effect.Effect<void>;
    tasksMessages(params: TasksMessagesParams): Effect.Effect<CodingAgentMessagesAnswerView>;
    tasksFile(params: TasksFileParams): Effect.Effect<TasksFileAnswer>;
    tasksTree(params: TasksTreeParams): Effect.Effect<TasksTreeAnswer>;
    tasksSkills(params: TasksSkillsParams): Effect.Effect<TasksSkillsAnswer>;
    tasksPullRequest(params: TasksPullRequestParams): Effect.Effect<TasksPullRequestAnswer>;
    tasksIssue(params: TasksIssueParams): Effect.Effect<TasksIssueAnswer>;
    tasksRevisions(params: TasksRevisionsParams): Effect.Effect<TasksRevisionsAnswer>;
    tasksRevision(params: TasksRevisionParams): Effect.Effect<TasksRevisionAnswer>;
    tasksRestore(params: TasksRevisionParams): Effect.Effect<boolean>;
    tasksPage(params: TasksPageParams): Effect.Effect<TasksPageAnswer>;
    tasksPages(params: TasksPagesParams): Effect.Effect<TasksPagesAnswer>;
    tasksPicture(params: TasksPictureParams): Effect.Effect<TasksPictureAnswer>;
    tasksPictureKeep(params: TasksPictureKeepParams): Effect.Effect<TasksPictureKeepAnswer>;
    tasksComments(params: TasksCommentsParams): Effect.Effect<TasksCommentsAnswer>;
    tasksCommentStart(params: TasksCommentStartParams): Effect.Effect<TasksCommentAnswer>;
    tasksCommentAct(params: TasksCommentActParams): Effect.Effect<TasksCommentAnswer>;
  };
  /** A transcript's fenced block coloured as its fence's language, by the highlighter the File tab's lines are coloured with. */
  colourCode: (language: string, code: string) => Effect.Effect<CodeLines>;
}

export type TasksActKind =
  | typeof ACT_KIND.TASKS_SET_STANDING
  | typeof ACT_KIND.TASKS_WORK_EARLIER
  | typeof ACT_KIND.TASKS_CONVERSATION_EARLIER
  | typeof ACT_KIND.TASKS_MESSAGES
  | typeof ACT_KIND.TASKS_FILE
  | typeof ACT_KIND.TASKS_TREE
  | typeof ACT_KIND.TASKS_SKILLS
  | typeof ACT_KIND.TASKS_PULL_REQUEST
  | typeof ACT_KIND.TASKS_ISSUE
  | typeof ACT_KIND.TASKS_COLOUR_CODE
  | typeof ACT_KIND.TASKS_REVISIONS
  | typeof ACT_KIND.TASKS_REVISION
  | typeof ACT_KIND.TASKS_RESTORE
  | typeof ACT_KIND.TASKS_PAGE_SOURCE
  | typeof ACT_KIND.TASKS_PAGES
  | typeof ACT_KIND.TASKS_PICTURE_READ
  | typeof ACT_KIND.TASKS_PICTURE_KEEP
  | typeof ACT_KIND.TASKS_COMMENTS
  | typeof ACT_KIND.TASKS_COMMENT_START
  | typeof ACT_KIND.TASKS_COMMENT_ACT;

/**
 * The longest page whose source the row colours. Note that a longer one is
 * drawn plain rather than cut, as a transcript's long block is, because
 * colouring holds the host's thread for about a millisecond per hundred
 * characters.
 */
const PAGE_SOURCE_COLOURED_MAX_CHARS = 64 * 1024;

/** The refusal a window that draws no Tasks tab hears, in its kind's own words. */
function refuseUnlessPanel(kind: TasksActKind, sender: ActSender): void {
  if (!sender.panel) {
    throw new ActRefused({ message: ACT[kind].refusal });
  }
}

/** A page's HTML as its tab's source draws it: line by line, coloured as HTML where it is short enough to colour, plain past that. */
function pageSourceLines(
  html: string,
  colourCode: TasksActsDependencies["colourCode"],
): Effect.Effect<CodeLines> {
  if (html.length <= PAGE_SOURCE_COLOURED_MAX_CHARS) return colourCode("html", html);
  return Effect.succeed(html.split("\n").map((text) => (text === "" ? [] : [{ text }])));
}

export function tasksActRows(dependencies: TasksActsDependencies): Pick<ActRows, TasksActKind> {
  const { host } = dependencies;
  return {
    [ACT_KIND.TASKS_SET_STANDING]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_SET_STANDING, sender);
      return host.tasksSetStanding(params);
    },
    [ACT_KIND.TASKS_WORK_EARLIER]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_WORK_EARLIER, sender);
      return host.tasksWorkEarlier();
    },
    [ACT_KIND.TASKS_CONVERSATION_EARLIER]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_CONVERSATION_EARLIER, sender);
      return host.tasksConversationEarlier();
    },
    [ACT_KIND.TASKS_MESSAGES]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_MESSAGES, sender);
      return host.tasksMessages(params);
    },
    [ACT_KIND.TASKS_FILE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_FILE, sender);
      return host.tasksFile(params);
    },
    [ACT_KIND.TASKS_TREE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_TREE, sender);
      return host.tasksTree(params);
    },
    [ACT_KIND.TASKS_SKILLS]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_SKILLS, sender);
      return host.tasksSkills(params);
    },
    // A service that did not answer is refused, so a link draws what it holds
    // rather than reading the silence as no pull request.
    [ACT_KIND.TASKS_PULL_REQUEST]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_PULL_REQUEST, sender);
      return Effect.flatMap(host.tasksPullRequest(params), (answer) =>
        "pullRequest" in answer
          ? Effect.succeed(answer.pullRequest)
          : Effect.fail(new ActRefused({ message: ACT[ACT_KIND.TASKS_PULL_REQUEST].refusal })),
      );
    },
    // Likewise an issue: a service that did not answer is refused, never read as no issue.
    [ACT_KIND.TASKS_ISSUE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_ISSUE, sender);
      return Effect.flatMap(host.tasksIssue(params), (answer) =>
        "issue" in answer
          ? Effect.succeed(answer.issue)
          : Effect.fail(new ActRefused({ message: ACT[ACT_KIND.TASKS_ISSUE].refusal })),
      );
    },
    [ACT_KIND.TASKS_COLOUR_CODE]: ({ language, code }, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_COLOUR_CODE, sender);
      return dependencies.colourCode(language, code);
    },
    [ACT_KIND.TASKS_REVISIONS]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_REVISIONS, sender);
      return host.tasksRevisions(params);
    },
    [ACT_KIND.TASKS_REVISION]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_REVISION, sender);
      return host.tasksRevision(params);
    },
    [ACT_KIND.TASKS_RESTORE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_RESTORE, sender);
      return host.tasksRestore(params);
    },
    // Note that the picture's answer, a failure among them, is the panel's to
    // read, as a workspace photo's is, because a picture that hears none
    // draws its words rather than a refusal.
    [ACT_KIND.TASKS_PICTURE_READ]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_PICTURE_READ, sender);
      return host.tasksPicture(params);
    },
    // A refusal is the editor's to say on the picture, with its retry, so it is answered rather than refused.
    [ACT_KIND.TASKS_COMMENTS]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_COMMENTS, sender);
      return host.tasksComments(params);
    },
    // A refused comment is the thread's to say, with its retry, so it is answered rather than refused.
    [ACT_KIND.TASKS_COMMENT_START]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_COMMENT_START, sender);
      return host.tasksCommentStart(params);
    },
    [ACT_KIND.TASKS_COMMENT_ACT]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_COMMENT_ACT, sender);
      return host.tasksCommentAct(params);
    },
    [ACT_KIND.TASKS_PICTURE_KEEP]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_PICTURE_KEEP, sender);
      return host.tasksPictureKeep(params);
    },
    // The version is read as its frame reads it and held nowhere here, so its HTML reaches the tab that asked alone.
    [ACT_KIND.TASKS_PAGE_SOURCE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_PAGE_SOURCE, sender);
      return Effect.flatMap(
        host.tasksPage(params),
        (answer): Effect.Effect<TasksPageSourceAnswer> =>
          "page" in answer
            ? Effect.map(pageSourceLines(answer.page.html, dependencies.colourCode), (lines) => ({
                lines,
              }))
            : Effect.succeed(answer),
      );
    },
    [ACT_KIND.TASKS_PAGES]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TASKS_PAGES, sender);
      return host.tasksPages(params);
    },
  };
}
