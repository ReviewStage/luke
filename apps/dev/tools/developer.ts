import { INBOX_TOOL } from "@luke/features/inbox-wire";
import { INBOX_TOOLS } from "@luke/service/agents/coder-host/inbox";
import { OPEN_PULL_REQUEST_TOOL } from "@luke/service/agents/coder-host/pull-request";
import { SHOW_IMAGE_TOOL } from "@luke/service/agents/coder-host/show-image";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { LOOK_AT_PICTURE_TOOL, pictureLookModelOutput } from "@luke/service/tasks/picture-look";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { lookAtPlanPicture, runInboxTool, runPullRequestTool, runShowImageTool } from "../host.js";

/**
 * developer.ts -- what the agent hands the developer, and what it looks at of theirs: the inbox, the pull request, the pictures it shows, and the plan's pictures it looks at.
 *
 * Each call reaches the store or the service through the host's door
 * (`../host.ts`), under the agent its session was admitted to.
 *
 * - The inbox's four (`packages/service/src/agents/coder-host/inbox.ts`)
 *   answer with the agent's whole inbox as it stands; a post's or a
 *   reply's picture is read from the session's sandbox through the door eve
 *   hands every file tool, opened on first use, so one with none opens none.
 * - `open_pull_request` is opened on GitHub by the service, with the
 *   developer's own token where the agent writes as them
 *   (`packages/service/src/agents/coder-host/pull-request.ts`), so that
 *   token never stands at the sandbox's firewall.
 * - `show_image` shows pictures from the sandbox in the agent's transcript,
 *   as one set (`packages/service/src/agents/coder-host/show-image.ts`).
 * - `look_at_picture` is the planning model's tool too
 *   (`packages/service/src/tasks/picture-look.ts`); its answer is shown to
 *   the model as the picture itself, never its base64 as text, and the
 *   transcript keeps only that it looked.
 *
 * One file for all of them, on the terms `workspace.ts` gives: resolved
 * once a session starts, reading nothing, each tool named by its key.
 */
export default defineDynamic({
  events: {
    "session.started": async () => ({
      [CODER_TOOL.CLOSE_INBOX_ITEM]: defineTool({
        description: INBOX_TOOLS.CLOSE.description,
        inputSchema: emitJsonSchema(INBOX_TOOLS.CLOSE.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runInboxTool(ctx.session.auth, ctx.session.id, {
            tool: INBOX_TOOL.CLOSE,
            input: unparsedWire(input as WireBoundaryInput),
          }),
      }),
      [CODER_TOOL.LOOK_AT_PICTURE]: defineTool({
        description: LOOK_AT_PICTURE_TOOL.description,
        inputSchema: emitJsonSchema(LOOK_AT_PICTURE_TOOL.inputSchema),
        // SAFETY: eve hands this the JSON the tool's own execute answered; the reader parses it as wire input.
        toModelOutput: (output) =>
          pictureLookModelOutput(unparsedWire(output as WireBoundaryInput)),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          lookAtPlanPicture(
            ctx.session.auth,
            ctx.session.id,
            unparsedWire(input as WireBoundaryInput),
          ),
      }),
      [CODER_TOOL.OPEN_PULL_REQUEST]: defineTool({
        description: OPEN_PULL_REQUEST_TOOL.description,
        inputSchema: emitJsonSchema(OPEN_PULL_REQUEST_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runPullRequestTool(
            ctx.session.auth,
            ctx.session.id,
            unparsedWire(input as WireBoundaryInput),
          ),
      }),
      [CODER_TOOL.POST_TO_INBOX]: defineTool({
        description: INBOX_TOOLS.POST.description,
        inputSchema: emitJsonSchema(INBOX_TOOLS.POST.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runInboxTool(ctx.session.auth, ctx.session.id, {
            tool: INBOX_TOOL.POST,
            input: unparsedWire(input as WireBoundaryInput),
            sandbox: () => ctx.getSandbox(),
          }),
      }),
      [CODER_TOOL.READ_INBOX]: defineTool({
        description: INBOX_TOOLS.READ.description,
        inputSchema: emitJsonSchema(INBOX_TOOLS.READ.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runInboxTool(ctx.session.auth, ctx.session.id, {
            tool: INBOX_TOOL.READ,
            input: unparsedWire(input as WireBoundaryInput),
          }),
      }),
      [CODER_TOOL.REPLY_INBOX]: defineTool({
        description: INBOX_TOOLS.REPLY.description,
        inputSchema: emitJsonSchema(INBOX_TOOLS.REPLY.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runInboxTool(ctx.session.auth, ctx.session.id, {
            tool: INBOX_TOOL.REPLY,
            input: unparsedWire(input as WireBoundaryInput),
            sandbox: () => ctx.getSandbox(),
          }),
      }),
      [CODER_TOOL.SHOW_IMAGE]: defineTool({
        description: SHOW_IMAGE_TOOL.description,
        inputSchema: emitJsonSchema(SHOW_IMAGE_TOOL.inputSchema),
        execute: async (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runShowImageTool(
            ctx.session.auth,
            ctx.session.id,
            unparsedWire(input as WireBoundaryInput),
            () => ctx.getSandbox(),
          ),
      }),
    }),
  },
});
