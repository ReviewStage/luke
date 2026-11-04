/**
 * tasks-procedures.ts -- the Tasks tab's asks of the host about the task list, the open task, and what a task holds.
 *
 * The one check these procedures make is who asked. Only a panel draws the
 * Tasks tab, and the takeover and any other window draw no task, so
 * every one refuses them, in its own sentence. What the host does with an
 * ask (which task is active, what the service answers) is the host's to
 * decide, and comes back as the panel's own answer. Nothing is held here.
 */

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
    tasksStart(request: TasksStartRequest): Effect.Effect<TasksStartAnswer>;
    /** One workspace's repositories held at the host while any stream of them stands; what it holds reaches the panel on app state. */
    tasksRepositoriesFollow(params: TasksRepositoriesParams): Effect.Effect<void>;
    tasksRepositoriesUnfollow(params: TasksRepositoriesParams): Effect.Effect<void>;
    /** One workspace's held repositories asked again at once, as Try again asks; done once the ask has landed. */
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
    /** One link's standing held at the host while any stream of it stands; what it holds reaches the panel on app state. */
    tasksLinkStandingFollow(params: TasksLinkStandingParams): Effect.Effect<void>;
    tasksLinkStandingUnfollow(params: TasksLinkStandingParams): Effect.Effect<void>;
    tasksBrowserTabOpen(
      params: TasksBrowserTabOpenParams,
    ): Effect.Effect<TasksBrowserTabOpenAnswer>;
    /** A task's or agent's Browser tabs held followed at the host while any stream of them stands; what they hold reaches the panel on app state. */
    tasksBrowserTabsFollow(scope: TaskBrowserTabsFollow): Effect.Effect<void>;
    tasksBrowserTabsUnfollow(scope: TaskBrowserTabsFollow): Effect.Effect<void>;
    tasksFind(params: TasksFindParams): Effect.Effect<TasksFindAnswer>;
    tasksRevisions(params: TasksRevisionsParams): Effect.Effect<TasksRevisionsAnswer>;
    tasksRevision(params: TasksRevisionParams): Effect.Effect<TasksRevisionAnswer>;
    tasksRestore(params: TasksRevisionParams): Effect.Effect<boolean>;
    tasksPage(params: TasksPageParams): Effect.Effect<TasksPageAnswer>;
    /** A plan's or agent's pages held followed at the host while any stream of them stands; what they hold reaches the panel on app state. */
    tasksPagesFollow(scope: TaskPagesFollow): Effect.Effect<void>;
    tasksPagesUnfollow(scope: TaskPagesFollow): Effect.Effect<void>;
    /** A task's plan held followed at the host while any stream of it stands; what it holds reaches the panel on app state. */
    tasksDocumentFollow(scope: TaskDocumentFollow): Effect.Effect<void>;
    tasksDocumentUnfollow(scope: TaskDocumentFollow): Effect.Effect<void>;
    tasksDocumentRetry(scope: TaskDocumentFollow): Effect.Effect<void>;
    /** A task's plan history held followed at the host while any stream of it stands; what it holds reaches the panel on app state. */
    tasksHistoryFollow(scope: TaskHistoryFollow): Effect.Effect<void>;
    tasksHistoryUnfollow(scope: TaskHistoryFollow): Effect.Effect<void>;
    tasksHistoryRetry(scope: TaskHistoryFollow): Effect.Effect<void>;
    tasksPicture(params: TasksPictureParams): Effect.Effect<TasksPictureAnswer>;
    tasksPictureKeep(params: TasksPictureKeepParams): Effect.Effect<TasksPictureKeepAnswer>;
    /** A plan's or page's comments held followed at the host while any stream of them stands; what they hold reaches the panel on app state. */
    tasksCommentsFollow(scope: TasksCommentsFollow): Effect.Effect<void>;
    tasksCommentsUnfollow(scope: TasksCommentsFollow): Effect.Effect<void>;
    /** A held plan's or page's comments read again at once, as Try again asks. */
    tasksCommentsRetry(scope: TasksCommentsFollow): Effect.Effect<void>;
    tasksCommentStart(params: TasksCommentStartParams): Effect.Effect<TasksCommentAnswer>;
    tasksCommentAct(params: TasksCommentActParams): Effect.Effect<TasksCommentAnswer>;
  };
  /** A transcript's fenced block colored as its fence's language, by the highlighter the File tab's lines are colored with. */
  colorCode: (language: string, code: string) => Effect.Effect<CodeLines>;
  /** Opens an address in the browser; `github.open`'s schema admits GitHub's addresses alone, `web.open`'s any http or https one. */
  openExternal: (url: string) => Promise<void>;
  /** The hosted service's origin, without a trailing slash, the only origin a page the host names may open on. */
  serviceBaseUrl: string;
}

