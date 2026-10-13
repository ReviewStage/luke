import type {
  CodeLines,
  PlanningArchiveParams,
  PlanningBoardSaveParams,
  PlanningEditAnswer,
  PlanningEditParams,
  PlanningFileAnswer,
  PlanningFileParams,
  PlanningPinParams,
  PlanningPinRepositoryParams,
  PlanningRenameParams,
  PlanningRepositoriesAnswer,
  PlanningRepositoriesParams,
  PlanningRevisionAnswer,
  PlanningRevisionParams,
  PlanningRevisionsAnswer,
  PlanningRevisionsParams,
  PlanningSetRepositoryAnswer,
  PlanningSetRepositoryParams,
  PlanningStartAnswer,
  PlanningStartRequest,
  PlanningTreeAnswer,
  PlanningTreeParams,
  PlanningWorkspaceJoinAnswer,
  PlanningWorkspaceJoinParams,
  PlanningWorkspaceLeaveAnswer,
  PlanningWorkspaceLeaveParams,
  PlanningWorkspaceMemberRemoveParams,
  PlanningWorkspaceMembersAnswer,
  PlanningWorkspaceMembersParams,
  WorkspaceCallFailure,
} from "@sidecar/hosted/planning-view";
import { WORKSPACE_CALL_FAILURE } from "@sidecar/hosted/planning-view";
import { Effect } from "effect";
import {
  ACT,
  ACT_KIND,
  WORKSPACE_JOIN_NOT_FOUND_REFUSAL,
  WORKSPACE_NOT_PERMITTED_REFUSAL,
} from "#shared/messages/acts";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

/**
 * planning-acts.ts -- the Plans tab's acts: the panel's asks of the host about the named plans.
 *
 * The one check this process makes is who asked. Only a panel draws the
 * Plans tab, and the takeover and the hidden voice window draw no plan, so
 * every row refuses them. What the host does with an ask — which plan is
 * active, what the service answers — is the host's to
 * decide, and comes back as the panel's own answer. Nothing is held here.
 */
export interface PlanningActsDependencies {
  host: {
    planningRefresh(): Effect.Effect<void>;
    planningOpen(planId: string): Effect.Effect<boolean>;
    planningClose(): Effect.Effect<void>;
    planningDelete(planId: string): Effect.Effect<boolean>;
    planningRename(params: PlanningRenameParams): Effect.Effect<boolean>;
    planningPin(params: PlanningPinParams): Effect.Effect<boolean>;
    planningPinRepository(params: PlanningPinRepositoryParams): Effect.Effect<boolean>;
    planningArchive(params: PlanningArchiveParams): Effect.Effect<boolean>;
    planningStart(request: PlanningStartRequest): Effect.Effect<PlanningStartAnswer>;
    planningRepositories(
      params: PlanningRepositoriesParams,
    ): Effect.Effect<PlanningRepositoriesAnswer>;
    planningSetRepository(
      params: PlanningSetRepositoryParams,
    ): Effect.Effect<PlanningSetRepositoryAnswer>;
    planningEdit(params: PlanningEditParams): Effect.Effect<PlanningEditAnswer>;
    planningBoardSave(params: PlanningBoardSaveParams): Effect.Effect<void>;
    planningWorkEarlier(): Effect.Effect<void>;
    planningFile(params: PlanningFileParams): Effect.Effect<PlanningFileAnswer>;
    planningTree(params: PlanningTreeParams): Effect.Effect<PlanningTreeAnswer>;
    planningRevisions(params: PlanningRevisionsParams): Effect.Effect<PlanningRevisionsAnswer>;
    planningRevision(params: PlanningRevisionParams): Effect.Effect<PlanningRevisionAnswer>;
    planningRestore(params: PlanningRevisionParams): Effect.Effect<boolean>;
    workspaceJoin(params: PlanningWorkspaceJoinParams): Effect.Effect<PlanningWorkspaceJoinAnswer>;
    workspaceMembers(
      params: PlanningWorkspaceMembersParams,
    ): Effect.Effect<PlanningWorkspaceMembersAnswer>;
    workspaceMemberRemove(
      params: PlanningWorkspaceMemberRemoveParams,
    ): Effect.Effect<PlanningWorkspaceMembersAnswer>;
    workspaceLeave(
      params: PlanningWorkspaceLeaveParams,
    ): Effect.Effect<PlanningWorkspaceLeaveAnswer>;
  };
  /** Opens an address in the browser; the act's own schema admits GitHub's addresses alone. */
  openExternal: (url: string) => Promise<void>;
  /** The plan the panel has open, as main holds the host's view of it. */
  activePlanId: () => string | undefined;
  /** Tells the voice window, which owns the call, that the plan's microphone was pressed. */
  talkAboutPlan: (planId: string) => void;
  /** Whether a call could open now: voice set up and the microphone already granted, so opening one asks the developer nothing. */
  voiceReady: () => boolean;
  /** Whether a call is in progress, which a start leaves standing for the panel to ask about moving. */
  callStanding: () => boolean;
  /** A transcript's fenced block coloured as its fence's language, by the highlighter the File tab's lines are coloured with. */
  colourCode: (language: string, code: string) => CodeLines;
}

