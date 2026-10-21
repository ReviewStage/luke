/**
 * gateway-wiring.ts -- the Gateway boundary as a client composes it: one
 * operator over the host it is handed, the host's events relayed to the
 * document the windows draw from, and this process's native capabilities
 * registered as one node on the host's registry. The runtime itself stands
 * behind the host; nothing here composes a store or a brain.
 */

import {
  type MacBrowserParams,
  type MacCommandResult,
  macBrowserParamsSchema,
} from "@luke/features/mac-command-wire";
import {
  type GatewayHost,
  NODE_CAPABILITY_STATUS,
  type NodeCapabilityResult,
  type NodeRegistry,
  type RemoteNodeInvoker,
} from "@luke/gateway";
import { isWireString } from "@luke/wire";
import { Data, Effect, Result, Schema, type Scope } from "effect";
import { createHostOperator, type HostOperator } from "../host-operator.js";
import {
  HOST_NATIVE_NODE_ID,
  HOST_NODE_CAPABILITY,
  HOST_NODE_CAPABILITY_LIST,
} from "../node-capabilities.js";
import type { AppStateStore } from "./app-state-store.js";

export interface GatewayWiringDependencies {
  gateway: GatewayHost;
  /** This process's node is registered on this registry, where the host asks for its capabilities. */
  nodes: Pick<NodeRegistry, "registerRemote" | "unregister">;
  report: (message: string) => void;
  /** What the host says, written down once; the windows are told from it. */
  state: AppStateStore;
  /** This machine's native capabilities, performed here at the host's ask. */
  node: {
    openExternal: (url: string) => Promise<void>;
    /** Runs an agent's browser actions on this Mac's Browser tabs; none where this client holds no Browser tabs, as a browser tab's does not. */
    browserAct?: ((params: MacBrowserParams) => Effect.Effect<MacCommandResult>) | undefined;
  };
}

const decodeBrowserParams = Schema.decodeUnknownResult(macBrowserParamsSchema);

export interface GatewayWiring {
  readonly host: HostOperator;
}

export const wireGateway = /* @__PURE__ */ Effect.fn("client/wireGateway")(function* (
  dependencies: GatewayWiringDependencies,
): Effect.fn.Return<GatewayWiring, never, Scope.Scope> {
  const { gateway, state, report } = dependencies;
  const host = createHostOperator({
    client: gateway,
    report,
  });

  // What the host tells its clients of the panel's tasks, written to the
  // document every window is told from. The subscription is the scope's, so
  // the close that ends the wiring ends it.
  const stopTasks = host.onTasksChanged((tasks) => {
    state.update({ tasks: tasks });
  });
  yield* Effect.addFinalizer(() => Effect.sync(stopTasks));

  /**
   * The capabilities this process performs at the host's ask. Each is
   * validated here before anything native runs — the address a string, a
   * browser act's task and actions read whole — and
   * each answers the host's own result vocabulary, so a refusal is typed and
   * never a throw.
   */
  const perform: RemoteNodeInvoker = (capability, params) =>
    Effect.suspend(() => {
      const failed = (reason: string): Effect.Effect<NodeCapabilityResult> =>
        Effect.succeed({ status: NODE_CAPABILITY_STATUS.FAILED, capability, reason });
      const unavailable = Effect.succeed<NodeCapabilityResult>({
        status: NODE_CAPABILITY_STATUS.UNAVAILABLE,
        capability,
        reason: "this node offers no such capability",
      });
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
        case HOST_NODE_CAPABILITY.BROWSER_ACT: {
          const act = dependencies.node.browserAct;
          if (act === undefined) return unavailable;
          const read = decodeBrowserParams(params);
          if (Result.isFailure(read)) return failed("browser actions need a task and its actions");
          return Effect.map(
            act(read.success),
            (result): NodeCapabilityResult => ({
              status: NODE_CAPABILITY_STATUS.OK,
              value: result,
            }),
          );
        }
        default:
          return unavailable;
      }
    });

  // A handler that dies answers failed on this node rather than taking the
  // host's ask down with it; the host reads a typed refusal either way.
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

/** The client's node could not open an address the host asked it to. */
class OpenExternalFailed extends Data.TaggedError("OpenExternalFailed")<{
  readonly cause: unknown;
}> {
  override get message(): string {
    const { cause } = this;
    return cause instanceof Error ? cause.message : String(cause);
  }
}
