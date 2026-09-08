import { APP_TOOL_KIND } from "@sidecar/acts";
import { type ConversationEntry, conversationEntryFromWire } from "@sidecar/realtime";
import { GatewayClient, type GatewayTransport } from "@sidecar/runtime";
import {
  GATEWAY_METHOD,
  MAIN_SESSION_KEY,
  NODE_CAPABILITY_STATUS,
  type NodeCapabilityResult,
  type NodeInvocation,
} from "@sidecar/runtime-contracts";
import {
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import type { WebContents } from "electron";
import { channels } from "#shared/bridge";
import type { BrainAppActRequest, ConversationHistoryPayload } from "#shared/contracts";
import { DESKTOP_NATIVE_NODE_ID, NODE_CAPABILITY, NODE_CAPABILITY_LIST } from "./desktop-node";
import { createHostOperator, type HostOperator } from "./host-operator";
import { createGatewayOperator, type GatewayOperator } from "./operator";

/**
 * The Gateway boundary as the desktop client composes it: one operator over
 * the transport the supervisor (or, in a fixture run, the in-process host)
 * hands it, the host's events relayed to the windows that draw them, and
 * this process's native capabilities served as one node on the same
 * connection. The runtime itself stands on the other side of the transport;
 * nothing here composes a store, a brain, or an observation.
 */
export interface GatewayWiringDependencies {
  transport: GatewayTransport;
  createId: () => string;
  report: (message: string) => void;
  /** Hands a payload to every panel and the voice window, less the window given. */
  broadcast: <Payload>(channel: string, payload: Payload, except?: WebContents) => void;
  /** Hands a payload to the voice window alone, the one receiver of offers and withdrawals. */
  sendToVoice: <Payload>(channel: string, payload: Payload) => void;
  /** The window an opaque reporter names in this process, so its own report is not echoed back to it. */
  webContentsByReporter: (reporter: string) => WebContents | undefined;
  /** The last settings snapshot this client saw, for a refusal the host cannot word itself. */
  lastSettings: HostOperatorDependencies["lastSettings"];
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

type HostOperatorDependencies = Parameters<typeof createHostOperator>[0];

export interface GatewayWiring {
  readonly client: GatewayClient;
  readonly operator: GatewayOperator;
  readonly host: HostOperator;
  /** Registers this process's node with the host over the current connection; run at every attachment. */
  registerNode: () => Promise<boolean>;
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
    value.kind !== APP_TOOL_KIND.REMEMBER &&
    value.kind !== APP_TOOL_KIND.FORGET
  );
}

export function wireGateway(dependencies: GatewayWiringDependencies): GatewayWiring {
  const { transport, broadcast, sendToVoice, report } = dependencies;
  const client = new GatewayClient({ transport, createId: dependencies.createId, report });
  const operator = createGatewayOperator({ client });
  const host = createHostOperator({ client, lastSettings: dependencies.lastSettings, report });

  // What the host tells its clients, relayed to the windows by the one client
  // that owns them. The runs list reaches every window; a reply offer and a
  // withdrawal reach the voice window, the one receiver; main's history reaches
  // every window but the one whose report produced it.
  operator.onRunsChanged((runs) => broadcast(channels.onBrainRequestsChanged, runs));
  operator.onDeliveryOffered((offer) => sendToVoice(channels.onBrainReplyOffered, offer));
  operator.onDeliveriesWithdrawn((epoch) => sendToVoice(channels.onBrainRepliesWithdrawn, epoch));
  operator.onHistoryChanged((change) => {
    if (change.sessionKey !== MAIN_SESSION_KEY) return;
    const entries = change.entries
      .map((entry) => conversationEntryFromWire(entry))
      .filter((entry): entry is ConversationEntry => entry !== undefined);
    const payload: ConversationHistoryPayload = { entries, cleared: change.cleared };
    broadcast(
      channels.onConversationHistoryChanged,
      payload,
      change.reporter === undefined
        ? undefined
        : dependencies.webContentsByReporter(change.reporter),
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
      case NODE_CAPABILITY.OPEN_EXTERNAL: {
        if (!isWireString(invocation.params.url)) return failed("open needs a url");
        await dependencies.node.openExternal(invocation.params.url);
        return { status: NODE_CAPABILITY_STATUS.OK, value: undefined };
      }
      case NODE_CAPABILITY.PANEL_APP_ACT: {
        const action = invocation.params.action;
        if (!isCarriedAppAction(action)) return failed("the act is not one a panel performs");
        return {
          status: NODE_CAPABILITY_STATUS.OK,
          value: await dependencies.node.performAppAct(action),
        };
      }
      case NODE_CAPABILITY.APPLE_CALENDAR_HELPER: {
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
    registerNode: async () => {
      const result = await client.call(GATEWAY_METHOD.NODE_REGISTER, {
        nodeId: DESKTOP_NATIVE_NODE_ID,
        capabilities: [...NODE_CAPABILITY_LIST],
      });
      if (!result.ok) report(`the native node could not register: ${result.error.message}`);
      return result.ok;
    },
  };
}
