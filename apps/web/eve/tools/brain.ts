import { Effect, Result } from "effect";
import { defineDynamic, defineTool } from "eve/tools";
import { unparsedWire, type WireBoundaryInput } from "../../server/core.js";
import {
  conversationSessionOf,
  eveTurnIdOf,
  type HostedToolBinding,
} from "../../server/hosted/brain-host/host.js";
import { runWeb } from "../../server/runtime.js";
import { host } from "../host.js";

/**
 * The brain's tools, resolved at every turn's start for the conversation the
 * session was admitted for and the kind of turn the request opened. eve keeps what this resolver returns across its durable
 * steps, so each tool captures only data — its name, the conversation, the
 * turn — and reaches the host through this module's own import when it runs.
 * A session the host does not admit is offered nothing. A subagent offers
 * the named few of the same tools through `hostedTools`, admitted through the
 * root session it was delegated from (`conversationSessionOf`).
 */
export function hostedTools(offered?: ReadonlySet<string>) {
  return defineDynamic({
    events: {
      "turn.started": (event, ctx) =>
        runWeb(
          Effect.gen(function* () {
            const admitted = yield* host.admit(
              ctx.session.auth,
              conversationSessionOf(ctx.session),
            );
            if (Result.isFailure(admitted)) return null;
            // SAFETY: eve hands a resolver the JSON event it recorded; the host reads it as wire input.
            const eveTurnId = eveTurnIdOf(unparsedWire(event as WireBoundaryInput));
            if (eveTurnId === undefined) return null;
            const turn = host.turnOf(ctx.session.auth, ctx.session.id, eveTurnId);
            if (!turn) return null;
            const { target } = admitted.success;
            const binding: HostedToolBinding = { target, turn };
            const declarations = host
              .toolDeclarations()
              .filter((declared) => offered === undefined || offered.has(declared.name));
            return Object.fromEntries(
              declarations.map((declared) => {
                const name = declared.name;
                return [
                  name,
                  defineTool({
                    description: declared.description,
                    inputSchema: declared.inputSchema,
                    execute: (input, toolContext) =>
                      runWeb(
                        host.runTool(
                          name,
                          binding,
                          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
                          unparsedWire(input as WireBoundaryInput),
                          toolContext,
                        ),
                      ),
                  }),
                ];
              }),
            );
          }),
        ),
    },
  });
}

export default hostedTools();
