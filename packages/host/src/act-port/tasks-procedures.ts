import {
  GITHUB_DISCONNECT_FAILURE,
  type TasksArchiveParams,
  type TasksBoardSaveParams,
  type TasksEditAnswer,
  type TasksEditParams,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubPageAnswer,
  type TasksMoveAnswer,
  type TasksMoveParams,
  type TasksPinParams,
  type TasksPinRepositoryParams,
  type TasksRenameParams,
  type TasksRepositoriesAnswer,
  type TasksRepositoriesParams,
  type TasksSetRepositoryAnswer,
  type TasksSetRepositoryParams,
  type TasksStartAnswer,
  type TasksStartRequest,
  type TasksWriteSectionParams,
} from "@luke/features/tasks-view";
import { Effect } from "effect";
import type { ActSender } from "../act-router/router.js";
import { GITHUB_LAST_SIGN_IN_REFUSAL } from "../acts.js";
import { TASKS_ACT_KIND } from "../contract/index.js";
import { actPort } from "./base.js";

/**
 * tasks-procedures.ts -- the Tasks tab's asks of the host about the task list and the open task.
 *
 * The one check these procedures make is who asked. Only a panel draws the
 * Tasks tab, and the takeover and the hidden voice window draw no task, so
 * every one refuses them, in its own sentence. What the host does with an
 * ask (which task is active, what the service answers) is the host's to
 * decide, and comes back as the panel's own answer. Nothing is held here.
 */
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
  };
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
  };
}