type PlanningActKind =
  | typeof ACT_KIND.PLANNING_REFRESH
  | typeof ACT_KIND.PLANNING_SELECT
  | typeof ACT_KIND.PLANNING_CLOSE
  | typeof ACT_KIND.PLANNING_START
  | typeof ACT_KIND.PLANNING_DELETE
  | typeof ACT_KIND.PLANNING_RENAME
  | typeof ACT_KIND.PLANNING_PIN
  | typeof ACT_KIND.PLANNING_PIN_REPOSITORY
  | typeof ACT_KIND.PLANNING_ARCHIVE
  | typeof ACT_KIND.PLANNING_REPOSITORIES
  | typeof ACT_KIND.PLANNING_SET_REPOSITORY
  | typeof ACT_KIND.PLANNING_EDIT
  | typeof ACT_KIND.GITHUB_OPEN
  | typeof ACT_KIND.PLANNING_TALK
  | typeof ACT_KIND.PLANNING_BOARD_SAVE
  | typeof ACT_KIND.PLANNING_WORK_EARLIER
  | typeof ACT_KIND.PLANNING_FILE
  | typeof ACT_KIND.PLANNING_TREE
  | typeof ACT_KIND.PLANNING_COLOUR_CODE
  | typeof ACT_KIND.PLANNING_REVISIONS
  | typeof ACT_KIND.PLANNING_REVISION
  | typeof ACT_KIND.PLANNING_RESTORE
  | typeof ACT_KIND.WORKSPACE_JOIN
  | typeof ACT_KIND.WORKSPACE_MEMBERS_READ
  | typeof ACT_KIND.WORKSPACE_MEMBER_REMOVE
  | typeof ACT_KIND.WORKSPACE_LEAVE;

type WorkspaceActKind =
  | typeof ACT_KIND.WORKSPACE_JOIN
  | typeof ACT_KIND.WORKSPACE_MEMBERS_READ
  | typeof ACT_KIND.WORKSPACE_MEMBER_REMOVE
  | typeof ACT_KIND.WORKSPACE_LEAVE;

/** The refusal a window that draws no Plans tab hears, in its kind's own words. */
function refuseUnlessPanel(kind: PlanningActKind, sender: ActSender): void {
  if (!sender.panel) {
    throw new ActRefused({ message: ACT[kind].refusal });
  }
}

/**
 * A workspace act the host answered without its answer, refused: a join the
 * service would not grant in words that say GitHub does not show the
 * installation, a write the account's role does not allow in words that
 * say so, and anything else in its kind's own words.
 */
function refusedWorkspace(kind: WorkspaceActKind, failure: WorkspaceCallFailure) {
  const refused = failure !== WORKSPACE_CALL_FAILURE.UNANSWERED;
  const message =
    kind === ACT_KIND.WORKSPACE_JOIN && refused
      ? WORKSPACE_JOIN_NOT_FOUND_REFUSAL
      : failure === WORKSPACE_CALL_FAILURE.NOT_PERMITTED
        ? WORKSPACE_NOT_PERMITTED_REFUSAL
        : ACT[kind].refusal;
  return Effect.fail(new ActRefused({ message }));
}

