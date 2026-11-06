import {
  type GatewayHost,
  NODE_CAPABILITY_STATUS,
  type NodeCapabilityResult,
  type NodeRegistry,
  type RemoteNodeInvoker,
} from "@repo/gateway";
import { isWireString } from "@repo/wire";
import { Data, Effect, type Scope } from "effect";
import { createHostOperator, type HostOperator } from "../host-operator.js";
import {
  HOST_NATIVE_NODE_ID,
  HOST_NODE_CAPABILITY,
  HOST_NODE_CAPABILITY_LIST,
} from "../node-capabilities.js";
import type { AppStateStore } from "./app-state-store.js";

export interface GatewayWiringDependencies {
  gateway: GatewayHost;
  nodes: Pick<NodeRegistry, "registerRemote" | "unregister">;
  report: (message: string) => void;
  state: AppStateStore;
  node: {
    openExternal: (url: string) => Promise<void>;
  };
}

export interface GatewayWiring {
  readonly host: HostOperator;
}

export const wireGateway = Effect.fn("client/wireGateway")(function* (
  dependencies: GatewayWiringDependencies,
): Effect.fn.Return<GatewayWiring, never, Scope.Scope> {
  const { gateway, state, report } = dependencies;
  const host = createHostOperator({
    client: gateway,
    report,
  });

  const stopTasks = host.onTasksChanged((tasks) => {
    state.update({ tasks: tasks });
  });
  yield* Effect.addFinalizer(() => Effect.sync(stopTasks));

  const perform: RemoteNodeInvoker = (capability, params) =>
    Effect.suspend(() => {
      const failed = (reason: string): Effect.Effect<NodeCapabilityResult> =>
        Effect.succeed({ status: NODE_CAPABILITY_STATUS.FAILED, capability, reason });
      switch (capability) {
        case HOST_NODE_CAPABILITY.OPEN_EXTERNAL: {
          const { url } = params;
          if (!isWireString(url)) return failed("open needs a url");
          return Effect.tryPromise({
            try: () => dependencies.node.openExternal(url),
            catch: (cause) => new OpenExternalFailed({ cause }),
          }).pipe(
            Effect.as<NodeCapabilityResult>({
              status: NODE_CAPABILITY_STATUS.OK,
              value: undefined,
            }),
            Effect.catch((error) => failed(error.message)),
          );
        }
        default:
          return Effect.succeed({
            status: NODE_CAPABILITY_STATUS.UNAVAILABLE,
            capability,
            reason: "this node offers no such capability",
          });
      }
    });

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      dependencies.nodes.registerRemote({
        nodeId: HOST_NATIVE_NODE_ID,
        capabilities: [...HOST_NODE_CAPABILITY_LIST],
        invoke: (capability, params) =>
          Effect.catchDefect(perform(capability, params), (defect) =>
            Effect.succeed<NodeCapabilityResult>({
              status: NODE_CAPABILITY_STATUS.FAILED,
              capability,
              reason: defect instanceof Error ? defect.message : String(defect),
            }),
          ),
      });
    }),
    () =>
      Effect.sync(() => {
        dependencies.nodes.unregister(HOST_NATIVE_NODE_ID);
      }),
  );

  return { host };
});

class OpenExternalFailed extends Data.TaggedError("OpenExternalFailed")<{
  readonly cause: unknown;
}> {
  override get message(): string {
    const { cause } = this;
    return cause instanceof Error ? cause.message : String(cause);
  }
}
