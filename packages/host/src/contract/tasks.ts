/**
 * tasks.ts -- the Tasks tab's asks of the host about the task list, the open task, and what a task holds, declared, and the procedures of the holds and the opens beside them.
 *
 * Only a panel draws the Tasks tab, so every ask is the panel's alone. A
 * kind that carries nothing takes `undefined` alone, so a window calls it
 * with no payload and one sent anything is refused. A write that answers
 * whether the service took it answers a boolean, and one the panel reads
 * nothing of answers `void`; a refusal or a defect of the host's is drawn as
 * the answer each drew before it was declared: `false`, nothing, or the
 * task calls' unanswered failure. Each live read the tab holds is a live
 * follow (`live-follow.ts`), relayed by `act-port/live-follows.ts`; each
 * address opened in the browser stays a procedure of its own
 * (`act-port/tasks-procedures.ts`), as does Connect GitHub, whose page the
 * window opens.
 */

import {
  ADMIN_UNANSWERED,
  adminFavoriteParamsSchema,
  adminReadAnswerSchema,
  adminReadParamsSchema,
} from "@repo/features/admin-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  codeLinesSchema,
  TASK_CALL_FAILURE,
  taskBrowserTabsFollowSchema,
  taskDocumentFollowSchema,
  taskHistoryFollowSchema,
  taskPagesFollowSchema,
  tasksBlockAnswerSchema,
  tasksBlockParamsSchema,
  tasksBrowserTabOpenAnswerSchema,
  tasksBrowserTabOpenParamsSchema,
  tasksChangeRelationAnswerSchema,
  tasksChangeRelationParamsSchema,
  tasksCommentActParamsSchema,
  tasksCommentAnswerSchema,
  tasksCommentStartParamsSchema,
  tasksCommentsFollowSchema,
  tasksEditAnswerSchema,
  tasksEditParamsSchema,
  tasksFileAnswerSchema,
  tasksFileParamsSchema,
  tasksFindAnswerSchema,
  tasksFindParamsSchema,
  tasksGitHubPageAnswerSchema,
  tasksLinkStandingParamsSchema,
  tasksMarkReadParamsSchema,
  tasksMoveAnswerSchema,
  tasksMoveParamsSchema,
  tasksPageParamsSchema,
  tasksPageSourceAnswerSchema,
  tasksPictureAnswerSchema,
  tasksPictureKeepAnswerSchema,
  tasksPictureKeepParamsSchema,
  tasksPictureParamsSchema,
  tasksPinParamsSchema,
  tasksPinRepositoryParamsSchema,
  tasksRenameParamsSchema,
  tasksRepositoriesParamsSchema,
  tasksRevisionAnswerSchema,
  tasksRevisionParamsSchema,
  tasksRevisionsAnswerSchema,
  tasksRevisionsParamsSchema,
  tasksSetParentAnswerSchema,
  tasksSetParentParamsSchema,
  tasksSetRepositoryAnswerSchema,
  tasksSetRepositoryParamsSchema,
  tasksSetStandingParamsSchema,
  tasksSkillsAnswerSchema,
  tasksSkillsParamsSchema,
  tasksStartAnswerSchema,
  tasksStartRequestSchema,
  tasksTreeAnswerSchema,
  tasksTreeParamsSchema,
  tasksWriteSectionParamsSchema,
} from "@repo/features/tasks-view";
import { ACT } from "@repo/sync";
import { Schema as EffectSchema } from "effect";
import {
  COLORED_CODE_MAX_CHARS,
  exactId,
  FENCE_LANGUAGE_MAX_CHARS,
  githubAddress,
  openableAddress,
} from "../acts.js";
import { actProcedure, exactInput } from "./base.js";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { TASKS_ACT_KIND } from "./kinds.js";
import { followsContractOf, HOLD, liveFollow, liveFollows } from "./live-follow.js";

const takesNothing = exactInput(EffectSchema.Undefined);
const taskIdParamsSchema = EffectSchema.Struct({ taskId: exactId });

/** What the window draws for a task ask the host could not answer. */
const UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

