import { Effect, type Layer, Option, Tracer } from "effect";
import type { HttpRouter } from "effect/http";

export interface Route {
  fetch: (request: Request) => Promise<Response>;
}

export const ANY_METHOD = "*";

export const ANY_PATH = "*";

export type WebRoutes<R> = Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter | HttpRouter.Request.From<"Requires", R>
>;

export const traceIdAnnotated = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.serviceOption(Tracer.ParentSpan), (span) =>
    Option.match(span, {
      onNone: () => effect,
      onSome: ({ traceId }) => Effect.annotateLogs(effect, "traceId", traceId),
    }),
  );
