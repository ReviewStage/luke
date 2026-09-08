import { type ConversationEntry, conversationEntryFromWire } from "@sidecar/realtime";
import { InProcessTransport } from "@sidecar/runtime";
import {
  GATEWAY_CLIENT_ROLE,
  MAIN_SESSION_KEY,
  NODE_CAPABILITY_STATUS,
} from "@sidecar/runtime-contracts";
import { ACT_RESULT_STATUS, isRecord, isWireString, type WireRecord } from "@sidecar/wire";
import type { WebContents } from "electron";
import { channels } from "#shared/bridge";
import type { BrainAppActRequest, ConversationHistoryPayload } from "#shared/contracts";
import {
  DESKTOP_NATIVE_NODE_ID,
  DESKTOP_OPERATOR_CLIENT_ID,
  NODE_CAPABILITY,
} from "./desktop-node";
import { createGatewayOperator, type GatewayOperator } from "./operator";
import {
  createGatewayService,
  type GatewayService,
  type GatewayServiceDependencies,
} from "./service";

/**
 * The Gateway boundary as the desktop composes it. The service is the host's
 * side: every capability the protocol names, answered over the wirings the
 * dependencies reach, and every change numbered as an event. The operator is
 * the desktop's own client over the in-process transport, the one way the
 * windows' IPC and this process's surfaces reach the host. The two stand in
 * one process today; the seam is what the process split that follows moves
 * across.
 */
export interface GatewayWiringDependencies extends GatewayServiceDependencies {
  /** Hands a payload to every panel and the voice window, less the window given. */
  broadcast: <Payload>(channel: string, payload: Payload, except?: WebContents) => void;
  /** Hands a payload to the voice window alone, the one receiver of reply offers and withdrawals. */
  sendToVoice: <Payload>(channel: string, payload: Payload) => void;
  webContentsById: (id: number) => WebContents | undefined;
  /** Hands an address to the operating system, as a row press does. */
  openExternal: (url: string) => Promise<void>;
  /** Carries an app act to the panel and answers what became of it. */
  performAppAct: (action: BrainAppActRequest["action"]) => Promise<WireRecord>;
  report: (message: string) => void;
}

export interface GatewayWiring {
  readonly service: GatewayService;
  readonly operator: GatewayOperator;
  /** An app act the brain asked for, carried to the panel through the node capability this process registered. */
  invokeNodeAppAct: (action: BrainAppActRequest["action"]) => Promise<WireRecord>;
  /** An address the brain or a validated act asked to open, through the node capability; unavailable means not opened. */
  openExternalThroughNode: (url: string) => Promise<void>;
}

export function wireGateway(dependencies: GatewayWiringDependencies): GatewayWiring {
  const {
    broadcast,
    sendToVoice,
    webContentsById,
    openExternal,
    performAppAct,
    report,
    ...serviceDependencies
  } = dependencies;
  const service = createGatewayService(serviceDependencies);
  const operator = createGatewayOperator({
    transport: new InProcessTransport(service.server, {
      clientId: DESKTOP_OPERATOR_CLIENT_ID,
      role: GATEWAY_CLIENT_ROLE.OPERATOR,
    }),
    createId: dependencies.createId,
    report,
  });

  // What the host tells its clients, relayed to the windows by the one client
  // that owns them. The runs list reaches every window; a reply offer and a
  // withdrawal reach the voice window, the one receiver; main's history reaches
  // every window but the one whose report produced it.
  operator.onRunsChanged((runs) => broadcast(channels.onBrainRequestsChanged, runs));
  operator.onDeliveryOffered((offer) => sendToVoice(channels.onBrainReplyOffered, offer));
  operator.onDeliveriesWithdrawn((epoch) => sendToVoice(channels.onBrainRepliesWithdrawn, epoch));
  operator.onHistoryChanged((change) => {
    // The panel draws main alone; another conversation's thread is held by the
    // host for its brain and its tests and reaches no window.
    if (change.sessionKey !== MAIN_SESSION_KEY) return;
    const entries = change.entries
      .map((entry) => conversationEntryFromWire(entry))
      .filter((entry): entry is ConversationEntry => entry !== undefined);
    const payload: ConversationHistoryPayload = { entries, cleared: change.cleared };
    broadcast(
      channels.onConversationHistoryChanged,
      payload,
      change.reporter === undefined ? undefined : webContentsById(change.reporter),
    );
  });

  /**
   * The app acts handed to the native node and not yet performed, by token.
   * The act itself was validated against the guide by the act performer, and
   * both sides of this capability stand in one process, so the typed act is
   * held here and only its token crosses the invocation; a node on the other
   * side of a socket is where the act would be serialized, and that boundary
   * is the process split's to draw.
   */
  const carriedAppActs = new Map<string, BrainAppActRequest["action"]>();

  /**
   * This process's native capabilities, offered to the host as one node:
   * opening an address with the operating system and carrying an app act to
   * the panel. The host asks for each by name and never reaches Electron
   * itself; while the node is disconnected — never, in one process, but the
   * seam is the point — an ask answers a typed unavailable, and the act it
   * was for is left undone rather than recorded as carried.
   */
  service.nodes.register({
    nodeId: DESKTOP_NATIVE_NODE_ID,
    capabilities: {
      [NODE_CAPABILITY.OPEN_EXTERNAL]: async (params) => {
        if (!isWireString(params.url)) throw new Error("open needs a url");
        await openExternal(params.url);
        return undefined;
      },
      [NODE_CAPABILITY.PANEL_APP_ACT]: (params) => {
        const action = isWireString(params.act) ? carriedAppActs.get(params.act) : undefined;
        if (isWireString(params.act)) carriedAppActs.delete(params.act);
        if (!action) throw new Error("no app act is held under that token");
        return performAppAct(action);
      },
    },
  });

  return {
    service,
    operator,
    invokeNodeAppAct: async (action) => {
      const act = dependencies.createId();
      carriedAppActs.set(act, action);
      const result = await service.nodes.invoke(NODE_CAPABILITY.PANEL_APP_ACT, { act });
      carriedAppActs.delete(act);
      if (result.status === NODE_CAPABILITY_STATUS.OK && isRecord(result.value)) {
        return result.value;
      }
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason:
          result.status === NODE_CAPABILITY_STATUS.OK
            ? "The panel answered in a shape this build cannot read."
            : result.reason,
      };
    },
    openExternalThroughNode: async (url) => {
      const result = await service.nodes.invoke(NODE_CAPABILITY.OPEN_EXTERNAL, { url });
      if (result.status !== NODE_CAPABILITY_STATUS.OK) throw new Error(result.reason);
    },
  };
}
