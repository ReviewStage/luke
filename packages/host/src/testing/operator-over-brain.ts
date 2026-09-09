import type { BrainAgent } from "@sidecar/brain";
import { DeliveryLedger } from "@sidecar/brain";
import { GATEWAY_CLIENT_ROLE, GatewayClient, InProcessTransport } from "@sidecar/gateway";
import type { ChildRunService, ResolvedConfiguration } from "@sidecar/runtime";
import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import type { ConversationOperations } from "../conversation-operations.js";
import { createGatewayOperator, type GatewayOperator } from "../operator.js";
import {
  createGatewayService,
  type GatewayServiceDependencies,
  type GrantedWords,
} from "../service.js";

/**
 * Test support: the operator a window's ask crosses, stood over one brain
 * and one thread and nothing else, so a test of the brain's own lifecycle
 * submits the way production does — through the host's submit method, its
 * bound and its Conversation write — without composing the rest of the host.
 * Every other capability is an inert stand-in a test of it would not use.
 */
export function operatorOverBrain(options: {
  current: () => BrainAgent | undefined;
  recordConversationEntry: GatewayServiceDependencies["recordConversationEntry"];
}): GatewayOperator {
  let ids = 0;
  const service = createGatewayService({
    brain: {
      current: options.current,
      agentForRun: options.current,
      conversationForRun: () => MAIN_SESSION_KEY,
      allRequests: () => options.current()?.requests() ?? [],
      generationId: () => undefined,
      holdsGeneration: () => false,
      publicationSettled: () => Promise.resolve(),
      // SAFETY: the submit path reaches no child; the stand-in is never read.
      children: {} as ChildRunService,
      // SAFETY: only the revision is ever read off this stand-in.
      configuration: () => ({ revision: 1 }) as ResolvedConfiguration,
      updateConfiguration: () => [],
    },
    // SAFETY: the submit path reaches no conversation operation; the stand-in is never read.
    conversations: {} as ConversationOperations,
    memory: { status: () => ({}) },
    observedSessionCount: () => 0,
    deliveries: new DeliveryLedger<GrantedWords>({ nextDeliveryId: () => `delivery-${++ids}` }),
    receiver: { isReady: () => false, epoch: () => 0 },
    recordConversationEntry: options.recordConversationEntry,
    now: Date.now,
    createId: () => `id-${++ids}`,
  });
  return createGatewayOperator({
    client: new GatewayClient({
      transport: new InProcessTransport(service.server, {
        clientId: "test-operator",
        role: GATEWAY_CLIENT_ROLE.OPERATOR,
      }),
      createId: () => `request-${++ids}`,
    }),
  });
}
