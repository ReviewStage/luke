/**
 * tasks-procedures.ts -- the Tasks tab's asks of the host about the task list, the open task, and what a task holds.
 *
 * The one check these procedures make is who asked. Only a panel draws the
 * Tasks tab, and the takeover and the hidden voice window draw no task, so
 * every one refuses them, in its own sentence. What the host does with an
 * ask (which task is active, what the service answers) is the host's to
 * decide, and comes back as the panel's own answer. Nothing is held here.
 */

import {
  ADMIN_PAGE_PATH,
  type AdminFavoriteParams,
  type AdminReadAnswer,
  type AdminReadParams,
} from "@luke/features/admin-wire";
import { pagePlaceId } from "@luke/features/page-wire";
import {
  type CodeLines,
  GITHUB_DISCONNECT_FAILURE,
  type TaskBrowserTabsFollow,
  type TaskBrowserTabsFollowed,
  type TaskHistoryFollow,
  type TaskHistoryFollowed,
  type TaskPagesFollow,
  type TaskPagesFollowed,
  type TasksArchiveParams,
  type TasksBoardSaveParams,
  type TasksBrowserTabsAnswer,
  type TasksBrowserTabsParams,
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
import type { VoiceCallAbout } from "@luke/voice/voice-view";
import { Effect, MutableHashMap, Option, Stream } from "effect";
import { GITHUB_LAST_SIGN_IN_REFUSAL, isWebAddress } from "../acts.js";
import { TASKS_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

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
    adminRead(params: AdminReadParams): Effect.Effect<AdminReadAnswer>;
    adminFavorite(params: AdminFavoriteParams): Effect.Effect<boolean>;
    tasksSetStanding(params: TasksSetStandingParams): Effect.Effect<boolean>;
    tasksFile(params: TasksFileParams): Effect.Effect<TasksFileAnswer>;
    tasksTree(params: TasksTreeParams): Effect.Effect<TasksTreeAnswer>;
    tasksSkills(params: TasksSkillsParams): Effect.Effect<TasksSkillsAnswer>;
    tasksPullRequest(params: TasksPullRequestParams): Effect.Effect<TasksPullRequestAnswer>;
    tasksIssue(params: TasksIssueParams): Effect.Effect<TasksIssueAnswer>;
    tasksBrowserTabs(params: TasksBrowserTabsParams): Effect.Effect<TasksBrowserTabsAnswer>;
    /** A task's Browser tabs followed at the host, their changes heard through `onTaskBrowserTabsChanged`. */
    tasksBrowserTabsFollow(scope: TaskBrowserTabsFollow): Effect.Effect<void>;
    tasksBrowserTabsUnfollow(scope: TaskBrowserTabsFollow): Effect.Effect<void>;
    onTaskBrowserTabsChanged(listener: (followed: TaskBrowserTabsFollowed) => void): () => void;
    tasksRevisions(params: TasksRevisionsParams): Effect.Effect<TasksRevisionsAnswer>;
    tasksRevision(params: TasksRevisionParams): Effect.Effect<TasksRevisionAnswer>;
    tasksRestore(params: TasksRevisionParams): Effect.Effect<boolean>;
    tasksPage(params: TasksPageParams): Effect.Effect<TasksPageAnswer>;
    tasksPages(params: TasksPagesParams): Effect.Effect<TasksPagesAnswer>;
    /** A plan's pages followed at the host, their changes heard through `onTaskPagesChanged`. */
    tasksPagesFollow(scope: TaskPagesFollow): Effect.Effect<void>;
    tasksPagesUnfollow(scope: TaskPagesFollow): Effect.Effect<void>;
    onTaskPagesChanged(listener: (followed: TaskPagesFollowed) => void): () => void;
    /** A plan's newest page of history followed at the host, its changes heard through `onTaskHistoryChanged`. */
    tasksHistoryFollow(scope: TaskHistoryFollow): Effect.Effect<void>;
    tasksHistoryUnfollow(scope: TaskHistoryFollow): Effect.Effect<void>;
    onTaskHistoryChanged(listener: (followed: TaskHistoryFollowed) => void): () => void;
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
  /** Tells the voice window, which owns the call, that an agent's Call button was pressed. */
  talkTo: (about: VoiceCallAbout) => void;
}

/** The refusal a window that draws no Tasks tab hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

/**
 * A page's HTML as its tab's source reads it: line by line, plain, since the
 * panel draws it as every code is, through Pierre's diffs, which colours it
 * (`@luke/panel`'s `whole-file.tsx`).
 */
function pageSourceLines(html: string): CodeLines {
  return html.split("\n").map((text) => (text === "" ? [] : [{ text }]));
}

/** Whether an address the host answered parses and stands on the service's own origin. */
function isServicePage(url: string, serviceBaseUrl: string): boolean {
  return URL.canParse(url) && new URL(url).origin === new URL(serviceBaseUrl).origin;
}

/**
 * The admin dashboard's page on the service's own origin, or nothing where
 * that origin is no http or https one, which the browser alone would open.
 */
function adminPage(serviceBaseUrl: string): string | undefined {
  if (!URL.canParse(ADMIN_PAGE_PATH, serviceBaseUrl)) return undefined;
  const page = new URL(ADMIN_PAGE_PATH, serviceBaseUrl).href;
  return isWebAddress(page) && isServicePage(page, serviceBaseUrl) ? page : undefined;
}

export function tasksProcedures(dependencies: TasksProceduresDependencies) {
  const { host, openExternal } = dependencies;
  /** How many streams stand open of each plan's pages, and each agent's on no task, by its id. */
  const openPages: OpenFollows<TasksPagesAnswer> = MutableHashMap.empty();
  /** How many streams stand open of each task's Browser tabs. */
  const openBrowserTabs: OpenFollows<TasksBrowserTabsAnswer> = MutableHashMap.empty();
  /** How many streams stand open of each plan's history. */
  const openHistories: OpenFollows<TasksRevisionsAnswer> = MutableHashMap.empty();
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
    // Note that a started task opens no call: a call starts only from an
    // agent's own Call button.
    [TASKS_ACT_KIND.TASKS_START]: actPort[TASKS_ACT_KIND.TASKS_START].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksStart(input);
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
    // The admin dashboard opens where the browser's own session is, rather
    // than in a Browser tab, whose cookies are its own. The act carries no
    // address: the host names the page on the service's origin.
    [TASKS_ACT_KIND.ADMIN_OPEN]: actPort[TASKS_ACT_KIND.ADMIN_OPEN].effect(function* ({
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const url = adminPage(dependencies.serviceBaseUrl);
      if (url === undefined) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.tryPromise({ try: () => openExternal(url), catch: () => errors.REFUSED() });
    }),
    // An admin read goes to the service under the account's session and
    // comes back to the window that asked, as it came; the service's gate,
    // not this port, decides who may read it.
    [TASKS_ACT_KIND.ADMIN_READ]: actPort[TASKS_ACT_KIND.ADMIN_READ].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.adminRead(input);
    }),
    [TASKS_ACT_KIND.ADMIN_FAVORITE]: actPort[TASKS_ACT_KIND.ADMIN_FAVORITE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.adminFavorite(input);
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
    // The press names its agent, and the task it is on where it is on one,
    // whatever task the panel has open: a call is keyed by its agent. That
    // the agent takes calls and is on the task named is checked as the
    // call's session is created (`compose-live.ts`).
    [TASKS_ACT_KIND.TASKS_TALK]: actPort[TASKS_ACT_KIND.TASKS_TALK].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      dependencies.talkTo({
        agentId: input.agentId,
        ...(input.taskId === undefined ? undefined : { taskId: input.taskId }),
      });
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
    // Likewise a task's Browser tabs: a service that did not answer is refused, never read as no tab.
    [TASKS_ACT_KIND.TASKS_BROWSER_TABS]: actPort[TASKS_ACT_KIND.TASKS_BROWSER_TABS].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const answer = yield* host.tasksBrowserTabs(input);
        if ("tabs" in answer) return answer;
        return yield* Effect.fail(errors.REFUSED());
      },
    ),
    // A task's Browser tabs followed for its side panel: two panels on one task share one follow at the host.
    [TASKS_ACT_KIND.TASKS_BROWSER_TABS_FOLLOW]: actPort[
      TASKS_ACT_KIND.TASKS_BROWSER_TABS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const tabs = followedStream(
        {
          keyOf: (scope: TaskBrowserTabsFollow) => scope.taskId,
          follow: host.tasksBrowserTabsFollow,
          unfollow: host.tasksBrowserTabsUnfollow,
          onChanged: host.onTaskBrowserTabsChanged,
          valueOf: (changed: TaskBrowserTabsFollowed, scope: TaskBrowserTabsFollow) =>
            changed.taskId === scope.taskId ? Option.some(changed.view) : Option.none(),
        },
        openBrowserTabs,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(tabs));
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
        const lines = pageSourceLines(answer.page.html);
        return { lines } satisfies TasksPageSourceAnswer;
      },
    ),
    [TASKS_ACT_KIND.TASKS_PAGES_FOLLOW]: actPort[TASKS_ACT_KIND.TASKS_PAGES_FOLLOW].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const pages = followedStream(
          {
            keyOf: (scope: TaskPagesFollow) => pagePlaceId(scope),
            follow: host.tasksPagesFollow,
            unfollow: host.tasksPagesUnfollow,
            onChanged: host.onTaskPagesChanged,
            valueOf: (changed: TaskPagesFollowed, scope: TaskPagesFollow) =>
              pagePlaceId(changed) === pagePlaceId(scope)
                ? Option.some(changed.view)
                : Option.none(),
          },
          openPages,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(pages));
      },
    ),
    [TASKS_ACT_KIND.TASKS_HISTORY_FOLLOW]: actPort[TASKS_ACT_KIND.TASKS_HISTORY_FOLLOW].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const pages = followedStream(
          {
            keyOf: (scope: TaskHistoryFollow) => scope.taskId,
            follow: host.tasksHistoryFollow,
            unfollow: host.tasksHistoryUnfollow,
            onChanged: host.onTaskHistoryChanged,
            valueOf: (changed: TaskHistoryFollowed, scope: TaskHistoryFollow) =>
              changed.taskId === scope.taskId ? Option.some(changed.view) : Option.none(),
          },
          openHistories,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(pages));
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
