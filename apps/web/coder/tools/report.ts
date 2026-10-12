import { emitJsonSchema } from "@sidecar/wire/effect";
import { defineTool } from "eve/tools";
import { unparsedWire, type WireBoundaryInput } from "../../server/core.js";
import { pinnedState } from "../../server/hosted/brain-host/pinned-state.js";
import { REPORT_TOOL } from "../../server/hosted/coder-host/report.js";
import { reportToLuke } from "../host.js";
import { sandboxRecord } from "../session-prompt.js";

/**
 * report.ts -- a rollout worker reports a milestone of its pull request, or asks a question, to Luke on the plan's conversation.
 *
 * The call reaches the store and eve through the host's door (`../host.ts`),
 * as `edit_plan` does, keyed by eve's id for the call
 * (`server/hosted/coder-host/report.ts`). The sandbox is handed along only
 * where the session has opened one, read off its record before anything
 * awaits, so a report never opens a sandbox, checkout and all, to read a
 * branch nothing was cut on.
 */
export default defineTool({
  description: REPORT_TOOL.description,
  inputSchema: emitJsonSchema(REPORT_TOOL.inputSchema),
  execute: async (input, ctx) => {
    const opened = pinnedState(sandboxRecord).get().openedAt !== undefined;
    return reportToLuke(ctx.session.auth, ctx.session.id, {
      callId: ctx.callId,
      // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
      input: unparsedWire(input as WireBoundaryInput),
      sandbox: opened ? () => ctx.getSandbox() : undefined,
    });
  },
});
