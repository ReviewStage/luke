import { Schema as EffectSchema } from "effect";
import { factoryWorldAnswerSchema, factoryWorldRequestSchema } from "./factory-world-wire.js";

/**
 * factory-world-view.ts -- a workspace's Factory world as one Mac's window hears it: the service's answer whole, or why there is none.
 *
 * The host asks the service on the window's behalf (`factory-world-client.ts`)
 * and answers the window one of the shapes here: the world the service
 * answered, null where the workspace has no repository to draw, or the one
 * word for why there is no answer, which the window says and offers to try
 * again on.
 */

/** Why a world call answered nothing a window can draw. */
export const FACTORY_WORLD_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, GitHub, or a shape not read. */
  UNANSWERED: "unanswered",
  /** The workspace is gone or not the account's to reach. */
  NOT_FOUND: "not-found",
} as const;

/** The world asked for: the workspace, as the service takes it. */
export const factoryWorldParamsSchema = factoryWorldRequestSchema;

export type FactoryWorldParams = typeof factoryWorldParamsSchema.Type;

/** A workspace's world as the window hears it. */
export const factoryWorldViewSchema = EffectSchema.Union([
  factoryWorldAnswerSchema,
  EffectSchema.Struct({
    failure: EffectSchema.Literals(Object.values(FACTORY_WORLD_CALL_FAILURE)),
  }),
]);

export type FactoryWorldView = typeof factoryWorldViewSchema.Type;
