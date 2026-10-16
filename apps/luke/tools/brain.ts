import { eveTurnIdOf, type HostedToolBinding } from "@luke/service/agents/brain-host/host";
import { PLANNER_TOOL_NAMES, planningModelOutput } from "@luke/service/agents/brain-host/planning";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Effect, Result } from "effect";
import type { SessionAuth } from "eve/context";
import { defineDynamic, defineTool } from "eve/tools";
import { host } from "../host.js";
import { runAgent } from "../runtime.js";

/**
 * The brain's tools, resolved at every turn's start for the conversation the
 * session was admitted for and the kind of turn the request opened. eve keeps what this resolver returns across its durable
 * steps, so each tool captures only data — its name, the conversation, the
 * turn — and reaches the host through this module's own import when it runs.
 * A session the host does not admit is offered nothing. A subagent offers
 * the named few of the same tools through `hostedTools`, under the admission
 * its resolver can take (`host.admitDelegated`); each call is admitted again
 * as it runs, through the root eve then names. Every result is shown to the
 * model as the JSON it is, and a look at the board or at one of the plan's
 * pictures as its image (`planningModelOutput`).
 */
export function hostedTools(
  offered: ReadonlySet<string> = PLANNER_TOOL_NAMES,
  admit: (auth: SessionAuth, sessionId: string) => ReturnType<typeof host.admit> = host.admit,
) {
  return defineDynamic({
    events: {
      "turn.started": (event, ctx) =>
        runAgent(
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
              .filter((declared) => offered.has(declared.name));
            return Object.fromEntries(
              declarations.map((declared) => {
                const name = declared.name;
                return [
                  name,
                  defineTool({
                    description: declared.description,
                    inputSchema: declared.inputSchema,
                    ...(declared.endsTurn === undefined
                      ? undefined
                      : { endsTurn: declared.endsTurn }),
                    // SAFETY: eve hands this the JSON the tool's own execute answered; the reader parses it as wire input.
                    toModelOutput: (output) =>
                      planningModelOutput(name, unparsedWire(output as WireBoundaryInput)),
                    execute: (input, toolContext) =>
                      runAgent(
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
