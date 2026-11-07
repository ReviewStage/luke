import { Schema as EffectSchema, Option } from "effect";
import type { AgentOrigin } from "./agent-wire.js";
import { AUTOMATION_FIRING, automationFiringSchema } from "./automation-wire.js";
import { refuses } from "./contract/base.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
} from "./live-read.js";
import { LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

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
 * An agent's origin as its page follows it: one part, the agent's row as it
 * kept the run that started it, by the agent the query names under `?id=`,
 * and `not-found` for an agent the account does not reach. Asked to poll,
 * the service answers the statement's rows inline instead (`LIVE_POLL`).
 */
export const AGENT_ORIGIN_READ = liveRead({
  name: "agentOrigin",
  path: HOSTED_SERVICE_PATH.LIVE_AGENT_ORIGIN,
  params: { id: LIVE_PARAM.ID, [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    origin: liveRows({
      /** The run as the agent's row kept it, and the name of the member a "Run now" names, where their account stands. */
      row: EffectSchema.Struct({
        origin: EffectSchema.Struct({
          firing: automationFiringSchema,
          prompt: EffectSchema.String,
          body: EffectSchema.optionalKey(EffectSchema.String),
        }),
        runnerName: EffectSchema.NullOr(EffectSchema.String),
      }),
      key: "runnerName",
      order: [["runnerName", ORDER.ASC]],
    }),
  },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

export type AgentOriginLiveAnswer = LiveReadAnswer<typeof AGENT_ORIGIN_READ>;

type OriginLiveRow = LiveRowOf<typeof AGENT_ORIGIN_READ.parts.origin>;

const readRows = EffectSchema.decodeUnknownOption(AGENT_ORIGIN_READ.rows.fields.origin);

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
