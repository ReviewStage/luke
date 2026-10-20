import { SHOW_IMAGE_TOOL } from "@luke/service/agents/coder-host/show-image";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runShowImageTool } from "../host.js";

/**
 * show_image.ts -- the agent shows the developer pictures from its sandbox in its transcript, as one set.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * `show_page` does (`packages/service/src/agents/coder-host/show-image.ts`),
 * and each file is read from the session's sandbox through the same door
 * eve hands every file tool, opened on first use.
 */
export default defineTool({
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
});
