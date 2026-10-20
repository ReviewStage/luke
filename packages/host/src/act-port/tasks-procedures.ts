/**
 * tasks-procedures.ts -- the Tasks tab's asks of the host about the task list, the open task, and what a task holds.
 *
 * The one check these procedures make is who asked. Only a panel draws the
 * Tasks tab, and the takeover and the hidden voice window draw no task, so
 * every one refuses them, in its own sentence. What the host does with an
 * ask (which task is active, what the service answers) is the host's to
 * decide, and comes back as the panel's own answer. Nothing is held here.
 */

import type { CodingAgentMessagesAnswerView } from "@luke/features/coding-agent-view";
import {
  type CodeLines,
  GITHUB_DISCONNECT_FAILURE,
  type TasksArchiveParams,
  type TasksBoardSaveParams,
  type TasksCommentActParams,
  type TasksCommentAnswer,
  type TasksCommentStartParams,
  type TasksCommentsAnswer,
  type TasksCommentsParams,
  type TasksEditAnswer,
  type TasksEditParams,
  type TasksFileAnswer,
  type TasksFileParams,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubPageAnswer,
  type TasksIssueAnswer,
  type TasksIssueParams,
  type TasksMessagesParams,
  type TasksMoveAnswer,
  type TasksMoveParams,
  type TasksPageAnswer,
  type TasksPageParams,
  type TasksPageSourceAnswer,
  type TasksPagesAnswer,
  type TasksPagesParams,
  type TasksPictureAnswer,
  type TasksPictureKeepAnswer,
  type TasksPictureKeepParams,
  type TasksPictureParams,
  type TasksPinParams,
  type TasksPinRepositoryParams,
  type TasksPullRequestAnswer,
  type TasksPullRequestParams,
  type TasksRenameParams,
  type TasksRepositoriesAnswer,
  type TasksRepositoriesParams,
  type TasksRevisionAnswer,
  type TasksRevisionParams,
  type TasksRevisionsAnswer,
  type TasksRevisionsParams,
  type TasksSetRepositoryAnswer,
  type TasksSetRepositoryParams,
  type TasksSetStandingParams,
  type TasksSkillsAnswer,
  type TasksSkillsParams,
  type TasksStartAnswer,
  type TasksStartRequest,
  type TasksTreeAnswer,
  type TasksTreeParams,
  type TasksWriteSectionParams,
} from "@luke/features/tasks-view";
import { Effect } from "effect";
import { GITHUB_LAST_SIGN_IN_REFUSAL } from "../acts.js";
import { TASKS_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";

/** What the task procedures are handed: the host, and the doors of the window's process they open or read. */
export interface TasksProceduresDependencies {
  host: {
    tasksRefresh(): Effect.Effect<void>;
    tasksOpen(taskId: string): Effect.Effect<boolean>;
    tasksClose(): Effect.Effect<void>;
    tasksDelete(taskId: string): Effect.Effect<boolean>;
    tasksRename(params: TasksRenameParams): Effect.Effect<boolean>;
    tasksPin(params: TasksPinParams): Effect.Effect<boolean>;
    tasksPinRepository(params: TasksPinRepositoryParams): Effect.Effect<boolean>;
    tasksWriteSection(params: TasksWriteSectionParams): Effect.Effect<boolean>;
    tasksArchive(params: TasksArchiveParams): Effect.Effect<boolean>;
    tasksStart(request: TasksStartRequest): Effect.Effect<TasksStartAnswer>;
    tasksRepositories(params: TasksRepositoriesParams): Effect.Effect<TasksRepositoriesAnswer>;
    tasksSetRepository(params: TasksSetRepositoryParams): Effect.Effect<TasksSetRepositoryAnswer>;
    tasksMove(params: TasksMoveParams): Effect.Effect<TasksMoveAnswer>;
    tasksEdit(params: TasksEditParams): Effect.Effect<TasksEditAnswer>;
    tasksBoardSave(params: TasksBoardSaveParams): Effect.Effect<void>;
    githubConnect(): Effect.Effect<TasksGitHubPageAnswer>;
    githubDisconnect(): Effect.Effect<TasksGitHubDisconnectAnswer>;
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
  /** Opens an address in the browser; `github.open`'s schema admits GitHub's addresses alone, `web.open`'s any http or https one. */
  openExternal: (url: string) => Promise<void>;
  /** The hosted service's origin, without a trailing slash, the only origin a page the host names may open on. */
  serviceBaseUrl: string;
  /** The task the panel has open, as the bridge's side holds the host's view of it. */
  activeTaskId: () => string | undefined;
  /** Tells the voice window, which owns the call, that the task's microphone was pressed. */
  talkAboutTask: (taskId: string) => void;
  /** Whether a call could open now: voice set up and the microphone already granted, so opening one asks the developer nothing. */
  voiceReady: () => boolean;
  /** Whether a call is in progress, which a start leaves standing for the panel to ask about moving. */
  callStanding: () => boolean;
}

/** The refusal a window that draws no Tasks tab hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

/**
 * The longest page whose source the procedure colours. Note that a longer
 * one is drawn plain rather than cut, as a transcript's long block is,
 * because colouring holds the host's thread for about a millisecond per
 * hundred characters.
 */
const PAGE_SOURCE_COLOURED_MAX_CHARS = 64 * 1024;

/** A page's HTML as its tab's source draws it: line by line, coloured as HTML where it is short enough to colour, plain past that. */
function pageSourceLines(
  html: string,
  colourCode: TasksProceduresDependencies["colourCode"],
): Effect.Effect<CodeLines> {
  if (html.length <= PAGE_SOURCE_COLOURED_MAX_CHARS) return colourCode("html", html);
  return Effect.succeed(html.split("\n").map((text) => (text === "" ? [] : [{ text }])));
}

/** Whether an address the host answered parses and stands on the service's own origin. */
function isServicePage(url: string, serviceBaseUrl: string): boolean {
  return URL.canParse(url) && new URL(url).origin === new URL(serviceBaseUrl).origin;
}

export function tasksProcedures(dependencies: TasksProceduresDependencies) {
  const { host, openExternal } = dependencies;
  return {
    [TASKS_ACT_KIND.TASKS_REFRESH]: actPort[TASKS_ACT_KIND.TASKS_REFRESH].effect(function* ({
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.tasksRefresh();
    }),
    [TASKS_ACT_KIND.TASKS_SELECT]: actPort[TASKS_ACT_KIND.TASKS_SELECT].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksOpen(input.taskId);
    }),
    [TASKS_ACT_KIND.TASKS_CLOSE]: actPort[TASKS_ACT_KIND.TASKS_CLOSE].effect(function* ({
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.tasksClose();
    }),
    // Note that a started task opens its call at once, because pressing
    // Start task is the developer's gesture and Luke opens a new task by
    // greeting it; where the call would first have to ask for the
    // microphone, the task's own microphone button asks instead, and where
    // a call already stands the panel asks whether to end it first. A task
    // started without planning opens no call, since skipping the call is
    // what that start asked for, and nor does one started with an agent,
    // which starts it without planning.
    [TASKS_ACT_KIND.TASKS_START]: actPort[TASKS_ACT_KIND.TASKS_START].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const calls = input.planning !== false && input.agent === undefined;
      const answer = yield* host.tasksStart(input);
      if (
        calls &&
        "planId" in answer &&
        dependencies.voiceReady() &&
        !dependencies.callStanding()
      ) {
        dependencies.talkAboutTask(answer.planId);
      }
      return answer;
    }),
    [TASKS_ACT_KIND.TASKS_DELETE]: actPort[TASKS_ACT_KIND.TASKS_DELETE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksDelete(input.taskId);
    }),
    [TASKS_ACT_KIND.TASKS_RENAME]: actPort[TASKS_ACT_KIND.TASKS_RENAME].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksRename(input);
    }),
    [TASKS_ACT_KIND.TASKS_PIN]: actPort[TASKS_ACT_KIND.TASKS_PIN].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksPin(input);
    }),
    [TASKS_ACT_KIND.TASKS_PIN_REPOSITORY]: actPort[TASKS_ACT_KIND.TASKS_PIN_REPOSITORY].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksPinRepository(input);
      },
    ),
    [TASKS_ACT_KIND.TASKS_WRITE_SECTION]: actPort[TASKS_ACT_KIND.TASKS_WRITE_SECTION].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksWriteSection(input);
      },
    ),
    [TASKS_ACT_KIND.TASKS_ARCHIVE]: actPort[TASKS_ACT_KIND.TASKS_ARCHIVE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksArchive(input);
    }),
    [TASKS_ACT_KIND.TASKS_REPOSITORIES]: actPort[TASKS_ACT_KIND.TASKS_REPOSITORIES].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksRepositories(input);
      },
    ),
    [TASKS_ACT_KIND.TASKS_SET_REPOSITORY]: actPort[TASKS_ACT_KIND.TASKS_SET_REPOSITORY].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksSetRepository(input);
      },
    ),
    [TASKS_ACT_KIND.TASKS_MOVE]: actPort[TASKS_ACT_KIND.TASKS_MOVE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksMove(input);
    }),
    [TASKS_ACT_KIND.TASKS_EDIT]: actPort[TASKS_ACT_KIND.TASKS_EDIT].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksEdit(input);
    }),
    // The address is GitHub's by the act's own schema, so what opens is a
    // repository's page or the App's installation page and nothing else.
    [TASKS_ACT_KIND.GITHUB_OPEN]: actPort[TASKS_ACT_KIND.GITHUB_OPEN].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* Effect.tryPromise({
        try: () => openExternal(input.url),
        catch: () => errors.REFUSED(),
      });
    }),
    // The address is an http or https one by the act's own schema, so it
    // opens in the browser and never in a file's or another app's handler.
    [TASKS_ACT_KIND.WEB_OPEN]: actPort[TASKS_ACT_KIND.WEB_OPEN].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* Effect.tryPromise({
        try: () => openExternal(input.url),
        catch: () => errors.REFUSED(),
      });
    }),
    // The address of the page is the service's own, named by the host and
    // never one a window handed in, so the act carries none. Note that a
    // page off the service's own origin is refused, because the answer is
    // any string and the opener would hand a `file:` or custom-scheme
    // address to whatever handles it.
    [TASKS_ACT_KIND.GITHUB_CONNECT]: actPort[TASKS_ACT_KIND.GITHUB_CONNECT].effect(function* ({
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const page = yield* host.githubConnect();
      if (!("url" in page) || !isServicePage(page.url, dependencies.serviceBaseUrl)) {
        return yield* Effect.fail(errors.REFUSED());
      }
      const { url } = page;
      yield* Effect.tryPromise({ try: () => openExternal(url), catch: () => errors.REFUSED() });
    }),
    // Disconnecting asks the host, which asks the service under the Mac's
    // session; no page opens, so no browser account stands in for the Mac's.
    [TASKS_ACT_KIND.GITHUB_DISCONNECT]: actPort[TASKS_ACT_KIND.GITHUB_DISCONNECT].effect(
      function* ({ context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const answer = yield* host.githubDisconnect();
        if ("connection" in answer) return;
        return yield* Effect.fail(
          answer.failure === GITHUB_DISCONNECT_FAILURE.NOT_PERMITTED
            ? errors.REFUSED({ message: GITHUB_LAST_SIGN_IN_REFUSAL })
            : errors.REFUSED(),
        );
      },
    ),
    // The press names no task: the task is the one the host has open, read
    // here, so the panel cannot open a call about a task it is not showing.
    [TASKS_ACT_KIND.TASKS_TALK]: actPort[TASKS_ACT_KIND.TASKS_TALK].effect(function* ({
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const taskId = dependencies.activeTaskId();
      if (taskId === undefined) return yield* Effect.fail(errors.REFUSED());
      dependencies.talkAboutTask(taskId);
    }),
    [TASKS_ACT_KIND.TASKS_BOARD_SAVE]: actPort[TASKS_ACT_KIND.TASKS_BOARD_SAVE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.tasksBoardSave(input);
    }),
    [TASKS_ACT_KIND.TASKS_SET_STANDING]: actPort[TASKS_ACT_KIND.TASKS_SET_STANDING].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksSetStanding(input);
      },
    ),
    [TASKS_ACT_KIND.TASKS_WORK_EARLIER]: actPort[TASKS_ACT_KIND.TASKS_WORK_EARLIER].effect(
      function* ({ context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        yield* host.tasksWorkEarlier();
      },
    ),
    [TASKS_ACT_KIND.TASKS_CONVERSATION_EARLIER]: actPort[
      TASKS_ACT_KIND.TASKS_CONVERSATION_EARLIER
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.tasksConversationEarlier();
    }),
    [TASKS_ACT_KIND.TASKS_MESSAGES]: actPort[TASKS_ACT_KIND.TASKS_MESSAGES].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksMessages(input);
    }),
    [TASKS_ACT_KIND.TASKS_FILE]: actPort[TASKS_ACT_KIND.TASKS_FILE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksFile(input);
    }),
    [TASKS_ACT_KIND.TASKS_TREE]: actPort[TASKS_ACT_KIND.TASKS_TREE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksTree(input);
    }),
    [TASKS_ACT_KIND.TASKS_SKILLS]: actPort[TASKS_ACT_KIND.TASKS_SKILLS].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksSkills(input);
    }),
    // A service that did not answer is refused, so a link draws what it holds
    // rather than reading the silence as no pull request.
    [TASKS_ACT_KIND.TASKS_PULL_REQUEST]: actPort[TASKS_ACT_KIND.TASKS_PULL_REQUEST].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const answer = yield* host.tasksPullRequest(input);
        if ("pullRequest" in answer) return answer.pullRequest;
        return yield* Effect.fail(errors.REFUSED());
      },
    ),
    // Likewise an issue: a service that did not answer is refused, never read as no issue.
    [TASKS_ACT_KIND.TASKS_ISSUE]: actPort[TASKS_ACT_KIND.TASKS_ISSUE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.tasksIssue(input);
      if ("issue" in answer) return answer.issue;
      return yield* Effect.fail(errors.REFUSED());
    }),
    [TASKS_ACT_KIND.TASKS_COLOUR_CODE]: actPort[TASKS_ACT_KIND.TASKS_COLOUR_CODE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* dependencies.colourCode(input.language, input.code);
      },
    ),
    [TASKS_ACT_KIND.TASKS_REVISIONS]: actPort[TASKS_ACT_KIND.TASKS_REVISIONS].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksRevisions(input);
    }),
    [TASKS_ACT_KIND.TASKS_REVISION]: actPort[TASKS_ACT_KIND.TASKS_REVISION].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksRevision(input);
    }),
    [TASKS_ACT_KIND.TASKS_RESTORE]: actPort[TASKS_ACT_KIND.TASKS_RESTORE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksRestore(input);
    }),
    // The version is read as its frame reads it and held nowhere here, so its HTML reaches the tab that asked alone.
    [TASKS_ACT_KIND.TASKS_PAGE_SOURCE]: actPort[TASKS_ACT_KIND.TASKS_PAGE_SOURCE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const answer = yield* host.tasksPage(input);
        if (!("page" in answer)) return answer;
        const lines = yield* pageSourceLines(answer.page.html, dependencies.colourCode);
        return { lines } satisfies TasksPageSourceAnswer;
      },
    ),
    [TASKS_ACT_KIND.TASKS_PAGES]: actPort[TASKS_ACT_KIND.TASKS_PAGES].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksPages(input);
    }),
    // Note that the picture's answer, a failure among them, is the panel's to
    // read, as a workspace photo's is, because a picture that hears none
    // draws its words rather than a refusal.
    [TASKS_ACT_KIND.TASKS_PICTURE_READ]: actPort[TASKS_ACT_KIND.TASKS_PICTURE_READ].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksPicture(input);
      },
    ),
    // A refusal is the editor's to say on the picture, with its retry, so it is answered rather than refused.
    [TASKS_ACT_KIND.TASKS_PICTURE_KEEP]: actPort[TASKS_ACT_KIND.TASKS_PICTURE_KEEP].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksPictureKeep(input);
      },
    ),
    [TASKS_ACT_KIND.TASKS_COMMENTS]: actPort[TASKS_ACT_KIND.TASKS_COMMENTS].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksComments(input);
    }),
    // A refused comment is the thread's to say, with its retry, so it is answered rather than refused.
    [TASKS_ACT_KIND.TASKS_COMMENT_START]: actPort[TASKS_ACT_KIND.TASKS_COMMENT_START].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksCommentStart(input);
      },
    ),
    [TASKS_ACT_KIND.TASKS_COMMENT_ACT]: actPort[TASKS_ACT_KIND.TASKS_COMMENT_ACT].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksCommentAct(input);
      },
    ),
  };
}
