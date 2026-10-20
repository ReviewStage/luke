import { pinnedState } from "@luke/service/agents/brain-host/pinned-state";
import {
  EDIT_PLAN_TOOL,
  requestedNotes,
  reserveNotes,
  settleNotes,
  takenInTurn,
} from "@luke/service/agents/coder-host/plan-edit";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import {
  READ_COMMENTS_TOOL,
  REOPEN_THREAD_TOOL,
  REPLY_TO_COMMENT_TOOL,
  RESOLVE_THREAD_TOOL,
} from "@luke/service/tasks/comment-tools";
import { SHOW_PAGE_TOOL } from "@luke/service/tasks/page-tool";
import { ACTION_RESULT_STATUS, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { editPlanNotes, offeredPlanTools, runCommentTool, runShowPageTool } from "../host.js";
import { planNotesTaken } from "../session-prompt.js";

/**
 * plan.ts -- the agent's tools on its plan: the notes it takes in it, the pages it shows on it, and the comment threads it reads and answers.
 *
 * Each is offered at each turn's start only to an agent on a task
 * (`taskToolsOf`), whether it was handed the plan or a prompt, so one on no
 * plan is never offered a tool it would be refused, and each call reaches
 * the store through the host's door (`../host.ts`).
 *
 * - `edit_plan` is Luke's own: the notetaker's notes, taken into the
 *   agent's plan (`packages/service/src/agents/coder-host/plan-edit.ts`).
 *   The turn's count of notes is the session's own state, pinned before
 *   anything awaits (`packages/service/src/agents/brain-host/pinned-state.ts`).
 *   Note that the call's notes are reserved against the cap before the save
 *   goes out and settled to what was taken once it answers, because calls
 *   one step makes run at once, and each must see the other's reservation.
 * - `show_page` is the brain's tool too (`packages/service/src/tasks/page-tool.ts`):
 *   an interactive HTML page in the task's side panel, or a new version of one.
 * - The four comment tools are the planning model's too
 *   (`packages/service/src/tasks/comment-tools.ts`): read the threads, open
 *   or resolved, for context; answer one a member sent it; resolve one once
 *   what it asked is settled; reopen a resolved one.
 *
 * A picture `edit_plan` adds, or a page `show_page` names by its path, is
 * read from the session's sandbox through the same door eve hands every file
 * tool, opened on first use, so a call with none opens none. One file for
 * all six, each tool named by its key, for the reason `workspace.ts` gives,
 * so the turn asks the host once what it is offered rather than once a tool.
 * Note that its callbacks name nothing but module imports, because eve
 * keeps what a dynamic tool's callback closes over as JSON, and a tool's
 * schema is not.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const offered: ReadonlySet<string> = await offeredPlanTools(ctx.session.auth, ctx.session.id);
      return offered.size === 0
        ? null
        : Object.fromEntries(
            Object.entries({
              [CODER_TOOL.EDIT_PLAN]: defineTool({
                description: EDIT_PLAN_TOOL.description,
                inputSchema: emitJsonSchema(EDIT_PLAN_TOOL.inputSchema),
                execute: async (input, toolContext) => {
                  const taken = pinnedState(planNotesTaken);
                  const turnId = toolContext.session.turn.id;
                  // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
                  const notes = unparsedWire(input as WireBoundaryInput);
                  const requested = requestedNotes(notes);
                  const before = takenInTurn(taken.get(), turnId);
                  taken.update((held) => reserveNotes(held, turnId, requested));
                  const answer = await editPlanNotes(
                    toolContext.session.auth,
                    toolContext.session.id,
                    notes,
                    before,
                    () => toolContext.getSandbox(),
                  );
                  const saved = answer.status === ACTION_RESULT_STATUS.ACCEPTED ? answer.taken : 0;
                  taken.update((held) => settleNotes(held, turnId, requested, saved));
                  return answer;
                },
              }),
              [CODER_TOOL.READ_COMMENTS]: defineTool({
                description: READ_COMMENTS_TOOL.description,
                inputSchema: emitJsonSchema(READ_COMMENTS_TOOL.inputSchema),
                execute: (input, toolContext) =>
                  // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
                  runCommentTool(
                    toolContext.session.auth,
                    toolContext.session.id,
                    READ_COMMENTS_TOOL.name,
                    unparsedWire(input as WireBoundaryInput),
                  ),
              }),
              [CODER_TOOL.REOPEN_THREAD]: defineTool({
                description: REOPEN_THREAD_TOOL.description,
                inputSchema: emitJsonSchema(REOPEN_THREAD_TOOL.inputSchema),
                execute: (input, toolContext) =>
                  // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
                  runCommentTool(
                    toolContext.session.auth,
                    toolContext.session.id,
                    REOPEN_THREAD_TOOL.name,
                    unparsedWire(input as WireBoundaryInput),
                  ),
              }),
              [CODER_TOOL.REPLY_TO_COMMENT]: defineTool({
                description: REPLY_TO_COMMENT_TOOL.description,
                inputSchema: emitJsonSchema(REPLY_TO_COMMENT_TOOL.inputSchema),
                execute: (input, toolContext) =>
                  // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
                  runCommentTool(
                    toolContext.session.auth,
                    toolContext.session.id,
                    REPLY_TO_COMMENT_TOOL.name,
                    unparsedWire(input as WireBoundaryInput),
                  ),
              }),
              [CODER_TOOL.RESOLVE_THREAD]: defineTool({
                description: RESOLVE_THREAD_TOOL.description,
                inputSchema: emitJsonSchema(RESOLVE_THREAD_TOOL.inputSchema),
                execute: (input, toolContext) =>
                  // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
                  runCommentTool(
                    toolContext.session.auth,
                    toolContext.session.id,
                    RESOLVE_THREAD_TOOL.name,
                    unparsedWire(input as WireBoundaryInput),
                  ),
              }),
              [CODER_TOOL.SHOW_PAGE]: defineTool({
                description: SHOW_PAGE_TOOL.description,
                inputSchema: emitJsonSchema(SHOW_PAGE_TOOL.inputSchema),
                execute: async (input, toolContext) =>
                  // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
                  runShowPageTool(
                    toolContext.session.auth,
                    toolContext.session.id,
                    unparsedWire(input as WireBoundaryInput),
                    () => toolContext.getSandbox(),
                  ),
              }),
            }).filter(([name]) => offered.has(name)),
          );
    },
  },
});
