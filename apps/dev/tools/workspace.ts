import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import {
  CODER_READ_AGENT_TOOL,
  LIST_AGENTS_TOOL,
  LIST_MODELS_TOOL,
  LIST_TASKS_TOOL,
  MESSAGE_AGENT_TOOL,
  READ_PAGE_TOOL,
  START_AGENT_TOOL,
  STOP_AGENT_TOOL,
  UPDATE_AGENT_TOOL,
  UPDATE_TASK_TOOL,
} from "@luke/service/agents/coding-agent-tools";
import {
  CREATE_ISSUE_TOOL,
  LIST_ISSUES_TOOL,
  READ_ISSUE_TOOL,
  UPDATE_ISSUE_TOOL,
} from "@luke/service/agents/issue-tools";
import { CREATE_SECTION_TOOL, DELETE_SECTION_TOOL } from "@luke/service/agents/task-section-tools";
import { CREATE_TASK_TOOL, READ_TASK_TOOL } from "@luke/service/agents/task-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * workspace.ts -- the agent's tools over its workspace: the other coding agents, the tasks and the sidebar's sections, the issues, and the models it may start an agent on.
 *
 * The planning model's own tools too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`, `task-tools.ts`,
 * `task-section-tools.ts`, `issue-tools.ts`). Each call reaches the store
 * through the host's door (`../host.ts`), under the agent its session was
 * admitted to, as the member who started it, and under eve's id for the
 * call, so a call run again acts once. A start is told which agent started
 * it and how to report back; a Stop takes the path the developer's Stop
 * button takes; an archive stops no agent; a model the catalog refuses
 * changes nothing.
 *
 * One file for all of them, each tool named by its key, rather than a file
 * each, because eve bundles and evaluates every authored file on its own
 * at build time, and each of these reaches the whole production host: a
 * file each was most of the agent's build. The set is resolved once a
 * session starts, and the resolver reads nothing, so it is the same set
 * every turn and a process that resumes the session rebinds it as it was.
 * Note that its callbacks name nothing but module imports, because eve
 * keeps what a dynamic tool's callback closes over as JSON.
 */
export default defineDynamic({
  events: {
    "session.started": async () => ({
      [CODER_TOOL.CREATE_ISSUE]: defineTool({
        description: CREATE_ISSUE_TOOL.description,
        inputSchema: emitJsonSchema(CREATE_ISSUE_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.CREATE_ISSUE,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.CREATE_SECTION]: defineTool({
        description: CREATE_SECTION_TOOL.description,
        inputSchema: emitJsonSchema(CREATE_SECTION_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.CREATE_SECTION,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.CREATE_TASK]: defineTool({
        description: CREATE_TASK_TOOL.description,
        inputSchema: emitJsonSchema(CREATE_TASK_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.CREATE_TASK,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.DELETE_SECTION]: defineTool({
        description: DELETE_SECTION_TOOL.description,
        inputSchema: emitJsonSchema(DELETE_SECTION_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.DELETE_SECTION,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.LIST_AGENTS]: defineTool({
        description: LIST_AGENTS_TOOL.description,
        inputSchema: emitJsonSchema(LIST_AGENTS_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.LIST_AGENTS,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.LIST_ISSUES]: defineTool({
        description: LIST_ISSUES_TOOL.description,
        inputSchema: emitJsonSchema(LIST_ISSUES_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.LIST_ISSUES,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.LIST_MODELS]: defineTool({
        description: LIST_MODELS_TOOL.description,
        inputSchema: emitJsonSchema(LIST_MODELS_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.LIST_MODELS,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.LIST_TASKS]: defineTool({
        description: LIST_TASKS_TOOL.description,
        inputSchema: emitJsonSchema(LIST_TASKS_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.LIST_TASKS,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.MESSAGE_AGENT]: defineTool({
        description: MESSAGE_AGENT_TOOL.description,
        inputSchema: emitJsonSchema(MESSAGE_AGENT_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.MESSAGE_AGENT,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.READ_AGENT]: defineTool({
        description: CODER_READ_AGENT_TOOL.description,
        inputSchema: emitJsonSchema(CODER_READ_AGENT_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.READ_AGENT,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.READ_ISSUE]: defineTool({
        description: READ_ISSUE_TOOL.description,
        inputSchema: emitJsonSchema(READ_ISSUE_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.READ_ISSUE,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.READ_PAGE]: defineTool({
        description: READ_PAGE_TOOL.description,
        inputSchema: emitJsonSchema(READ_PAGE_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.READ_PAGE,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.READ_TASK]: defineTool({
        description: READ_TASK_TOOL.description,
        inputSchema: emitJsonSchema(READ_TASK_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.READ_TASK,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.START_AGENT]: defineTool({
        description: START_AGENT_TOOL.description,
        inputSchema: emitJsonSchema(START_AGENT_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.START_AGENT,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.STOP_AGENT]: defineTool({
        description: STOP_AGENT_TOOL.description,
        inputSchema: emitJsonSchema(STOP_AGENT_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.STOP_AGENT,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.UPDATE_AGENT]: defineTool({
        description: UPDATE_AGENT_TOOL.description,
        inputSchema: emitJsonSchema(UPDATE_AGENT_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.UPDATE_AGENT,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.UPDATE_ISSUE]: defineTool({
        description: UPDATE_ISSUE_TOOL.description,
        inputSchema: emitJsonSchema(UPDATE_ISSUE_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.UPDATE_ISSUE,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
      [CODER_TOOL.UPDATE_TASK]: defineTool({
        description: UPDATE_TASK_TOOL.description,
        inputSchema: emitJsonSchema(UPDATE_TASK_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runAgentTool(ctx.session.auth, ctx.session.id, {
            tool: CODER_TOOL.UPDATE_TASK,
            input: unparsedWire(input as WireBoundaryInput),
            callId: ctx.callId,
          }),
      }),
    }),
  },
});
