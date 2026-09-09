import { ACT_KIND } from "@sidecar/acts";
import { brainRequestRecordFromWire } from "@sidecar/brain/requests";
import type { BrainAppActRequest } from "@sidecar/brain/requests-wire";
import {
  GATEWAY_METHOD,
  GatewayClient,
  type GatewayTransport,
  NODE_CAPABILITY_STATUS,
  type NodeCapabilityResult,
  type NodeInvocation,
} from "@sidecar/gateway";
import {
  createGatewayOperator,
  type GatewayOperator,
  HOST_NATIVE_NODE_ID,
  HOST_NODE_CAPABILITY,
  HOST_NODE_CAPABILITY_LIST,
} from "@sidecar/host";
import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import { type ConversationEntry, storedConversationEntry } from "@sidecar/session";
import {
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { channels } from "#shared/bridge";
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
  /** Hands a payload to the voice window alone, the one receiver of offers and withdrawals. */
  sendToVoice: <Payload>(channel: string, payload: Payload) => void;
  /** What the host says, written down once; the windows are told from it. */
  state: AppStateStore;
  /** This machine's native capabilities, performed here at the host's ask. */
  node: {
    openExternal: (url: string) => Promise<void>;
    performAppAct: (action: BrainAppActRequest["action"]) => Promise<WireRecord>;
    runAppleCalendarHelper: (
      helperArguments: readonly string[],
      timeoutMs: number,
    ) => Promise<string>;
  };
}

export interface GatewayWiring {
  readonly client: GatewayClient;
  readonly operator: GatewayOperator;
  readonly host: HostOperator;
  /**
   * What every attachment owes the host it now reaches: the host's stream
   * adopted (its sequence and snapshot, so a replaced host's events are not
   * dropped against the old host's count), and this process's node
   * registered on the connection that now stands.
   */
  attached: () => Promise<boolean>;
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
): value is BrainAppActRequest["action"] & WireRecord {
  return (
    isRecord(value) &&
    isWireString(value.kind) &&
    value.kind !== ACT_KIND.REMEMBER &&
    value.kind !== ACT_KIND.FORGET
  );
}

export function wireGateway(dependencies: GatewayWiringDependencies): GatewayWiring {
  const { transport, state, sendToVoice, report } = dependencies;
  const client = new GatewayClient({
    transport,
    createId: dependencies.createId,
    report,
    // A snapshot stands in for events the client will never see: the ones a
    // replaced host never numbered, or a window that moved past. The runs it
    // carries land in the document as the runs event would have.
    onSnapshot: (snapshot) => {
      if (!isRecord(snapshot) || !Array.isArray(snapshot.runs)) return;
      state.update({
        brain: { runs: snapshot.runs.flatMap((run) => brainRequestRecordFromWire(run) ?? []) },
      });
    },
  });
  const operator = createGatewayOperator({ client });
  const host = createHostOperator({
    client,
    lastSettings: () => state.snapshot().settings,
    report,
  });

  // What the host tells its clients: the runs and main's thread written to the
  // document every window is told from, and the two a receiver alone may take
  // — a reply offer and a withdrawal — handed to the voice window directly,
  // because an offer is addressed to the receiver that stands now and no
  // later window may find it waiting.
  operator.onRunsChanged((runs) => {
    state.update({ brain: { runs } });
  });
  operator.onDeliveryOffered((offer) => sendToVoice(channels.onBrainReplyOffered, offer));
  operator.onDeliveriesWithdrawn((epoch) => sendToVoice(channels.onBrainRepliesWithdrawn, epoch));
  operator.onHistoryChanged((change) => {
    if (change.sessionKey !== MAIN_SESSION_KEY) return;
    const entries = change.entries
      .map((entry) => storedConversationEntry(entry, { strict: false }))
      .filter((entry): entry is ConversationEntry => entry !== undefined);
    state.update(
      { conversation: { entries, cleared: change.cleared } },
      change.reporter === undefined ? undefined : { reporter: change.reporter },
    );
  });

  /**
   * The capabilities this process performs at the host's ask. Each is
   * validated here before anything native runs — the address a string, the
   * act the shape the panel takes, the helper command one the build knows —
   * and each answers the host's own result vocabulary, so a refusal is typed
   * and never a throw that the wire would have to guess at.
   */
  const perform = async (invocation: NodeInvocation): Promise<NodeCapabilityResult> => {
    const failed = (reason: string): NodeCapabilityResult => ({
      status: NODE_CAPABILITY_STATUS.FAILED,
      capability: invocation.capability,
      reason,
    });
    switch (invocation.capability) {
      case HOST_NODE_CAPABILITY.OPEN_EXTERNAL: {
        if (!isWireString(invocation.params.url)) return failed("open needs a url");
        await dependencies.node.openExternal(invocation.params.url);
        return { status: NODE_CAPABILITY_STATUS.OK, value: undefined };
      }
      case HOST_NODE_CAPABILITY.PANEL_APP_ACT: {
        const action = invocation.params.action;
        if (!isCarriedAppAction(action)) return failed("the act is not one a panel performs");
        return {
          status: NODE_CAPABILITY_STATUS.OK,
          value: await dependencies.node.performAppAct(action),
        };
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
        if (!isWireNumber(invocation.params.timeoutMs)) return failed("timeoutMs must be a number");
        const output = await dependencies.node.runAppleCalendarHelper(
          helperArguments,
          invocation.params.timeoutMs,
        );
        return { status: NODE_CAPABILITY_STATUS.OK, value: output };
      }
      default:
        return {
          status: NODE_CAPABILITY_STATUS.UNAVAILABLE,
          capability: invocation.capability,
          reason: "this node offers no such capability",
        };
    }
  };
  transport.serveInvocations?.(perform);

  return {
    client,
    operator,
    host,
    attached: async () => {
      await client.adoptHost();
      const result = await client.call(GATEWAY_METHOD.NODE_REGISTER, {
        nodeId: HOST_NATIVE_NODE_ID,
        capabilities: [...HOST_NODE_CAPABILITY_LIST],
      });
      if (!result.ok) report(`the native node could not register: ${result.error.message}`);
      return result.ok;
    },
  };
}
