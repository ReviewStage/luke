import { Effect, Result } from "effect";
import type { SessionAuth } from "eve/context";
import { defineDynamic, defineTool } from "eve/tools";
import { unparsedWire, type WireBoundaryInput } from "../../server/core.js";
import { lookModelOutput } from "../../server/hosted/board-look.js";
import { eveTurnIdOf, type HostedToolBinding } from "../../server/hosted/brain-host/host.js";
import { runWeb } from "../../server/runtime.js";
import { host } from "../host.js";

/**
 * The brain's tools, resolved at every turn's start for the conversation the
 * session was admitted for and the kind of turn the request opened. eve keeps what this resolver returns across its durable
 * steps, so each tool captures only data — its name, the conversation, the
 * turn — and reaches the host through this module's own import when it runs.
 * A session the host does not admit is offered nothing. A subagent offers
 * the named few of the same tools through `hostedTools`, under the admission
 * its resolver can take (`host.admitDelegated`); each call is admitted again
 * as it runs, through the root eve then names. Every result is shown to the
 * model as the JSON it is, and a look at the board as its image
 * (`lookModelOutput`).
 */
export function hostedTools(
  offered?: ReadonlySet<string>,
  admit: (auth: SessionAuth, sessionId: string) => ReturnType<typeof host.admit> = host.admit,
) {
  return defineDynamic({
    events: {
      "turn.started": (event, ctx) =>
        runWeb(
          Effect.gen(function* () {
            const admitted = yield* admit(ctx.session.auth, ctx.session.id);
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
                    // SAFETY: eve hands this the JSON the tool's own execute answered; the reader parses it as wire input.
                    toModelOutput: (output) =>
                      lookModelOutput(unparsedWire(output as WireBoundaryInput)),
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
