import { backgroundResult, RealtimeAgent, tool } from "@openai/agents-realtime";
import { type RealtimeFunctionCall, realtimeToolDefinitions } from "@sidecar/acts";
import { isRecord, text, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";

export interface AgentsDeveloperToolCall extends RealtimeFunctionCall {
  callId: string;
  responseId: string;
}

export type AgentsDeveloperToolExecutor = (call: AgentsDeveloperToolCall) => Promise<WireRecord>;

export function createDeveloperTurnAgent(
  instructions: string,
  execute: AgentsDeveloperToolExecutor,
): RealtimeAgent {
  const tools = realtimeToolDefinitions().map((definition) =>
    tool({
      name: definition.name,
      description: definition.description,
      parameters: {
        ...definition.parameters,
        required: [...definition.parameters.required],
        additionalProperties: true,
      },
      strict: false,
      execute: async (argumentsValue, _context, details) => {
        const unparsedToolCall: UnparsedWireValue = JSON.parse(JSON.stringify(details?.toolCall));
        const toolCall = isRecord(unparsedToolCall) ? unparsedToolCall : undefined;
        const output = await execute({
          name: definition.name,
          argumentsJson: JSON.stringify(argumentsValue),
          callId: text(toolCall?.callId) ?? "",
          responseId: text(toolCall?.responseId) ?? "",
        });
        return backgroundResult(JSON.stringify(output));
      },
    }),
  );
  return new RealtimeAgent({
    name: "Luke developer turn",
    instructions,
    tools,
  });
}
