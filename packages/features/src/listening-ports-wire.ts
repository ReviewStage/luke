import { Schema as EffectSchema } from "effect";

export const listeningPortsAnswerSchema = EffectSchema.Struct({
  running: EffectSchema.Boolean,
  ports: EffectSchema.Array(EffectSchema.Int),
});

export type ListeningPortsAnswer = typeof listeningPortsAnswerSchema.Type;