export function planningActRows(
  dependencies: PlanningActsDependencies,
): Pick<ActRows, PlanningActKind> {
  const { host } = dependencies;
  return {
    [ACT_KIND.PLANNING_REFRESH]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_REFRESH, sender);
      return host.planningRefresh();
    },
    [ACT_KIND.PLANNING_SELECT]: ({ planId }, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_SELECT, sender);
      return host.planningOpen(planId);
    },
    [ACT_KIND.PLANNING_CLOSE]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_CLOSE, sender);
      return host.planningClose();
    },
    // Note that a started plan opens its call at once, because pressing
    // Start plan is the developer's gesture and Luke opens a new plan by
    // greeting it; where the call would first have to ask for the
    // microphone, the plan's own microphone button asks instead, and where
    // a call already stands the panel asks whether to end it first.
    [ACT_KIND.PLANNING_START]: (request, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_START, sender);
      return Effect.tap(host.planningStart(request), (answer) =>
        Effect.sync(() => {
          if ("planId" in answer && dependencies.voiceReady() && !dependencies.callStanding()) {
            dependencies.talkAboutPlan(answer.planId);
          }
        }),
      );
    },
    [ACT_KIND.PLANNING_DELETE]: ({ planId }, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_DELETE, sender);
      return host.planningDelete(planId);
    },
    [ACT_KIND.PLANNING_RENAME]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_RENAME, sender);
      return host.planningRename(params);
    },
    [ACT_KIND.PLANNING_PIN]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_PIN, sender);
      return host.planningPin(params);
    },
    [ACT_KIND.PLANNING_PIN_REPOSITORY]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_PIN_REPOSITORY, sender);
      return host.planningPinRepository(params);
    },
    [ACT_KIND.PLANNING_ARCHIVE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_ARCHIVE, sender);
      return host.planningArchive(params);
    },
    [ACT_KIND.PLANNING_REPOSITORIES]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_REPOSITORIES, sender);
      return host.planningRepositories(params);
    },
    [ACT_KIND.PLANNING_SET_REPOSITORY]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_SET_REPOSITORY, sender);
      return host.planningSetRepository(params);
    },
    [ACT_KIND.PLANNING_EDIT]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_EDIT, sender);
      return host.planningEdit(params);
    },
    // The address is GitHub's by the act's own schema, so what opens is a
    // repository's page or the App's installation page and nothing else.
    [ACT_KIND.GITHUB_OPEN]: ({ url }, sender) => {
      refuseUnlessPanel(ACT_KIND.GITHUB_OPEN, sender);
      return dependencies.openExternal(url);
    },
    // The press names no plan: the plan is the one the host has open, read
    // here, so the panel cannot open a call about a plan it is not showing.
    [ACT_KIND.PLANNING_TALK]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_TALK, sender);
      const planId = dependencies.activePlanId();
      if (planId === undefined) {
        throw new ActRefused({ message: ACT[ACT_KIND.PLANNING_TALK].refusal });
      }
      dependencies.talkAboutPlan(planId);
    },
    [ACT_KIND.PLANNING_WORK_EARLIER]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_WORK_EARLIER, sender);
      return host.planningWorkEarlier();
    },
    [ACT_KIND.PLANNING_FILE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_FILE, sender);
      return host.planningFile(params);
    },
    [ACT_KIND.PLANNING_TREE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_TREE, sender);
      return host.planningTree(params);
    },
    [ACT_KIND.PLANNING_COLOUR_CODE]: ({ language, code }, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_COLOUR_CODE, sender);
      return dependencies.colourCode(language, code);
    },
    [ACT_KIND.PLANNING_REVISIONS]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_REVISIONS, sender);
      return host.planningRevisions(params);
    },
    [ACT_KIND.PLANNING_REVISION]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_REVISION, sender);
      return host.planningRevision(params);
    },
    [ACT_KIND.PLANNING_RESTORE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_RESTORE, sender);
      return host.planningRestore(params);
    },
    [ACT_KIND.PLANNING_BOARD_SAVE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_BOARD_SAVE, sender);
      return host.planningBoardSave(params);
    },
    [ACT_KIND.WORKSPACE_JOIN]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_JOIN, sender);
      return Effect.flatMap(host.workspaceJoin(params), (answer) =>
        "workspace" in answer
          ? Effect.succeed(answer.workspace)
          : refusedWorkspace(ACT_KIND.WORKSPACE_JOIN, answer.failure),
      );
    },
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_MEMBERS_READ, sender);
      return Effect.flatMap(host.workspaceMembers(params), (answer) =>
        "members" in answer
          ? Effect.succeed(answer.members)
          : refusedWorkspace(ACT_KIND.WORKSPACE_MEMBERS_READ, answer.failure),
      );
    },
    [ACT_KIND.WORKSPACE_MEMBER_REMOVE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_MEMBER_REMOVE, sender);
      return Effect.flatMap(host.workspaceMemberRemove(params), (answer) =>
        "members" in answer
          ? Effect.succeed(answer.members)
          : refusedWorkspace(ACT_KIND.WORKSPACE_MEMBER_REMOVE, answer.failure),
      );
    },
    [ACT_KIND.WORKSPACE_LEAVE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_LEAVE, sender);
      return Effect.flatMap(host.workspaceLeave(params), (answer) =>
        "left" in answer ? Effect.void : refusedWorkspace(ACT_KIND.WORKSPACE_LEAVE, answer.failure),
      );
    },
  };
}
