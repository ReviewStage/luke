import { ACTION_KIND } from "@sidecar/actions";
import type { BrainAppActionRequest } from "@sidecar/brain/requests-wire";
import {
  GATEWAY_METHOD,
  type GatewayTransport,
  gatewayClient,
  NODE_CAPABILITY_STATUS,
  type NodeCapabilityResult,
  type NodeInvocation,
} from "@sidecar/gateway";
import {
  HOST_NATIVE_NODE_ID,
  HOST_NODE_CAPABILITY,
  HOST_NODE_CAPABILITY_LIST,
  type HostNodeOpenKind,
  isHostNodeOpenKind,
} from "@sidecar/host";
import {
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { Effect, type Scope } from "effect";
import type { AppStateStore } from "../app-state";
import { createHostOperator, type HostOperator } from "./host-operator";

/**
 * The Gateway boundary as the desktop client composes it: one operator over
 * the transport it is handed, the host's events relayed to the windows that
 * draw them, and this process's native capabilities served as one node on
 * the same connection. The runtime itself stands on the other side of the
 * transport; nothing here composes a store, a brain, or an observation.
 */
export interface GatewayWiringDependencies {
  transport: GatewayTransport;
  createId: () => string;
  report: (message: string) => void;
  /** What the host says, written down once; the windows are told from it. */
  state: AppStateStore;
  /** This machine's native capabilities, performed here at the host's ask. */
  node: {
    openExternal: (url: string, kind: HostNodeOpenKind) => Promise<void>;
    performAppAction: (action: BrainAppActionRequest["action"]) => Promise<WireRecord>;
    runAppleCalendarHelper: (
      helperArguments: readonly string[],
      timeoutMs: number,
    ) => Promise<string>;
  };
}

export interface GatewayWiring {
  readonly host: HostOperator;
  /**
   * What every attachment owes the host it now reaches: the host's stream
   * adopted (its sequence and snapshot, so a replaced host's events are not
   * dropped against the old host's count), and this process's node
   * registered on the connection that now stands.
   */
  attached: () => Effect.Effect<boolean>;
}

/** The commands the EventKit helper answers; an invocation naming anything else is refused here. */
const APPLE_CALENDAR_HELPER_COMMANDS: ReadonlySet<string> = new Set([
  "status",
  "request-access",
  "observe",
]);

/** The same check the bridge applies before an app act reaches a renderer; the renderer's own guard is the rest. */
function isCarriedAppAction(
  value: UnparsedWireValue,
): value is BrainAppActionRequest["action"] & WireRecord {
  return (
    isRecord(value) &&
    isWireString(value.kind) &&
    value.kind !== ACTION_KIND.REMEMBER &&
    value.kind !== ACTION_KIND.FORGET
  );
}

export const wireGateway = /* @__PURE__ */ Effect.fn("wireGateway")(function* (
  dependencies: GatewayWiringDependencies,
): Effect.fn.Return<GatewayWiring, never, Scope.Scope> {
  const { transport, state, report } = dependencies;
  const client = yield* gatewayClient({
    transport,
    createId: dependencies.createId,
    report,
  });
  const host = createHostOperator({
    client,
    lastSettings: () => state.snapshot().settings,
    report,
  });

  // What the host tells its clients: the Conversation as its reads of the
  // service compose it, written to the document every window is told from.
  // The subscription is the scope's, as the client's own is, so the close
  // that ends one ends both.
  const heardConversation = host.onConversationViewChanged((view) => {
    state.update({ conversation: view });
  });
  yield* Effect.addFinalizer(() => Effect.sync(() => heardConversation()));

  /**
   * The capabilities this process performs at the host's ask. Each is
   * validated here before anything native runs — the address a string and
   * its kind one the build names, the act the shape the panel takes, the
   * helper command one the build knows —
   * and each answers the host's own result vocabulary, so a refusal is typed
   * and never a throw that the wire would have to guess at.
   */
  const perform = (invocation: NodeInvocation): Effect.Effect<NodeCapabilityResult> =>
    Effect.suspend(() => {
      const failed = (reason: string): Effect.Effect<NodeCapabilityResult> =>
        Effect.succeed({
          status: NODE_CAPABILITY_STATUS.FAILED,
          capability: invocation.capability,
          reason,
        });
      switch (invocation.capability) {
        case HOST_NODE_CAPABILITY.OPEN_EXTERNAL: {
          const { url, kind } = invocation.params;
          if (!isWireString(url)) return failed("open needs a url");
          if (!isWireString(kind) || !isHostNodeOpenKind(kind)) {
            return failed("open needs a kind this build names");
          }
          return Effect.as(
            Effect.promise(() => dependencies.node.openExternal(url, kind)),
            { status: NODE_CAPABILITY_STATUS.OK, value: undefined },
          );
        }
        case HOST_NODE_CAPABILITY.PANEL_APP_ACTION: {
          const action = invocation.params.action;
          if (!isCarriedAppAction(action)) return failed("the action is not one a panel performs");
          return Effect.map(
            Effect.promise(() => dependencies.node.performAppAction(action)),
            (value) => ({ status: NODE_CAPABILITY_STATUS.OK, value }),
          );
        }
        case HOST_NODE_CAPABILITY.APPLE_CALENDAR_HELPER: {
          const helperArguments = invocation.params.arguments;
          if (
            !Array.isArray(helperArguments) ||
            !helperArguments.every(isWireString) ||
            !APPLE_CALENDAR_HELPER_COMMANDS.has(helperArguments[0] ?? "")
          ) {
            return failed("the helper invocation is not one this build runs");
          }
          const timeoutMs = invocation.params.timeoutMs;
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
            capability: invocation.capability,
            reason: "this node offers no such capability",
          });
      }
    });
  yield* transport.serveInvocations?.(perform) ?? Effect.void;

  return {
    host,
    attached: () =>
      Effect.gen(function* () {
        yield* client.adoptHost();
        const result = yield* client.call(GATEWAY_METHOD.NODE_REGISTER, {
          nodeId: HOST_NATIVE_NODE_ID,
          capabilities: [...HOST_NODE_CAPABILITY_LIST],
        });
        if (!result.ok) report(`the native node could not register: ${result.error.message}`);
        return result.ok;
      }),
  };
});
