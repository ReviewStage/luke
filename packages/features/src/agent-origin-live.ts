import { Schema as EffectSchema, Option } from "effect";
import type { AgentOrigin } from "./agent-wire.js";
import { AUTOMATION_FIRING, automationFiringSchema } from "./automation-wire.js";
import { sealedLiveQuerySchema } from "./live-wire.js";

export const agentOriginLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ origin: sealedLiveQuerySchema }),
});

export type AgentOriginLiveAnswer = typeof agentOriginLiveAnswerSchema.Type;

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

export function agentOriginOfLive(rows: readonly unknown[]): AgentOrigin | null | undefined {
  const read = readRows(rows);
  if (Option.isNone(read)) return undefined;
  const [row] = read.value;
  return row === undefined ? null : originOf(row);
}
