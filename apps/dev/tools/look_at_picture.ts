import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { LOOK_AT_PICTURE_TOOL, pictureLookModelOutput } from "@luke/service/plans/picture-look";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { lookAtPlanPicture, offeredPlanTools } from "../host.js";

/**
 * look_at_picture.ts -- the agent looks at one of its plan's pictures, named by the address the plan's text writes it at.
 *
 * The planning model's tool too, one implementation for both
 * (`packages/service/src/plans/picture-look.ts`). The call reaches the store
 * through the host's door (`../host.ts`), as `edit_plan` does, and its
 * answer is shown to the model as the picture itself, never its base64 as
 * text; the transcript keeps only that it looked. It is offered at each
 * turn's start only to an agent handed its plan (`planToolsOf`), the one
 * that read the pictures' addresses.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredPlanTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.LOOK_AT_PICTURE)
        ? defineTool({
            description: LOOK_AT_PICTURE_TOOL.description,
            inputSchema: emitJsonSchema(LOOK_AT_PICTURE_TOOL.inputSchema),
            // SAFETY: eve hands this the JSON the tool's own execute answered; the reader parses it as wire input.
            toModelOutput: (output) =>
              pictureLookModelOutput(unparsedWire(output as WireBoundaryInput)),
            execute: async (input, toolContext) =>
              // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
              lookAtPlanPicture(
                toolContext.session.auth,
                toolContext.session.id,
                toolContext.session.turn.id,
                unparsedWire(input as WireBoundaryInput),
              ),
          })
        : null,
  },
});
