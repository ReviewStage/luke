import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { TODOS_SAVED, TODOS_TOOL } from "../../server/hosted/coder-host/todos.js";

/**
 * write_todos.ts -- the agent writes its whole to-do list, which its tab draws where the call landed.
 *
 * The list is the call's input and eve holds it to the schema before the
 * call runs, so there is nothing for the body to do but answer
 * (`server/hosted/coder-host/todos.ts`).
 */
export default defineTool({
  description: TODOS_TOOL.description,
  inputSchema: emitJsonSchema(TODOS_TOOL.inputSchema),
  execute: async () => TODOS_SAVED,
});
