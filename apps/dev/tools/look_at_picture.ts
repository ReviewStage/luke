import { LOOK_AT_PICTURE_TOOL, pictureLookModelOutput } from "@luke/service/tasks/picture-look";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { lookAtPlanPicture } from "../host.js";

/**
 * look_at_picture.ts -- the agent looks at one of its plan's pictures, named by the address the plan's text writes it at.
 *
 * The planning model's tool too, one implementation for both
 * (`packages/service/src/plans/picture-look.ts`). The call reaches the store
 * through the host's door (`../host.ts`), as `edit_plan` does, and its
 * answer is shown to the model as the picture itself, never its base64 as
 * text; the transcript keeps only that it looked.
 */
export default defineTool({
  description: LOOK_AT_PICTURE_TOOL.description,
  inputSchema: emitJsonSchema(LOOK_AT_PICTURE_TOOL.inputSchema),
  // SAFETY: eve hands this the JSON the tool's own execute answered; the reader parses it as wire input.
  toModelOutput: (output) => pictureLookModelOutput(unparsedWire(output as WireBoundaryInput)),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    lookAtPlanPicture(ctx.session.auth, ctx.session.id, unparsedWire(input as WireBoundaryInput)),
});
