import type { AgentToolAppAnswer } from "@luke/features/mcp-app-wire";
import { ACT_KIND } from "@luke/host/acts";
import { McpApp } from "@luke/ui/mcp-app";
import { isRecord, type WireRecord, type WireValue } from "@luke/wire";
import { type ReactNode, useContext, useEffect, useState } from "react";
import { type ActHandle, useAct } from "../act.js";
import { TOOL_STATE } from "../ai-elements/tool.js";
import { appPlatform } from "../app-platform.js";
import type { AGENT_PART, AgentPart } from "./agent-model.js";
import { TranscriptAgent } from "./line-cards.js";
import { remoteCallOf } from "./tool-call-model.js";

/**
 * tool-apps.tsx -- an integration tool's MCP App, drawn under its call's row: read from the provider through the service as the row is drawn, and the tools it calls forwarded back on the same connection.
 *
 * A tool of an integration may ship an interactive UI under the MCP Apps
 * extension (`@luke/features/mcp-app-wire`). Once a call of one has answered
 * in an agent's transcript, its row asks the service for the tool's app on
 * the connection the agent called it on (`ACT_KIND.AGENTS_TOOL_APP`), which
 * the service answers for the agent's starter alone, whose grant it is read
 * on; anyone else, a tool that ships none, and a read that failed draw the
 * row alone. The answer is held for the window's life by the agent, the
 * connection, and the tool, so a row drawn again, or another call of the
 * same tool, asks nothing. The app is drawn by `@luke/ui/mcp-app`, whose
 * bridge loads only once one is drawn, in the frame the shell serves
 * (`appPlatform().mcpAppFrameUrl`), and a shell that serves none, as the
 * web's does not, draws no app. It is handed the call's input and result as
 * the transcript keeps them: the result's text, and that text read as the
 * result's structured content where it is a JSON object, as a server that
 * returns structured content is asked to say it in text too.
 */

type ToolPart = Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;

/** What a call the app asked answers where the window could not make it. */
const NOT_CALLED: WireRecord = {
  content: [{ type: "text", text: "Luke could not call this tool just now." }],
  isError: true,
};

/** Each tool's app as the service answered it, or none, by agent, connection, and tool, for the window's life. */
const asked = new Map<string, Map<string, Map<string, Promise<AgentToolAppAnswer | undefined>>>>();

/** The tool's app, asked of the service once per agent, connection, and tool. */
function toolApp(
  act: ActHandle["act"],
  agentId: string,
  connection: string,
  tool: string,
): Promise<AgentToolAppAnswer | undefined> {
  const byConnection = asked.get(agentId) ?? new Map();
  asked.set(agentId, byConnection);
  const byTool = byConnection.get(connection) ?? new Map();
  byConnection.set(connection, byTool);
  const held = byTool.get(tool);
  if (held !== undefined) return held;
  const asking = act(ACT_KIND.AGENTS_TOOL_APP, { agentId, connection, tool }).then(
    (answer) => ("html" in answer ? answer : undefined),
    () => undefined,
  );
  byTool.set(tool, asking);
  return asking;
}

/** The call's result as the app reads it: an MCP result kept whole as one, else its text, read as structured content too where it is a JSON object. */
function callResult(output: WireValue | undefined): WireRecord {
  if (isRecord(output) && Array.isArray(output.content)) return output;
  if (Array.isArray(output)) return { content: output };
  const text = typeof output === "string" ? output : JSON.stringify(output ?? null);
  const structured = parsedObject(text);
  return {
    content: [{ type: "text", text }],
    ...(structured === undefined ? undefined : { structuredContent: structured }),
  };
}

/** A text read as JSON, where it is an object. */
function parsedObject(text: string): WireRecord | undefined {
  try {
    const parsed: WireValue = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** One answered call's app, once the service answered it. */
function AnsweredToolApp({
  frameUrl,
  agentId,
  connection,
  tool,
  input,
  output,
}: {
  frameUrl: string;
  agentId: string;
  connection: string;
  tool: string;
  input: WireRecord;
  output: WireValue | undefined;
}): ReactNode {
  const { act } = useAct();
  const [app, setApp] = useState<AgentToolAppAnswer>();
  useEffect(() => {
    let current = true;
    toolApp(act, agentId, connection, tool).then((answer) => {
      if (current) setApp(answer);
    });
    return () => {
      current = false;
    };
  }, [act, agentId, connection, tool]);
  if (app === undefined) return null;
  const onCallTool = (name: string, args: WireRecord) =>
    act(ACT_KIND.AGENTS_TOOL_APP_CALL, { agentId, connection, name, arguments: args }).then(
      (answer) => ("result" in answer ? answer.result : NOT_CALLED),
      () => NOT_CALLED,
    );
  return (
    <McpApp
      frameUrl={frameUrl}
      html={app.html}
      title={tool}
      input={input}
      result={callResult(output)}
      onCallTool={onCallTool}
    />
  );
}

/** The app of an integration tool's call that has answered, under its row, where the transcript names its agent and the shell serves an app's frame; nothing for any other call. */
export function ToolCallApp({ part }: { part: ToolPart }): ReactNode {
  const agentId = useContext(TranscriptAgent);
  const remote = remoteCallOf(part.tool, part.input);
  if (agentId === undefined || remote === undefined) return null;
  if (part.state !== TOOL_STATE.OUTPUT_AVAILABLE) return null;
  const frameUrl = appPlatform().mcpAppFrameUrl?.();
  if (frameUrl === undefined) return null;
  const { call } = remote;
  return (
    <AnsweredToolApp
      frameUrl={frameUrl}
      agentId={agentId}
      connection={call.connection ?? remote.provider}
      tool={call.remoteTool}
      input={isRecord(call.input) ? call.input : {}}
      output={part.output}
    />
  );
}
