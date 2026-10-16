import { WORKSPACE_CALL_FAILURE, type WorkspaceCallFailure } from "@luke/features";
import type { CodingAgentMessagesAnswerView } from "@luke/features/coding-agent-view";
import type {
  CodeLines,
  PlanningArchiveParams,
  PlanningBoardSaveParams,
  PlanningEditAnswer,
  PlanningEditParams,
  PlanningFileAnswer,
  PlanningFileParams,
  PlanningGitHubDisconnectAnswer,
  PlanningGitHubPageAnswer,
  PlanningLinearIssuesAnswer,
  PlanningLinearIssuesParams,
  PlanningMessagesParams,
  PlanningMoveAnswer,
  PlanningMoveParams,
  PlanningPageAnswer,
  PlanningPageParams,
  PlanningPageSourceAnswer,
  PlanningPictureAnswer,
  PlanningPictureKeepAnswer,
  PlanningPictureKeepParams,
  PlanningPictureParams,
  PlanningPinParams,
  PlanningPinRepositoryParams,
  PlanningPullRequestAnswer,
  PlanningPullRequestParams,
  PlanningRenameParams,
  PlanningRepositoriesAnswer,
  PlanningRepositoriesParams,
  PlanningRevisionAnswer,
  PlanningRevisionParams,
  PlanningRevisionsAnswer,
  PlanningRevisionsParams,
  PlanningSetRepositoryAnswer,
  PlanningSetRepositoryParams,
  PlanningSkillsAnswer,
  PlanningSkillsParams,
  PlanningStartAnswer,
  PlanningStartRequest,
  PlanningTreeAnswer,
  PlanningTreeParams,
  PlanningWorkspaceAnswer,
  PlanningWorkspaceCreateParams,
  PlanningWorkspaceGitHubConnectAnswer,
  PlanningWorkspaceInvitationAnswer,
  PlanningWorkspaceInvitationCancelParams,
  PlanningWorkspaceInvitationsAnswer,
  PlanningWorkspaceInviteParams,
  PlanningWorkspaceLeaveAnswer,
  PlanningWorkspaceLeaveParams,
  PlanningWorkspaceMemberRemoveParams,
  PlanningWorkspaceMemberRoleParams,
  PlanningWorkspaceMembersAnswer,
  PlanningWorkspaceMembersParams,
  PlanningWorkspaceParams,
  PlanningWorkspacePhotoAnswer,
  PlanningWorkspacePhotoParams,
  PlanningWorkspacePhotoSetParams,
  PlanningWorkspaceRenameParams,
  PlanningWorkspaceTransferParams,
} from "@luke/features/planning-view";
import { GITHUB_DISCONNECT_FAILURE } from "@luke/features/planning-view";
import {
  ACT,
  ACT_KIND,
  ALREADY_INVITED_REFUSAL,
  GITHUB_LAST_SIGN_IN_REFUSAL,
  isGitHubAddress,
  LINEAR_UNAVAILABLE_REFUSAL,
  WORKSPACE_NOT_PERMITTED_REFUSAL,
} from "@luke/host/acts";
import { Effect } from "effect";
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
    planningMove(params: PlanningMoveParams): Effect.Effect<PlanningMoveAnswer>;
    planningEdit(params: PlanningEditParams): Effect.Effect<PlanningEditAnswer>;
    planningBoardSave(params: PlanningBoardSaveParams): Effect.Effect<void>;
    planningWorkEarlier(): Effect.Effect<void>;
    planningConversationEarlier(): Effect.Effect<void>;
    planningMessages(params: PlanningMessagesParams): Effect.Effect<CodingAgentMessagesAnswerView>;
    planningFile(params: PlanningFileParams): Effect.Effect<PlanningFileAnswer>;
    planningTree(params: PlanningTreeParams): Effect.Effect<PlanningTreeAnswer>;
    planningSkills(params: PlanningSkillsParams): Effect.Effect<PlanningSkillsAnswer>;
    planningPullRequest(
      params: PlanningPullRequestParams,
    ): Effect.Effect<PlanningPullRequestAnswer>;
    planningRevisions(params: PlanningRevisionsParams): Effect.Effect<PlanningRevisionsAnswer>;
    planningRevision(params: PlanningRevisionParams): Effect.Effect<PlanningRevisionAnswer>;
    planningRestore(params: PlanningRevisionParams): Effect.Effect<boolean>;
    planningPage(params: PlanningPageParams): Effect.Effect<PlanningPageAnswer>;
    planningPicture(params: PlanningPictureParams): Effect.Effect<PlanningPictureAnswer>;
    planningPictureKeep(
      params: PlanningPictureKeepParams,
    ): Effect.Effect<PlanningPictureKeepAnswer>;
    githubConnect(): Effect.Effect<PlanningGitHubPageAnswer>;
    githubDisconnect(): Effect.Effect<PlanningGitHubDisconnectAnswer>;
    workspaceCreate(params: PlanningWorkspaceCreateParams): Effect.Effect<PlanningWorkspaceAnswer>;
    workspaceRename(params: PlanningWorkspaceRenameParams): Effect.Effect<PlanningWorkspaceAnswer>;
    workspacePhotoSet(
      params: PlanningWorkspacePhotoSetParams,
    ): Effect.Effect<PlanningWorkspaceAnswer>;
    workspaceGitHubConnect(
      params: PlanningWorkspaceParams,
    ): Effect.Effect<PlanningWorkspaceGitHubConnectAnswer>;
    workspaceGitHubDisconnect(
      params: PlanningWorkspaceParams,
    ): Effect.Effect<PlanningWorkspaceAnswer>;
    workspaceLinearConnect(
      params: PlanningWorkspaceParams,
    ): Effect.Effect<PlanningWorkspaceGitHubConnectAnswer>;
    workspaceLinearDisconnect(
      params: PlanningWorkspaceParams,
    ): Effect.Effect<PlanningWorkspaceAnswer>;
    workspaceLinearIssues(
      params: PlanningLinearIssuesParams,
    ): Effect.Effect<PlanningLinearIssuesAnswer>;
    workspaceMembers(
      params: PlanningWorkspaceMembersParams,
    ): Effect.Effect<PlanningWorkspaceMembersAnswer>;
    workspacePhoto(
      params: PlanningWorkspacePhotoParams,
    ): Effect.Effect<PlanningWorkspacePhotoAnswer>;
    workspaceMemberRemove(
      params: PlanningWorkspaceMemberRemoveParams,
    ): Effect.Effect<PlanningWorkspaceMembersAnswer>;
    workspaceMemberRole(
      params: PlanningWorkspaceMemberRoleParams,
    ): Effect.Effect<PlanningWorkspaceMembersAnswer>;
    workspaceTransfer(
      params: PlanningWorkspaceTransferParams,
    ): Effect.Effect<PlanningWorkspaceMembersAnswer>;
    workspaceLeave(
      params: PlanningWorkspaceLeaveParams,
    ): Effect.Effect<PlanningWorkspaceLeaveAnswer>;
    workspaceInvitations(
      params: PlanningWorkspaceParams,
    ): Effect.Effect<PlanningWorkspaceInvitationsAnswer>;
    workspaceInvite(
      params: PlanningWorkspaceInviteParams,
    ): Effect.Effect<PlanningWorkspaceInvitationAnswer>;
    workspaceInvitationCancel(
      params: PlanningWorkspaceInvitationCancelParams,
    ): Effect.Effect<PlanningWorkspaceInvitationsAnswer>;
  };
  /** Opens an address in the browser; `github.open`'s schema admits GitHub's addresses alone, `web.open`'s any http or https one. */
  openExternal: (url: string) => Promise<void>;
  /** The hosted service's origin, without a trailing slash, the only origin a page the host names may open on. */
  serviceBaseUrl: string;
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
  | typeof ACT_KIND.PLANNING_MOVE
  | typeof ACT_KIND.PLANNING_EDIT
  | typeof ACT_KIND.GITHUB_OPEN
  | typeof ACT_KIND.WEB_OPEN
  | typeof ACT_KIND.GITHUB_CONNECT
  | typeof ACT_KIND.GITHUB_DISCONNECT
  | typeof ACT_KIND.PLANNING_TALK
  | typeof ACT_KIND.PLANNING_BOARD_SAVE
  | typeof ACT_KIND.PLANNING_WORK_EARLIER
  | typeof ACT_KIND.PLANNING_CONVERSATION_EARLIER
  | typeof ACT_KIND.PLANNING_MESSAGES
  | typeof ACT_KIND.PLANNING_FILE
  | typeof ACT_KIND.PLANNING_TREE
  | typeof ACT_KIND.PLANNING_SKILLS
  | typeof ACT_KIND.PLANNING_PULL_REQUEST
  | typeof ACT_KIND.PLANNING_COLOUR_CODE
  | typeof ACT_KIND.PLANNING_REVISIONS
  | typeof ACT_KIND.PLANNING_REVISION
  | typeof ACT_KIND.PLANNING_RESTORE
  | typeof ACT_KIND.PLANNING_PAGE_SOURCE
  | typeof ACT_KIND.PLANNING_PICTURE_READ
  | typeof ACT_KIND.PLANNING_PICTURE_KEEP
  | typeof ACT_KIND.WORKSPACE_CREATE
  | typeof ACT_KIND.WORKSPACE_RENAME
  | typeof ACT_KIND.WORKSPACE_PHOTO_SET
  | typeof ACT_KIND.WORKSPACE_INVITATIONS_READ
  | typeof ACT_KIND.WORKSPACE_INVITE
  | typeof ACT_KIND.WORKSPACE_INVITATION_CANCEL
  | typeof ACT_KIND.WORKSPACE_GITHUB_CONNECT
  | typeof ACT_KIND.WORKSPACE_GITHUB_DISCONNECT
  | typeof ACT_KIND.WORKSPACE_LINEAR_CONNECT
  | typeof ACT_KIND.WORKSPACE_LINEAR_DISCONNECT
  | typeof ACT_KIND.WORKSPACE_LINEAR_ISSUES
  | typeof ACT_KIND.WORKSPACE_MEMBERS_READ
  | typeof ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ
  | typeof ACT_KIND.WORKSPACE_PHOTO_READ
  | typeof ACT_KIND.WORKSPACE_MEMBER_REMOVE
  | typeof ACT_KIND.WORKSPACE_MEMBER_ROLE
  | typeof ACT_KIND.WORKSPACE_TRANSFER
  | typeof ACT_KIND.WORKSPACE_LEAVE;