/** The refusal a window that draws no Tasks tab hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

/**
 * A page's HTML as its tab's source reads it: line by line, plain, since the
 * panel draws it as every code is, through Pierre's diffs, which colors it
 * (`@repo/panel`'s `whole-file.tsx`).
 */
function pageSourceLines(html: string): CodeLines {
  return html.split("\n").map((text) => (text === "" ? [] : [{ text }]));
}

/** Whether an address the host answered parses and stands on the service's own origin. */
function isServicePage(url: string, serviceBaseUrl: string): boolean {
  return URL.canParse(url) && new URL(url).origin === new URL(serviceBaseUrl).origin;
}

/** A link's standing as a key that equals another naming the same workspace and address. */
class LinkStandingStreamKey extends Data.Class<{
  readonly workspaceId: string;
  readonly address: string;
}> {}

/**
 * The admin dashboard's page on the service's own origin, or nothing where
 * that origin is no http or https one, which the browser alone would open.
 */
function adminPage(serviceBaseUrl: string): string | undefined {
  if (!URL.canParse(ADMIN_PAGE_PATH, serviceBaseUrl)) return undefined;
  const page = new URL(ADMIN_PAGE_PATH, serviceBaseUrl).href;
  return isWebAddress(page) && isServicePage(page, serviceBaseUrl) ? page : undefined;
}

/** Which comments a stream holds open: a plan's, or one page's, each named so two holds of one compare equal. */
interface CommentsHeld {
  readonly taskId: string;
  readonly pageId: string | undefined;
}

export function tasksProcedures(dependencies: TasksProceduresDependencies) {
  const { host, openExternal } = dependencies;
  /** How many streams stand open of each plan's pages, and each agent's on no task, by its id. */
  const openPages: OpenFollows<never> = MutableHashMap.empty();
  /** Every workspace's repositories a window holds a stream open of, so the host lets them go only with the last. */
  const openRepositories: OpenFollows<never> = MutableHashMap.empty();
  /** Every link's standing a window holds a stream open of, so the host lets it go only with the last. */
  const openLinks: OpenFollows<never, LinkStandingStreamKey> = MutableHashMap.empty();
  /** Every task's plan a window holds a stream open of, so the host lets one go only with the last. */
  const openDocuments: OpenFollows<never> = MutableHashMap.empty();
  /** How many streams stand open of each agent's or task's Browser tabs, by its id, which never collide. */
  const openBrowserTabs: OpenFollows<never> = MutableHashMap.empty();
  /** How many streams stand open of each plan's comments, and each page's, by the task and the page. */
  const openComments: OpenFollows<never, CommentsHeld> = MutableHashMap.empty();
  /** Every task's history a window holds a stream open of, so the host lets one go only with the last. */
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
    [TASKS_ACT_KIND.TASKS_REPOSITORIES_FOLLOW]: actPort[
      TASKS_ACT_KIND.TASKS_REPOSITORIES_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      // Note that nothing is heard down the hold, since the held repositories reach the panel on app state.
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
      // Note that nothing is heard down the hold, since the held standing reaches the panel on app state.
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
    // A tab opened in an agent's browser answers why none opened as the panel's own answer, for its words.
    [TASKS_ACT_KIND.TASKS_BROWSER_TAB_OPEN]: actPort[TASKS_ACT_KIND.TASKS_BROWSER_TAB_OPEN].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksBrowserTabOpen(input);
      },
    ),
    // An agent's or a task's Browser tabs held for its side panel: two panels on one share one follow at the host.
    [TASKS_ACT_KIND.TASKS_BROWSER_TABS_FOLLOW]: actPort[
      TASKS_ACT_KIND.TASKS_BROWSER_TABS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      // Note that nothing is heard down the hold, since the held tabs reach the panel on app state.
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
    // The version is read as its frame reads it, kept in the host's memory by its version (`kept-content.ts`) and never in app state, so its HTML reaches the tab that asked alone.
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
        // Note that nothing is heard down the hold, since the held pages reach the panel on app state.
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
        // Note that nothing is heard down the hold, since the held plan reaches the panel on app state.
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
        // Note that nothing is heard down the hold, since the held history reaches the panel on app state.
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
    [TASKS_ACT_KIND.TASKS_COMMENTS_FOLLOW]: actPort[TASKS_ACT_KIND.TASKS_COMMENTS_FOLLOW].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        // Note that nothing is heard down the hold, since the held comments reach the panel on app state.
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
