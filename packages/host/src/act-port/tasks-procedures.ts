import {
  ADMIN_PAGE_PATH,
  type AdminFavoriteParams,
  type AdminReadAnswer,
  type AdminReadParams,
} from "@repo/features/admin-wire";
import { browserTabsPlaceId } from "@repo/features/agent-browser-tab-wire";
import { pagePlaceId } from "@repo/features/page-wire";
import {
  type CodeLines,
  GITHUB_DISCONNECT_FAILURE,
  type TaskBrowserTabsFollow,
  type TaskDocumentFollow,
  type TaskHistoryFollow,
  type TaskPagesFollow,
  type TasksBlockAnswer,
  type TasksBlockParams,
  type TasksBrowserTabOpenAnswer,
  type TasksBrowserTabOpenParams,
  type TasksChangeRelationAnswer,
  type TasksChangeRelationParams,
  type TasksCommentActParams,
  type TasksCommentAnswer,
  type TasksCommentStartParams,
  type TasksCommentsFollow,
  type TasksEditAnswer,
  type TasksEditParams,
  type TasksFileAnswer,
  type TasksFileParams,
  type TasksFindAnswer,
  type TasksFindParams,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubPageAnswer,
  type TasksLinkStandingParams,
  type TasksMarkReadParams,
  type TasksMoveAnswer,
  type TasksMoveParams,
  type TasksPageAnswer,
  type TasksPageParams,
  type TasksPageSourceAnswer,
  type TasksPictureAnswer,
  type TasksPictureKeepAnswer,
  type TasksPictureKeepParams,
  type TasksPictureParams,
  type TasksPinParams,
  type TasksPinRepositoryParams,
  type TasksRenameParams,
  type TasksRepositoriesParams,
  type TasksRevisionAnswer,
  type TasksRevisionParams,
  type TasksRevisionsAnswer,
  type TasksRevisionsParams,
  type TasksSetParentAnswer,
  type TasksSetParentParams,
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
} from "@repo/features/tasks-view";
import { Data, Effect, MutableHashMap, Option, Stream } from "effect";
import { GITHUB_LAST_SIGN_IN_REFUSAL, isWebAddress } from "../acts.js";
import { EVERY_WORKSPACE } from "../app-state.js";
import { TASKS_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

export interface TasksProceduresDependencies {
  host: {
    tasksRefresh(): Effect.Effect<void>;
    tasksOpen(taskId: string): Effect.Effect<boolean>;
    tasksClose(): Effect.Effect<void>;
    tasksOfflineRefusedClear(): Effect.Effect<void>;
    tasksDelete(taskId: string): Effect.Effect<boolean>;
    tasksRename(params: TasksRenameParams): Effect.Effect<boolean>;
    tasksPin(params: TasksPinParams): Effect.Effect<boolean>;
    tasksMarkRead(params: TasksMarkReadParams): Effect.Effect<boolean>;
    tasksPinRepository(params: TasksPinRepositoryParams): Effect.Effect<boolean>;
    tasksWriteSection(params: TasksWriteSectionParams): Effect.Effect<boolean>;
    tasksStart(request: TasksStartRequest): Effect.Effect<TasksStartAnswer>;
    tasksRepositoriesFollow(params: TasksRepositoriesParams): Effect.Effect<void>;
    tasksRepositoriesUnfollow(params: TasksRepositoriesParams): Effect.Effect<void>;
    tasksRepositoriesRetry(params: TasksRepositoriesParams): Effect.Effect<void>;
    tasksSetRepository(params: TasksSetRepositoryParams): Effect.Effect<TasksSetRepositoryAnswer>;
    tasksMove(params: TasksMoveParams): Effect.Effect<TasksMoveAnswer>;
    tasksBlock(params: TasksBlockParams): Effect.Effect<TasksBlockAnswer>;
    tasksSetParent(params: TasksSetParentParams): Effect.Effect<TasksSetParentAnswer>;
    tasksChangeRelation(
      params: TasksChangeRelationParams,
    ): Effect.Effect<TasksChangeRelationAnswer>;
    tasksEdit(params: TasksEditParams): Effect.Effect<TasksEditAnswer>;
    githubConnect(): Effect.Effect<TasksGitHubPageAnswer>;
    githubDisconnect(): Effect.Effect<TasksGitHubDisconnectAnswer>;
    adminRead(params: AdminReadParams): Effect.Effect<AdminReadAnswer>;
    adminFavorite(params: AdminFavoriteParams): Effect.Effect<boolean>;
    tasksSetStanding(params: TasksSetStandingParams): Effect.Effect<boolean>;
    tasksFile(params: TasksFileParams): Effect.Effect<TasksFileAnswer>;
    tasksTree(params: TasksTreeParams): Effect.Effect<TasksTreeAnswer>;
    tasksSkills(params: TasksSkillsParams): Effect.Effect<TasksSkillsAnswer>;
    tasksLinkStandingFollow(params: TasksLinkStandingParams): Effect.Effect<void>;
    tasksLinkStandingUnfollow(params: TasksLinkStandingParams): Effect.Effect<void>;
    tasksBrowserTabOpen(
      params: TasksBrowserTabOpenParams,
    ): Effect.Effect<TasksBrowserTabOpenAnswer>;
    tasksBrowserTabsFollow(scope: TaskBrowserTabsFollow): Effect.Effect<void>;
    tasksBrowserTabsUnfollow(scope: TaskBrowserTabsFollow): Effect.Effect<void>;
    tasksFind(params: TasksFindParams): Effect.Effect<TasksFindAnswer>;
    tasksRevisions(params: TasksRevisionsParams): Effect.Effect<TasksRevisionsAnswer>;
    tasksRevision(params: TasksRevisionParams): Effect.Effect<TasksRevisionAnswer>;
    tasksRestore(params: TasksRevisionParams): Effect.Effect<boolean>;
    tasksPage(params: TasksPageParams): Effect.Effect<TasksPageAnswer>;
    tasksPagesFollow(scope: TaskPagesFollow): Effect.Effect<void>;
    tasksPagesUnfollow(scope: TaskPagesFollow): Effect.Effect<void>;
    tasksDocumentFollow(scope: TaskDocumentFollow): Effect.Effect<void>;
    tasksDocumentUnfollow(scope: TaskDocumentFollow): Effect.Effect<void>;
    tasksDocumentRetry(scope: TaskDocumentFollow): Effect.Effect<void>;
    tasksHistoryFollow(scope: TaskHistoryFollow): Effect.Effect<void>;
    tasksHistoryUnfollow(scope: TaskHistoryFollow): Effect.Effect<void>;
    tasksHistoryRetry(scope: TaskHistoryFollow): Effect.Effect<void>;
    tasksPicture(params: TasksPictureParams): Effect.Effect<TasksPictureAnswer>;
    tasksPictureKeep(params: TasksPictureKeepParams): Effect.Effect<TasksPictureKeepAnswer>;
    tasksCommentsFollow(scope: TasksCommentsFollow): Effect.Effect<void>;
    tasksCommentsUnfollow(scope: TasksCommentsFollow): Effect.Effect<void>;
    tasksCommentsRetry(scope: TasksCommentsFollow): Effect.Effect<void>;
    tasksCommentStart(params: TasksCommentStartParams): Effect.Effect<TasksCommentAnswer>;
    tasksCommentAct(params: TasksCommentActParams): Effect.Effect<TasksCommentAnswer>;
  };
  colorCode: (language: string, code: string) => Effect.Effect<CodeLines>;
  openExternal: (url: string) => Promise<void>;
  serviceBaseUrl: string;
}

function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

function pageSourceLines(html: string): CodeLines {
  return html.split("\n").map((text) => (text === "" ? [] : [{ text }]));
}

function isServicePage(url: string, serviceBaseUrl: string): boolean {
  return URL.canParse(url) && new URL(url).origin === new URL(serviceBaseUrl).origin;
}

class LinkStandingStreamKey extends Data.Class<{
  readonly workspaceId: string;
  readonly address: string;
}> {}

function adminPage(serviceBaseUrl: string): string | undefined {
  if (!URL.canParse(ADMIN_PAGE_PATH, serviceBaseUrl)) return undefined;
  const page = new URL(ADMIN_PAGE_PATH, serviceBaseUrl).href;
  return isWebAddress(page) && isServicePage(page, serviceBaseUrl) ? page : undefined;
}

interface CommentsHeld {
  readonly taskId: string;
  readonly pageId: string | undefined;
}

export function tasksProcedures(dependencies: TasksProceduresDependencies) {
  const { host, openExternal } = dependencies;
  const openPages: OpenFollows<never> = MutableHashMap.empty();
  const openRepositories: OpenFollows<never> = MutableHashMap.empty();
  const openLinks: OpenFollows<never, LinkStandingStreamKey> = MutableHashMap.empty();
  const openDocuments: OpenFollows<never> = MutableHashMap.empty();
  const openBrowserTabs: OpenFollows<never> = MutableHashMap.empty();
  const openComments: OpenFollows<never, CommentsHeld> = MutableHashMap.empty();
  const openHistories: OpenFollows<never> = MutableHashMap.empty();
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
    [TASKS_ACT_KIND.TASKS_OFFLINE_REFUSED_CLEAR]: actPort[
      TASKS_ACT_KIND.TASKS_OFFLINE_REFUSED_CLEAR
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.tasksOfflineRefusedClear();
    }),
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
    [TASKS_ACT_KIND.TASKS_MARK_READ]: actPort[TASKS_ACT_KIND.TASKS_MARK_READ].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksMarkRead(input);
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
    [TASKS_ACT_KIND.TASKS_REPOSITORIES_FOLLOW]: actPort[
      TASKS_ACT_KIND.TASKS_REPOSITORIES_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (scope: TasksRepositoriesParams) => scope.workspaceId ?? EVERY_WORKSPACE,
          follow: host.tasksRepositoriesFollow,
          unfollow: host.tasksRepositoriesUnfollow,
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
        },
        openRepositories,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [TASKS_ACT_KIND.TASKS_REPOSITORIES_RETRY]: actPort[
      TASKS_ACT_KIND.TASKS_REPOSITORIES_RETRY
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.tasksRepositoriesRetry(input);
    }),
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
    [TASKS_ACT_KIND.TASKS_BLOCK]: actPort[TASKS_ACT_KIND.TASKS_BLOCK].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksBlock(input);
    }),
    [TASKS_ACT_KIND.TASKS_SET_PARENT]: actPort[TASKS_ACT_KIND.TASKS_SET_PARENT].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksSetParent(input);
    }),
    [TASKS_ACT_KIND.TASKS_CHANGE_RELATION]: actPort[TASKS_ACT_KIND.TASKS_CHANGE_RELATION].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksChangeRelation(input);
      },
    ),
    [TASKS_ACT_KIND.TASKS_EDIT]: actPort[TASKS_ACT_KIND.TASKS_EDIT].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksEdit(input);
    }),
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
    [TASKS_ACT_KIND.ADMIN_OPEN]: actPort[TASKS_ACT_KIND.ADMIN_OPEN].effect(function* ({
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const url = adminPage(dependencies.serviceBaseUrl);
      if (url === undefined) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.tryPromise({ try: () => openExternal(url), catch: () => errors.REFUSED() });
    }),
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
    [TASKS_ACT_KIND.TASKS_LINK_STANDING_FOLLOW]: actPort[
      TASKS_ACT_KIND.TASKS_LINK_STANDING_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (link: TasksLinkStandingParams) => new LinkStandingStreamKey(link),
          follow: host.tasksLinkStandingFollow,
          unfollow: host.tasksLinkStandingUnfollow,
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
        },
        openLinks,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [TASKS_ACT_KIND.TASKS_BROWSER_TAB_OPEN]: actPort[TASKS_ACT_KIND.TASKS_BROWSER_TAB_OPEN].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksBrowserTabOpen(input);
      },
    ),
    [TASKS_ACT_KIND.TASKS_BROWSER_TABS_FOLLOW]: actPort[
      TASKS_ACT_KIND.TASKS_BROWSER_TABS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (scope: TaskBrowserTabsFollow) => browserTabsPlaceId(scope),
          follow: host.tasksBrowserTabsFollow,
          unfollow: host.tasksBrowserTabsUnfollow,
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
        },
        openBrowserTabs,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [TASKS_ACT_KIND.TASKS_COLOR_CODE]: actPort[TASKS_ACT_KIND.TASKS_COLOR_CODE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* dependencies.colorCode(input.language, input.code);
    }),
    [TASKS_ACT_KIND.TASKS_FIND]: actPort[TASKS_ACT_KIND.TASKS_FIND].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksFind(input);
    }),
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
        const hold = followedStream(
          {
            keyOf: (scope: TaskPagesFollow) => pagePlaceId(scope),
            follow: host.tasksPagesFollow,
            unfollow: host.tasksPagesUnfollow,
            onChanged: () => () => undefined,
            valueOf: () => Option.none<never>(),
          },
          openPages,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(hold));
      },
    ),
    [TASKS_ACT_KIND.TASKS_DOCUMENT_FOLLOW]: actPort[TASKS_ACT_KIND.TASKS_DOCUMENT_FOLLOW].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const hold = followedStream(
          {
            keyOf: (scope: TaskDocumentFollow) => scope.taskId,
            follow: host.tasksDocumentFollow,
            unfollow: host.tasksDocumentUnfollow,
            onChanged: () => () => undefined,
            valueOf: () => Option.none<never>(),
          },
          openDocuments,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(hold));
      },
    ),
    [TASKS_ACT_KIND.TASKS_DOCUMENT_RETRY]: actPort[TASKS_ACT_KIND.TASKS_DOCUMENT_RETRY].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        yield* host.tasksDocumentRetry(input);
      },
    ),
    [TASKS_ACT_KIND.TASKS_HISTORY_FOLLOW]: actPort[TASKS_ACT_KIND.TASKS_HISTORY_FOLLOW].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const hold = followedStream(
          {
            keyOf: (scope: TaskHistoryFollow) => scope.taskId,
            follow: host.tasksHistoryFollow,
            unfollow: host.tasksHistoryUnfollow,
            onChanged: () => () => undefined,
            valueOf: () => Option.none<never>(),
          },
          openHistories,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(hold));
      },
    ),
    [TASKS_ACT_KIND.TASKS_HISTORY_RETRY]: actPort[TASKS_ACT_KIND.TASKS_HISTORY_RETRY].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        yield* host.tasksHistoryRetry(input);
      },
    ),
    [TASKS_ACT_KIND.TASKS_PICTURE_READ]: actPort[TASKS_ACT_KIND.TASKS_PICTURE_READ].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksPicture(input);
      },
    ),
    [TASKS_ACT_KIND.TASKS_PICTURE_KEEP]: actPort[TASKS_ACT_KIND.TASKS_PICTURE_KEEP].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksPictureKeep(input);
      },
    ),
    [TASKS_ACT_KIND.TASKS_COMMENTS_FOLLOW]: actPort[TASKS_ACT_KIND.TASKS_COMMENTS_FOLLOW].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const hold = followedStream(
          {
            keyOf: (scope: TasksCommentsFollow): CommentsHeld => ({
              taskId: scope.taskId,
              pageId: scope.pageId,
            }),
            follow: host.tasksCommentsFollow,
            unfollow: host.tasksCommentsUnfollow,
            onChanged: () => () => undefined,
            valueOf: () => Option.none<never>(),
          },
          openComments,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(hold));
      },
    ),
    [TASKS_ACT_KIND.TASKS_COMMENTS_RETRY]: actPort[TASKS_ACT_KIND.TASKS_COMMENTS_RETRY].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        yield* host.tasksCommentsRetry(input);
      },
    ),
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