type WorkspaceActKind =
  | typeof ACT_KIND.WORKSPACE_CREATE
  | typeof ACT_KIND.WORKSPACE_RENAME
  | typeof ACT_KIND.WORKSPACE_PHOTO_SET
  | typeof ACT_KIND.WORKSPACE_INVITATIONS_READ
  | typeof ACT_KIND.WORKSPACE_INVITE
  | typeof ACT_KIND.WORKSPACE_INVITATION_CANCEL
  | typeof ACT_KIND.WORKSPACE_GITHUB_CONNECT
  | typeof ACT_KIND.WORKSPACE_GITHUB_DISCONNECT
  | typeof ACT_KIND.WORKSPACE_LINEAR_CONNECT
  | typeof ACT_KIND.WORKSPACE_LINEAR_DISCONNECT
  | typeof ACT_KIND.WORKSPACE_LINEAR_ISSUES
  | typeof ACT_KIND.WORKSPACE_MEMBERS_READ
  | typeof ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ
  | typeof ACT_KIND.WORKSPACE_MEMBER_REMOVE
  | typeof ACT_KIND.WORKSPACE_MEMBER_ROLE
  | typeof ACT_KIND.WORKSPACE_TRANSFER
  | typeof ACT_KIND.WORKSPACE_LEAVE;