/** What the admin dashboard draws for a read the host could not answer. */
const ADMIN_READ_UNANSWERED = { refused: ADMIN_UNANSWERED } as const;

/** A text admitted as written, refused where it carries nothing or runs past `max`. */
function exactText(max: number) {
  return EffectSchema.String.check(
    EffectSchema.makeFilter((value) => value.trim().length > 0),
    EffectSchema.isMaxLength(max),
  );
}

/** A fenced block to color: its fence's language and its code, each bounded. */
const colorCodeParamsSchema = EffectSchema.Struct({
  language: exactText(FENCE_LANGUAGE_MAX_CHARS),
  code: exactText(COLORED_CODE_MAX_CHARS),
});

/** The Tasks tab's plain asks, each answered by the tasks composer. */
export const TASKS_ACTS = declaredActs({
  TASKS_REFRESH: hostAct({
    input: EffectSchema.Undefined,
    output: EffectSchema.Void,
    refusal: "Could not read your tasks on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: undefined,
  }),
  TASKS_SELECT: hostAct({
    input: taskIdParamsSchema,
    output: EffectSchema.Boolean,
    refusal: "Could not open that task on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: false,
  }),
  TASKS_CLOSE: hostAct({
    input: EffectSchema.Undefined,
    output: EffectSchema.Void,
    refusal: "Could not leave that task on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: undefined,
  }),
  TASKS_OFFLINE_REFUSED_CLEAR: hostAct({
    input: EffectSchema.Undefined,
    output: EffectSchema.Void,
    refusal: "Could not clear the changes made offline on this system.",
    panelOnly: true,
    door: ACT.LOCAL_WRITE,
    unanswered: undefined,
  }),
  TASKS_START: hostAct({
    input: tasksStartRequestSchema,
    output: tasksStartAnswerSchema,
    refusal: "Could not start that task on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  TASKS_DELETE: hostAct({
    input: taskIdParamsSchema,
    output: EffectSchema.Boolean,
    refusal: "Could not delete that task on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: false,
  }),
  TASKS_RENAME: hostAct({
    input: tasksRenameParamsSchema,
    output: EffectSchema.Boolean,
    refusal: "Could not rename that task on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: false,
  }),
  TASKS_PIN: hostAct({
    input: tasksPinParamsSchema,
    output: EffectSchema.Boolean,
    refusal: "Could not pin that task on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: false,
  }),
  TASKS_MARK_READ: hostAct({
    input: tasksMarkReadParamsSchema,
    output: EffectSchema.Boolean,
    refusal: "Could not mark that task on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: false,
  }),
  TASKS_PIN_REPOSITORY: hostAct({
    input: tasksPinRepositoryParamsSchema,
    output: EffectSchema.Boolean,
    refusal: "Could not pin that repository on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: false,
  }),
  TASKS_WRITE_SECTION: hostAct({
    input: tasksWriteSectionParamsSchema,
    output: EffectSchema.Boolean,
    refusal: "Could not change that section on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: false,
  }),
  TASKS_SET_REPOSITORY: hostAct({
    input: tasksSetRepositoryParamsSchema,
    output: tasksSetRepositoryAnswerSchema,
    refusal: "Could not change that task's repository on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  TASKS_MOVE: hostAct({
    input: tasksMoveParamsSchema,
    output: tasksMoveAnswerSchema,
    refusal: "Could not move that task on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  TASKS_BLOCK: hostAct({
    input: tasksBlockParamsSchema,
    output: tasksBlockAnswerSchema,
    refusal: "Could not change what blocks that task on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  TASKS_SET_PARENT: hostAct({
    input: tasksSetParentParamsSchema,
    output: tasksSetParentAnswerSchema,
    refusal: "Could not change that task's parent on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  TASKS_CHANGE_RELATION: hostAct({
    input: tasksChangeRelationParamsSchema,
    output: tasksChangeRelationAnswerSchema,
    refusal: "Could not change that relation on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  TASKS_EDIT: hostAct({
    input: tasksEditParamsSchema,
    output: tasksEditAnswerSchema,
    refusal: "Could not save that edit on this system.",
    panelOnly: true,
    door: ACT.DOCUMENT,
    unanswered: UNANSWERED,
  }),
  GITHUB_CONNECT: hostAct({
    input: EffectSchema.Undefined,
    output: tasksGitHubPageAnswerSchema,
    refusal: "Could not open GitHub's connection page on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
    byHand: true,
    portOutput: EffectSchema.Void,
  }),
  ADMIN_READ: hostAct({
    input: adminReadParamsSchema,
    output: adminReadAnswerSchema,
    refusal: "Could not read the admin dashboard on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: ADMIN_READ_UNANSWERED,
  }),
  // Note that no held read carries the admin pages' rows, so their star has none to draw over.
  ADMIN_FAVORITE: hostAct({
    input: adminFavoriteParamsSchema,
    output: EffectSchema.Boolean,
    refusal: "Could not star that account on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: false,
  }),
  GITHUB_DISCONNECT: hostAct({
    input: EffectSchema.Undefined,
    output: EffectSchema.Void,
    refusal: "Could not disconnect GitHub on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
  TASKS_SET_STANDING: hostAct({
    input: tasksSetStandingParamsSchema,
    output: EffectSchema.Boolean,
    refusal: "Could not change where that task stands on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: false,
  }),
  TASKS_FILE: hostAct({
    input: tasksFileParamsSchema,
    output: tasksFileAnswerSchema,
    refusal: "Could not read that file on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: UNANSWERED,
  }),
  TASKS_TREE: hostAct({
    input: tasksTreeParamsSchema,
    output: tasksTreeAnswerSchema,
    refusal: "Could not list that folder on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: UNANSWERED,
  }),
  TASKS_SKILLS: hostAct({
    input: tasksSkillsParamsSchema,
    output: tasksSkillsAnswerSchema,
    refusal: "Could not read this repository's skills on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: UNANSWERED,
  }),
  TASKS_BROWSER_TAB_OPEN: hostAct({
    input: tasksBrowserTabOpenParamsSchema,
    output: tasksBrowserTabOpenAnswerSchema,
    refusal: "Could not open a tab in that agent's browser on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  TASKS_FIND: hostAct({
    input: tasksFindParamsSchema,
    output: tasksFindAnswerSchema,
    refusal: "Could not find that task on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: UNANSWERED,
  }),
  TASKS_REVISIONS: hostAct({
    input: tasksRevisionsParamsSchema,
    output: tasksRevisionsAnswerSchema,
    refusal: "Could not read that description's history on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: UNANSWERED,
  }),
  TASKS_REVISION: hostAct({
    input: tasksRevisionParamsSchema,
    output: tasksRevisionAnswerSchema,
    refusal: "Could not read that version on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: UNANSWERED,
  }),
  TASKS_RESTORE: hostAct({
    input: tasksRevisionParamsSchema,
    output: EffectSchema.Boolean,
    refusal: "Could not restore that version on this system.",
    panelOnly: true,
    door: ACT.DOCUMENT,
    unanswered: false,
  }),
  TASKS_PAGE_SOURCE: hostAct({
    input: tasksPageParamsSchema,
    output: tasksPageSourceAnswerSchema,
    refusal: "Could not read that page's source on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: UNANSWERED,
  }),
  TASKS_PICTURE_READ: hostAct({
    input: tasksPictureParamsSchema,
    output: tasksPictureAnswerSchema,
    refusal: "Could not read that picture on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: UNANSWERED,
  }),
  TASKS_PICTURE_KEEP: hostAct({
    input: tasksPictureKeepParamsSchema,
    output: tasksPictureKeepAnswerSchema,
    refusal: "Could not keep that picture on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  TASKS_COMMENT_START: hostAct({
    input: tasksCommentStartParamsSchema,
    output: tasksCommentAnswerSchema,
    refusal: "Could not comment on the task on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  TASKS_COMMENT_ACT: hostAct({
    input: tasksCommentActParamsSchema,
    output: tasksCommentAnswerSchema,
    refusal: "Could not change the task's comment on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
});

/**
 * The Tasks tab's live reads the host follows for the windows, each held by
 * a key a window names: a workspace's repositories, a link's standing,
 * Browser tabs, pages, a description, its history, and comments. A link's
 * standing, Browser tabs, and pages have no Try again.
 */
export const TASKS_FOLLOWS = liveFollows({
  TASKS_REPOSITORIES_FOLLOW: liveFollow({
    slice: LIVE_READ.REPOSITORY_LISTS,
    hold: HOLD.WINDOW,
    key: tasksRepositoriesParamsSchema,
    refusal: "Could not follow your GitHub repositories on this system.",
    panelOnly: true,
    retry: {
      name: "TASKS_REPOSITORIES_RETRY",
      refusal: "Could not read your GitHub repositories again on this system.",
    },
  }),
  TASKS_LINK_STANDING_FOLLOW: liveFollow({
    slice: LIVE_READ.LINK_STANDINGS,
    hold: HOLD.WINDOW,
    key: tasksLinkStandingParamsSchema,
    refusal: "Could not follow that link on this system.",
    panelOnly: true,
  }),
  TASKS_BROWSER_TABS_FOLLOW: liveFollow({
    slice: LIVE_READ.BROWSER_TABS,
    hold: HOLD.WINDOW,
    key: taskBrowserTabsFollowSchema,
    refusal: "Could not follow the task's Browser tabs on this system.",
    panelOnly: true,
  }),
  TASKS_PAGES_FOLLOW: liveFollow({
    slice: LIVE_READ.PAGES,
    hold: HOLD.WINDOW,
    key: taskPagesFollowSchema,
    refusal: "Could not follow that task's pages on this system.",
    panelOnly: true,
  }),
  TASKS_DOCUMENT_FOLLOW: liveFollow({
    slice: LIVE_READ.DESCRIPTION_DOCUMENT,
    hold: HOLD.WINDOW,
    key: taskDocumentFollowSchema,
    refusal: "Could not follow that task's description on this system.",
    panelOnly: true,
    retry: {
      name: "TASKS_DOCUMENT_RETRY",
      refusal: "Could not read that task's description again on this system.",
    },
  }),
  TASKS_HISTORY_FOLLOW: liveFollow({
    slice: LIVE_READ.HISTORY,
    hold: HOLD.WINDOW,
    key: taskHistoryFollowSchema,
    refusal: "Could not follow that description's history on this system.",
    panelOnly: true,
    retry: {
      name: "TASKS_HISTORY_RETRY",
      refusal: "Could not read that description's history again on this system.",
    },
  }),
  TASKS_COMMENTS_FOLLOW: liveFollow({
    slice: LIVE_READ.DESCRIPTION_COMMENTS,
    hold: HOLD.WINDOW,
    key: tasksCommentsFollowSchema,
    refusal: "Could not follow the task's comments on this system.",
    panelOnly: true,
    retry: {
      name: "TASKS_COMMENTS_RETRY",
      refusal: "Could not read the task's comments again on this system.",
    },
  }),
});

export const tasksActsContract = {
  ...contractOf(TASKS_ACTS),
  ...followsContractOf(TASKS_FOLLOWS),
  [TASKS_ACT_KIND.GITHUB_OPEN]: actProcedure("Could not open GitHub on this system.")
    .input(exactInput(EffectSchema.Struct({ url: githubAddress })))
    .output(EffectSchema.Void),
  [TASKS_ACT_KIND.WEB_OPEN]: actProcedure("Could not open that link on this system.")
    .input(exactInput(EffectSchema.Struct({ url: openableAddress })))
    .output(EffectSchema.Void),
  [TASKS_ACT_KIND.ADMIN_OPEN]: actProcedure("Could not open the admin dashboard on this system.")
    .input(takesNothing)
    .output(EffectSchema.Void),
  [TASKS_ACT_KIND.TASKS_COLOR_CODE]: actProcedure("Could not color that code on this system.")
    .input(exactInput(colorCodeParamsSchema))
    .output(EffectSchema.flip(codeLinesSchema)),
};
