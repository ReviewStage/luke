import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { LOOK_AT_PICTURE_TOOL, pictureLookModelOutput } from "@luke/service/tasks/picture-look";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { lookAtPlanPicture, offeredTaskTools } from "../host.js";

/**
 * look_at_picture.ts -- the agent looks at one of its plan's pictures, named by the address the plan's text writes it at.
 *
 * The planning model's tool too, one implementation for both
 * (`packages/service/src/tasks/picture-look.ts`). The call reaches the store
 * through the host's door (`../host.ts`), as `edit_plan` does, and its
 * answer is shown to the model as the picture itself, never its base64 as
 * text; the transcript keeps only that it looked. It is offered at each
 * turn's start only to an agent on a task (`taskToolsOf`); the host's
 * refusal stays as the backstop.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredTaskTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.LOOK_AT_PICTURE)
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
                unparsedWire(input as WireBoundaryInput),
              ),
          })
        : null,
  },
});
