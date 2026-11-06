import { Effect } from "effect";
import { PORT_FORWARD_ACT_KIND } from "../contract/index.js";
import type { HostOperator } from "../host-operator.js";
import { actPortFor } from "./base.js";
import type { PlatformActProcedures } from "./index.js";

type PortForwardActKind = (typeof PORT_FORWARD_ACT_KIND)[keyof typeof PORT_FORWARD_ACT_KIND];

export interface PortForwardActsDependencies {
  host: Pick<HostOperator, "portForwardSet">;
}

function answeredOr<Answer, E>(
  answer: Effect.Effect<Answer | undefined>,
  refused: () => E,
): Effect.Effect<Answer, E> {
  return Effect.flatMap(answer, (value) =>
    value === undefined ? Effect.fail(refused()) : Effect.succeed(value),
  );
}

export function portForwardProcedures<Sender>(
  dependencies: PortForwardActsDependencies,
): Pick<PlatformActProcedures<Sender>, PortForwardActKind> {
  const { host } = dependencies;
  const port = actPortFor<Sender>();
  return {
    [PORT_FORWARD_ACT_KIND.PORT_FORWARD_SET]: port[PORT_FORWARD_ACT_KIND.PORT_FORWARD_SET].effect(
      function* ({ input, context, errors }) {
        if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
        return yield* answeredOr(host.portForwardSet(input), () => errors.REFUSED());
      },
    ),
  };
}
