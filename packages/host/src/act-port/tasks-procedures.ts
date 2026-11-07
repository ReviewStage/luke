/**
 * tasks-procedures.ts -- the Tasks tab's holds, their Try again, and the addresses it opens in the browser.
 *
 * The one check these procedures make is who asked. Only a panel draws the
 * Tasks tab, and the takeover and any other window draw no task, so
 * every one refuses them, in its own sentence. What a task holds is held at
 * the host while a panel holds its stream open, and reaches every panel on
 * app state; how many streams stand open is all that is held here. The
 * Tasks tab's plain asks are declared (`contract/tasks.ts`) and answered by
 * the tasks composer; Connect GitHub is declared too, but opens here the page
 * the host names.
 */

import { ADMIN_PAGE_PATH } from "@repo/features/admin-wire";
import { browserTabsPlaceId } from "@repo/features/agent-browser-tab-wire";
import { pagePlaceId } from "@repo/features/page-wire";
import type {
  CodeLines,
  TaskBrowserTabsFollow,
  TaskDocumentFollow,
  TaskHistoryFollow,
  TaskPagesFollow,
  TasksCommentsFollow,
  TasksLinkStandingParams,
  TasksRepositoriesParams,
} from "@repo/features/tasks-view";
import { Data, Effect, MutableHashMap, Stream } from "effect";
import { isWebAddress } from "../acts.js";
import { EVERY_WORKSPACE } from "../app-state.js";
import { TASKS_ACT_KIND, TASKS_ACTS } from "../contract/index.js";
import type { HostActTable } from "../host-acts.js";
import { type ActSender, actPort } from "./base.js";
import { declaredAnswer } from "./declared-acts.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/** What the task procedures are handed: the host, and the doors of the window's process they open or read. */
export interface TasksProceduresDependencies {
  host: {
    /** One workspace's repositories held at the host while any stream of them stands; what it holds reaches the panel on app state. */
    tasksRepositoriesFollow(params: TasksRepositoriesParams): Effect.Effect<void>;
    tasksRepositoriesUnfollow(params: TasksRepositoriesParams): Effect.Effect<void>;
    /** One workspace's held repositories asked again at once, as Try again asks; done once the ask has landed. */
    tasksRepositoriesRetry(params: TasksRepositoriesParams): Effect.Effect<void>;
    /** One link's standing held at the host while any stream of it stands; what it holds reaches the panel on app state. */
    tasksLinkStandingFollow(params: TasksLinkStandingParams): Effect.Effect<void>;
    tasksLinkStandingUnfollow(params: TasksLinkStandingParams): Effect.Effect<void>;
    /** A task's or agent's Browser tabs held followed at the host while any stream of them stands; what they hold reaches the panel on app state. */
    tasksBrowserTabsFollow(scope: TaskBrowserTabsFollow): Effect.Effect<void>;
    tasksBrowserTabsUnfollow(scope: TaskBrowserTabsFollow): Effect.Effect<void>;
    /** A plan's or agent's pages held followed at the host while any stream of them stands; what they hold reaches the panel on app state. */
    tasksPagesFollow(scope: TaskPagesFollow): Effect.Effect<void>;
    tasksPagesUnfollow(scope: TaskPagesFollow): Effect.Effect<void>;
    /** A task's description held followed at the host while any stream of it stands; what it holds reaches the panel on app state. */
    tasksDocumentFollow(scope: TaskDocumentFollow): Effect.Effect<void>;
    tasksDocumentUnfollow(scope: TaskDocumentFollow): Effect.Effect<void>;
    tasksDocumentRetry(scope: TaskDocumentFollow): Effect.Effect<void>;
    /** A task's description history held followed at the host while any stream of it stands; what it holds reaches the panel on app state. */
    tasksHistoryFollow(scope: TaskHistoryFollow): Effect.Effect<void>;
    tasksHistoryUnfollow(scope: TaskHistoryFollow): Effect.Effect<void>;
    tasksHistoryRetry(scope: TaskHistoryFollow): Effect.Effect<void>;
    /** A description's or page's comments held followed at the host while any stream of them stands; what they hold reaches the panel on app state. */
    tasksCommentsFollow(scope: TasksCommentsFollow): Effect.Effect<void>;
    tasksCommentsUnfollow(scope: TasksCommentsFollow): Effect.Effect<void>;
    /** A held description's or page's comments read again at once, as Try again asks. */
    tasksCommentsRetry(scope: TasksCommentsFollow): Effect.Effect<void>;
  };
  /** The host's handler of Connect GitHub, which names the page this procedure opens. */
  acts: Pick<HostActTable<typeof TASKS_ACTS>, "GITHUB_CONNECT">;
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

/** Which comments a stream holds open: a description's, or one page's, each named so two holds of one compare equal. */
interface CommentsHeld {
  readonly taskId: string;
  readonly pageId: string | undefined;
}

export function tasksProcedures(dependencies: TasksProceduresDependencies) {
  const { host, acts, openExternal } = dependencies;
  /** How many streams stand open of each plan's pages, and each agent's on no task, by its id. */
  const openPages: OpenFollows = MutableHashMap.empty();
  /** Every workspace's repositories a window holds a stream open of, so the host lets them go only with the last. */
  const openRepositories: OpenFollows = MutableHashMap.empty();
  /** Every link's standing a window holds a stream open of, so the host lets it go only with the last. */
  const openLinks: OpenFollows<LinkStandingStreamKey> = MutableHashMap.empty();
  /** Every task's description a window holds a stream open of, so the host lets one go only with the last. */
  const openDocuments: OpenFollows = MutableHashMap.empty();
  /** How many streams stand open of each agent's or task's Browser tabs, by its id, which never collide. */
  const openBrowserTabs: OpenFollows = MutableHashMap.empty();
  /** How many streams stand open of each description's comments, and each page's, by the task and the page. */
  const openComments: OpenFollows<CommentsHeld> = MutableHashMap.empty();
  /** Every task's history a window holds a stream open of, so the host lets one go only with the last. */
  const openHistories: OpenFollows = MutableHashMap.empty();
  return {
    [TASKS_ACT_KIND.TASKS_REPOSITORIES_FOLLOW]: actPort[
      TASKS_ACT_KIND.TASKS_REPOSITORIES_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (scope: TasksRepositoriesParams) => scope.workspaceId ?? EVERY_WORKSPACE,
          follow: host.tasksRepositoriesFollow,
          unfollow: host.tasksRepositoriesUnfollow,
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
      errors,
    }) {
      // Note that the contract marks the act the panel's alone (`contract/tasks.ts`), so any other window was refused before this body runs.
      const page = yield* declaredAnswer(TASKS_ACTS.GITHUB_CONNECT, acts.GITHUB_CONNECT, undefined);
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
    [TASKS_ACT_KIND.TASKS_LINK_STANDING_FOLLOW]: actPort[
      TASKS_ACT_KIND.TASKS_LINK_STANDING_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (link: TasksLinkStandingParams) => new LinkStandingStreamKey(link),
          follow: host.tasksLinkStandingFollow,
          unfollow: host.tasksLinkStandingUnfollow,
        },
        openLinks,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    // An agent's or a task's Browser tabs held for its side panel: two panels on one share one follow at the host.
    [TASKS_ACT_KIND.TASKS_BROWSER_TABS_FOLLOW]: actPort[
      TASKS_ACT_KIND.TASKS_BROWSER_TABS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (scope: TaskBrowserTabsFollow) => browserTabsPlaceId(scope),
          follow: host.tasksBrowserTabsFollow,
          unfollow: host.tasksBrowserTabsUnfollow,
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
    [TASKS_ACT_KIND.TASKS_PAGES_FOLLOW]: actPort[TASKS_ACT_KIND.TASKS_PAGES_FOLLOW].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const hold = followedStream(
          {
            keyOf: (scope: TaskPagesFollow) => pagePlaceId(scope),
            follow: host.tasksPagesFollow,
            unfollow: host.tasksPagesUnfollow,
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
  };
}
