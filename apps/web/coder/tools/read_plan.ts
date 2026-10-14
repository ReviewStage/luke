import { emitJsonSchema } from "@sidecar/wire/effect";
import { defineTool } from "eve/tools";
import { READ_PLAN_TOOL } from "../../server/hosted/coder-host/plan-read.js";
import { readAgentPlan } from "../host.js";

/**
 * read_plan.ts -- the agent reads its plan whole, as it stands now.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * `edit_plan` does, and answers with the plan as Markdown
 * (`server/hosted/coder-host/plan-read.ts`). It runs nothing in the sandbox.
 */
export default defineTool({
  description: READ_PLAN_TOOL.description,
  inputSchema: emitJsonSchema(READ_PLAN_TOOL.inputSchema),
  execute: async (_input, ctx) => readAgentPlan(ctx.session.auth, ctx.session.id),
});
