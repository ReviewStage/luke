import { Schema as EffectSchema, Option } from "effect";
import type { AgentOrigin } from "./agent-wire.js";
import { AUTOMATION_FIRING, automationFiringSchema } from "./automation-wire.js";
import { sealedLiveQuerySchema } from "./live-wire.js";

/**
 * agent-origin-live.ts -- the run of an automation that started one agent, as the host follows it over the service's held poll: the statement the service answers, and the origin its row makes.
 *
 * The service answers one statement, the agent's row as it kept the run
 * that started it, with the name of the member who asked for a run now as
 * their account names them, or no row for an agent no run started or the
 * reader does not reach. The row is drawn into the origin the agent's own
 * page reads (`status.ts`'s `agentPage`), so a page drawn from it says what
 * a page read whole says.
 */

/**
 * An agent's origin sealed for following: the address, and the one
 * statement of its run. Asked to poll, the service answers the statement's
 * rows inline instead (`LIVE_POLL`).
 */
export const agentOriginLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ origin: sealedLiveQuerySchema }),
});

export type AgentOriginLiveAnswer = typeof agentOriginLiveAnswerSchema.Type;

/** The run as the agent's row kept it, and the name of the member a "Run now" names, where their account stands. */
const originLiveRowSchema = EffectSchema.Struct({
  origin: EffectSchema.Struct({
    firing: automationFiringSchema,
    prompt: EffectSchema.String,
    body: EffectSchema.optionalKey(EffectSchema.String),
  }),
  runnerName: EffectSchema.NullOr(EffectSchema.String),
});

type OriginLiveRow = typeof originLiveRowSchema.Type;

const readRows = EffectSchema.decodeUnknownOption(EffectSchema.Array(originLiveRowSchema));

/** The run as its page reads it: the prompt alone, the issue or pull request a GitHub event named, a webhook's body, and the member who asked for a run now, where their account stands. */
function originOf({ origin, runnerName }: OriginLiveRow): AgentOrigin {
  const { firing } = origin;
  const subject =
    firing.kind === AUTOMATION_FIRING.GITHUB && firing.number !== undefined
      ? {
          number: firing.number,
          ...(firing.title === undefined ? undefined : { title: firing.title }),
          ...(firing.url === undefined ? undefined : { url: firing.url }),
        }
      : undefined;
  const runner =
    firing.kind === AUTOMATION_FIRING.MANUAL && firing.userId !== undefined
      ? firing.userId
      : undefined;
  return {
    prompt: origin.prompt,
    ...(subject === undefined ? undefined : { subject }),
    ...(origin.body === undefined ? undefined : { body: origin.body }),
    ...(runner === undefined || runnerName === null
      ? undefined
      : { runBy: { userId: runner, name: runnerName } }),
  };
}

/**
 * The run that started the agent as the live statement's rows stand: null
 * where they hold none, an agent no run started; none where a row is off
 * its own shape.
 */
export function agentOriginOfLive(rows: readonly unknown[]): AgentOrigin | null | undefined {
  const read = readRows(rows);
  if (Option.isNone(read)) return undefined;
  const [row] = read.value;
  return row === undefined ? null : originOf(row);
}
