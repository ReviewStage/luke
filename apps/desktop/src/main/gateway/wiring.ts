/**
 * wiring.ts -- the Gateway boundary as the desktop client composes it: one
 * operator over the host it is handed, the host's events relayed to the
 * document the windows draw from, and this process's native capabilities
 * registered as one node on the host's registry. The runtime itself stands
 * behind the host; nothing here composes a store, a brain, or an observation.
 */
import {
  type GatewayHost,
  NODE_CAPABILITY_STATUS,
  type NodeCapabilityResult,
  type NodeRegistry,
  type RemoteNodeInvoker,
} from "@sidecar/gateway";
import {
  HOST_NATIVE_NODE_ID,
  HOST_NODE_CAPABILITY,
  HOST_NODE_CAPABILITY_LIST,
} from "@sidecar/host";
import { isWireNumber, isWireString } from "@sidecar/wire";
import { Effect, type Scope } from "effect";
import type { AppStateStore } from "../app-state";
import { createHostOperator, type HostOperator } from "./host-operator";

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
    runAppleCalendarHelper: (
      helperArguments: readonly string[],
      timeoutMs: number,
    ) => Promise<string>;
  };
}

export interface GatewayWiring {
  readonly host: HostOperator;
}

/** The commands the EventKit helper answers; an invocation naming anything else is refused here. */
const APPLE_CALENDAR_HELPER_COMMANDS: ReadonlySet<string> = new Set([
  "status",
  "request-access",
  "observe",
]);

export const wireGateway = /* @__PURE__ */ Effect.fn("desktop/wireGateway")(function* (
  dependencies: GatewayWiringDependencies,
): Effect.fn.Return<GatewayWiring, never, Scope.Scope> {
  const { gateway, state, report } = dependencies;
  const host = createHostOperator({
    client: gateway,
    report,
  });

  // What the host tells its clients: the Conversation as its reads of the
  // service compose it, the children and agents beside it, and the one
  // transcript held open, each written to the document every window is told
  // from. The subscriptions are the scope's, so the close that ends one ends
  // them all.
  const heard = [
    host.onConversationViewChanged((view) => {
      state.update({ conversation: view });
    }),
    host.onChildrenChanged((children) => {
      state.update({ children });
    }),
    host.onAgentsChanged((agents) => {
      state.update({ agents });
    }),
    host.onChildTranscriptChanged(({ transcript }) => {
      state.update({ childTranscript: transcript });
    }),
  ];
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const stop of heard) stop();
    }),
  );

  /**
   * The capabilities this process performs at the host's ask. Each is
   * validated here before anything native runs — the address a string, the
   * helper command one the build knows — and each answers the host's own
   * result vocabulary, so a refusal is typed and never a throw.
   */
  const perform: RemoteNodeInvoker = (capability, params) =>
    Effect.suspend(() => {
      const failed = (reason: string): Effect.Effect<NodeCapabilityResult> =>
        Effect.succeed({ status: NODE_CAPABILITY_STATUS.FAILED, capability, reason });
      switch (capability) {
        case HOST_NODE_CAPABILITY.OPEN_EXTERNAL: {
          const { url } = params;
          if (!isWireString(url)) return failed("open needs a url");
          return Effect.as(
            Effect.promise(() => dependencies.node.openExternal(url)),
            {
              status: NODE_CAPABILITY_STATUS.OK,
              value: undefined,
            },
          );
        }
        case HOST_NODE_CAPABILITY.APPLE_CALENDAR_HELPER: {
          const helperArguments = params.arguments;
          if (
            !Array.isArray(helperArguments) ||
            !helperArguments.every(isWireString) ||
            !APPLE_CALENDAR_HELPER_COMMANDS.has(helperArguments[0] ?? "")
          ) {
            return failed("the helper invocation is not one this build runs");
          }
          const timeoutMs = params.timeoutMs;
          if (!isWireNumber(timeoutMs)) return failed("timeoutMs must be a number");
          return Effect.map(
            Effect.promise(() =>
              dependencies.node.runAppleCalendarHelper(helperArguments, timeoutMs),
            ),
            (value) => ({ status: NODE_CAPABILITY_STATUS.OK, value }),
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
