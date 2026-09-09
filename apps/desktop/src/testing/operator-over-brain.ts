import type { BrainAgent } from "@sidecar/brain";
import type { ChildRunService, ResolvedConfiguration } from "@sidecar/runtime";
import { DeliveryLedger, GatewayClient, InProcessTransport } from "@sidecar/runtime";
import { GATEWAY_CLIENT_ROLE, MAIN_SESSION_KEY } from "@sidecar/runtime-contracts";
import type { ConversationOperations } from "#main/conversation-operations";
import { createGatewayOperator, type GatewayOperator } from "#main/gateway/operator";
import {
  createGatewayService,
  type GatewayServiceDependencies,
  type GrantedWords,
} from "#main/gateway/service";

/**
 * Test support: the operator a window's ask crosses, stood over one brain
 * and one thread and nothing else, so a test of the brain's own lifecycle
 * submits the way production does — through the host's submit method, its
 * bound and its History write — without composing the rest of the host.
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
      // SAFETY: only the revision is read here; the stand-in is never read further.
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