/**
 * The longest page whose source main colours. Note that a longer one is
 * drawn plain rather than cut, as a transcript's long block is, because
 * colouring holds main for about a millisecond per hundred characters.
 */
const PAGE_SOURCE_COLOURED_MAX_CHARS = 64 * 1024;

/** The refusal a window that draws no Plans tab hears, in its kind's own words. */
function refuseUnlessPanel(kind: PlanningActKind, sender: ActSender): void {
  if (!sender.panel) {
    throw new ActRefused({ message: ACT[kind].refusal });
  }
}

/** A page's HTML as its tab's source draws it: line by line, coloured as HTML where it is short enough to colour, plain past that. */
function pageSourceLines(
  html: string,
  colourCode: PlanningActsDependencies["colourCode"],
): CodeLines {
  if (html.length <= PAGE_SOURCE_COLOURED_MAX_CHARS) return colourCode("html", html);
  return html.split("\n").map((text) => (text === "" ? [] : [{ text }]));
}

/**
 * A workspace act the host answered without its answer, refused: a write
 * the account's role does not allow in words that say so, and anything else
 * in its kind's own words.
 */
function refusedWorkspace(kind: WorkspaceActKind, failure: WorkspaceCallFailure) {
  const message =
    failure === WORKSPACE_CALL_FAILURE.NOT_PERMITTED
      ? WORKSPACE_NOT_PERMITTED_REFUSAL
      : failure === WORKSPACE_CALL_FAILURE.ALREADY_INVITED
        ? ALREADY_INVITED_REFUSAL
        : failure === WORKSPACE_CALL_FAILURE.LINEAR_UNAVAILABLE
          ? LINEAR_UNAVAILABLE_REFUSAL
          : ACT[kind].refusal;
  return Effect.fail(new ActRefused({ message }));
}

