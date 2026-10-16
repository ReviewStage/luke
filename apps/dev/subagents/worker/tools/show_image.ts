import { SHOW_IMAGE_TOOL } from "@luke/service/agents/coder-host/show-image";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runDelegatedShowImageTool } from "../../../host.js";

/**
 * show_image.ts -- a worker shows the developer pictures from the agent's sandbox in its own transcript, as one set.
 *
 * The agent's own tool (`../../../tools/show_image.ts`), kept beside the
 * worker's transcript, the child of the delegation that started it, so the
 * worker's tab draws them; the files are read from the checkout the worker
 * shares with the agent.
 */
export default defineTool({
  description: SHOW_IMAGE_TOOL.description,
  inputSchema: emitJsonSchema(SHOW_IMAGE_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runDelegatedShowImageTool(ctx.session, unparsedWire(input as WireBoundaryInput), () =>
      ctx.getSandbox(),
    ),
});
