import type { BrainAgent } from "@sidecar/brain";
import { GATEWAY_CLIENT_ROLE, GatewayClient, InProcessTransport } from "@sidecar/gateway";
import type { ChildRunService, ResolvedConfiguration } from "@sidecar/runtime";
import type { ConversationOperations } from "../conversation-operations.js";
import { createGatewayOperator, type GatewayOperator } from "../operator.js";
import { createGatewayService } from "../service.js";

/**
 * Test support: the operator a client's ask crosses, stood over one brain and
 * nothing else, so a test of the brain's own lifecycle submits the way
 * production does — through the host's submit method and its bound — without
 * composing the rest of the host. Every other capability is an inert stand-in
 * a test of it would not use.
 */
export function operatorOverBrain(options: {
  current: () => BrainAgent | undefined;
}): GatewayOperator {
  let ids = 0;
  const service = createGatewayService({
    brain: {
      current: options.current,
      agentForRun: options.current,
      allRequests: () => options.current()?.requests() ?? [],
      generationId: () => undefined,
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