/** Whether an address the host answered parses and is https, the one kind a browser is sent to unnamed. */
function isBrowserAddress(url: string): boolean {
  return URL.canParse(url) && new URL(url).protocol === "https:";
}

/** Whether an address the host answered parses and stands on the service's own origin. */
function isServicePage(url: string, serviceBaseUrl: string): boolean {
  return URL.canParse(url) && new URL(url).origin === new URL(serviceBaseUrl).origin;
}

/**
 * A GitHub page the host named, opened in the browser; refused in the act's
 * own words where it named none. Note that a page off the service's own
 * origin is refused too, because the answer is any string and the opener
 * would hand a `file:` or custom-scheme address to whatever handles it.
 */
function openedPage(
  kind: typeof ACT_KIND.GITHUB_CONNECT,
  page: PlanningGitHubPageAnswer,
  dependencies: Pick<PlanningActsDependencies, "openExternal" | "serviceBaseUrl">,
) {
  const refused = new ActRefused({ message: ACT[kind].refusal });
  return "url" in page && isServicePage(page.url, dependencies.serviceBaseUrl)
    ? Effect.tryPromise({ try: () => dependencies.openExternal(page.url), catch: () => refused })
    : Effect.fail(refused);
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
    [ACT_KIND.PLANNING_MOVE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_MOVE, sender);
      return host.planningMove(params);
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
    // The address of either page is the service's own, named by the host,
    // and never one a window handed in, so the act carries none.
    [ACT_KIND.GITHUB_CONNECT]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.GITHUB_CONNECT, sender);
      return Effect.flatMap(host.githubConnect(), (page) =>
        openedPage(ACT_KIND.GITHUB_CONNECT, page, dependencies),
      );
    },
    // Disconnecting asks the host, which asks the service under the Mac's
    // session; no page opens, so no browser account stands in for the Mac's.
    [ACT_KIND.GITHUB_DISCONNECT]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.GITHUB_DISCONNECT, sender);
      return Effect.flatMap(host.githubDisconnect(), (answer) =>
        "connection" in answer
          ? Effect.void
          : Effect.fail(
              new ActRefused({
                message:
                  answer.failure === GITHUB_DISCONNECT_FAILURE.NOT_PERMITTED
                    ? GITHUB_LAST_SIGN_IN_REFUSAL
                    : ACT[ACT_KIND.GITHUB_DISCONNECT].refusal,
              }),
            ),
      );
    },
    // The address is an http or https one by the act's own schema, so it
    // opens in the browser and never in a file's or another app's handler.
    [ACT_KIND.WEB_OPEN]: ({ url }, sender) => {
      refuseUnlessPanel(ACT_KIND.WEB_OPEN, sender);
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
    [ACT_KIND.PLANNING_CONVERSATION_EARLIER]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_CONVERSATION_EARLIER, sender);
      return host.planningConversationEarlier();
    },
    [ACT_KIND.PLANNING_MESSAGES]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_MESSAGES, sender);
      return host.planningMessages(params);
    },
    [ACT_KIND.PLANNING_FILE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_FILE, sender);
      return host.planningFile(params);
    },
    [ACT_KIND.PLANNING_TREE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_TREE, sender);
      return host.planningTree(params);
    },
    [ACT_KIND.PLANNING_SKILLS]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_SKILLS, sender);
      return host.planningSkills(params);
    },
    // A service that did not answer is refused, so a link draws what it holds
    // rather than reading the silence as no pull request.
    [ACT_KIND.PLANNING_PULL_REQUEST]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_PULL_REQUEST, sender);
      return Effect.flatMap(host.planningPullRequest(params), (answer) =>
        "pullRequest" in answer
          ? Effect.succeed(answer.pullRequest)
          : Effect.fail(new ActRefused({ message: ACT[ACT_KIND.PLANNING_PULL_REQUEST].refusal })),
      );
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
    // Note that the picture's answer, a failure among them, is the panel's to
    // read, as a workspace photo's is, because a picture that hears none
    // draws its words rather than a refusal.
    [ACT_KIND.PLANNING_PICTURE_READ]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_PICTURE_READ, sender);
      return host.planningPicture(params);
    },
    // A refusal is the editor's to say on the picture, with its retry, so it is answered rather than refused.
    [ACT_KIND.PLANNING_PICTURE_KEEP]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_PICTURE_KEEP, sender);
      return host.planningPictureKeep(params);
    },
    // The version is read as its frame reads it and held nowhere here, so its HTML reaches the tab that asked alone.
    [ACT_KIND.PLANNING_PAGE_SOURCE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_PAGE_SOURCE, sender);
      return Effect.map(
        host.planningPage(params),
        (answer): PlanningPageSourceAnswer =>
          "page" in answer
            ? { lines: pageSourceLines(answer.page.html, dependencies.colourCode) }
            : answer,
      );
    },
    [ACT_KIND.PLANNING_BOARD_SAVE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_BOARD_SAVE, sender);
      return host.planningBoardSave(params);
    },
    [ACT_KIND.WORKSPACE_CREATE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_CREATE, sender);
      return Effect.flatMap(host.workspaceCreate(params), (answer) =>
        "workspace" in answer
          ? Effect.succeed(answer.workspace)
          : refusedWorkspace(ACT_KIND.WORKSPACE_CREATE, answer.failure),
      );
    },
    [ACT_KIND.WORKSPACE_RENAME]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_RENAME, sender);
      return Effect.flatMap(host.workspaceRename(params), (answer) =>
        "workspace" in answer
          ? Effect.succeed(answer.workspace)
          : refusedWorkspace(ACT_KIND.WORKSPACE_RENAME, answer.failure),
      );
    },
    [ACT_KIND.WORKSPACE_PHOTO_SET]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_PHOTO_SET, sender);
      return Effect.flatMap(host.workspacePhotoSet(params), (answer) =>
        "workspace" in answer
          ? Effect.succeed(answer.workspace)
          : refusedWorkspace(ACT_KIND.WORKSPACE_PHOTO_SET, answer.failure),
      );
    },
    [ACT_KIND.WORKSPACE_INVITATIONS_READ]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_INVITATIONS_READ, sender);
      return Effect.flatMap(host.workspaceInvitations(params), (answer) =>
        "invitations" in answer
          ? Effect.succeed(answer.invitations)
          : refusedWorkspace(ACT_KIND.WORKSPACE_INVITATIONS_READ, answer.failure),
      );
    },
    [ACT_KIND.WORKSPACE_INVITE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_INVITE, sender);
      return Effect.flatMap(host.workspaceInvite(params), (answer) =>
        "invitation" in answer
          ? Effect.succeed(answer.invitation)
          : refusedWorkspace(ACT_KIND.WORKSPACE_INVITE, answer.failure),
      );
    },
    [ACT_KIND.WORKSPACE_INVITATION_CANCEL]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_INVITATION_CANCEL, sender);
      return Effect.flatMap(host.workspaceInvitationCancel(params), (answer) =>
        "invitations" in answer
          ? Effect.succeed(answer.invitations)
          : refusedWorkspace(ACT_KIND.WORKSPACE_INVITATION_CANCEL, answer.failure),
      );
    },
    // Note that the address the service answered opens only where it is
    // GitHub's, because it is the one address here the panel did not name.
    [ACT_KIND.WORKSPACE_GITHUB_CONNECT]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_GITHUB_CONNECT, sender);
      return Effect.flatMap(host.workspaceGitHubConnect(params), (answer) => {
        if ("failure" in answer) {
          return refusedWorkspace(ACT_KIND.WORKSPACE_GITHUB_CONNECT, answer.failure);
        }
        if (!isGitHubAddress(answer.url)) {
          return refusedWorkspace(
            ACT_KIND.WORKSPACE_GITHUB_CONNECT,
            WORKSPACE_CALL_FAILURE.UNANSWERED,
          );
        }
        return Effect.promise(() => dependencies.openExternal(answer.url));
      });
    },
    [ACT_KIND.WORKSPACE_GITHUB_DISCONNECT]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_GITHUB_DISCONNECT, sender);
      return Effect.flatMap(host.workspaceGitHubDisconnect(params), (answer) =>
        "workspace" in answer
          ? Effect.void
          : refusedWorkspace(ACT_KIND.WORKSPACE_GITHUB_DISCONNECT, answer.failure),
      );
    },
    // Note that the address the service answered opens only where it is
    // https, because it is Vercel Connect's and the panel did not name it.
    [ACT_KIND.WORKSPACE_LINEAR_CONNECT]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_LINEAR_CONNECT, sender);
      return Effect.flatMap(host.workspaceLinearConnect(params), (answer) => {
        if ("failure" in answer) {
          return refusedWorkspace(ACT_KIND.WORKSPACE_LINEAR_CONNECT, answer.failure);
        }
        if (!isBrowserAddress(answer.url)) {
          return refusedWorkspace(
            ACT_KIND.WORKSPACE_LINEAR_CONNECT,
            WORKSPACE_CALL_FAILURE.UNANSWERED,
          );
        }
        return Effect.promise(() => dependencies.openExternal(answer.url));
      });
    },
    [ACT_KIND.WORKSPACE_LINEAR_DISCONNECT]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_LINEAR_DISCONNECT, sender);
      return Effect.flatMap(host.workspaceLinearDisconnect(params), (answer) =>
        "workspace" in answer
          ? Effect.void
          : refusedWorkspace(ACT_KIND.WORKSPACE_LINEAR_DISCONNECT, answer.failure),
      );
    },
    [ACT_KIND.WORKSPACE_LINEAR_ISSUES]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_LINEAR_ISSUES, sender);
      return Effect.flatMap(host.workspaceLinearIssues(params), (answer) =>
        "issues" in answer
          ? Effect.succeed(answer.issues)
          : refusedWorkspace(ACT_KIND.WORKSPACE_LINEAR_ISSUES, answer.failure),
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
    // Who left is read on the same read as the members, so a service that names nobody answers none.
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ, sender);
      return Effect.flatMap(host.workspaceMembers(params), (answer) =>
        "members" in answer
          ? Effect.succeed(answer.former ?? [])
          : refusedWorkspace(ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ, answer.failure),
      );
    },
    // Note that the photo's answer, a failure among them, is the panel's to
    // read, as an inbox image's is, because a tile that hears none draws its
    // letter rather than a refusal.
    [ACT_KIND.WORKSPACE_PHOTO_READ]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_PHOTO_READ, sender);
      return host.workspacePhoto(params);
    },
    [ACT_KIND.WORKSPACE_MEMBER_REMOVE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_MEMBER_REMOVE, sender);
      return Effect.flatMap(host.workspaceMemberRemove(params), (answer) =>
        "members" in answer
          ? Effect.succeed(answer.members)
          : refusedWorkspace(ACT_KIND.WORKSPACE_MEMBER_REMOVE, answer.failure),
      );
    },
    [ACT_KIND.WORKSPACE_MEMBER_ROLE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_MEMBER_ROLE, sender);
      return Effect.flatMap(host.workspaceMemberRole(params), (answer) =>
        "members" in answer
          ? Effect.succeed(answer.members)
          : refusedWorkspace(ACT_KIND.WORKSPACE_MEMBER_ROLE, answer.failure),
      );
    },
    [ACT_KIND.WORKSPACE_TRANSFER]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.WORKSPACE_TRANSFER, sender);
      return Effect.flatMap(host.workspaceTransfer(params), (answer) =>
        "members" in answer
          ? Effect.succeed(answer.members)
          : refusedWorkspace(ACT_KIND.WORKSPACE_TRANSFER, answer.failure),
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
