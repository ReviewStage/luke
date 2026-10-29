import { MCP_APP_SANDBOX } from "@luke/features/mcp-app-frame";
import type { WireRecord } from "@luke/wire";
import {
  AppBridge,
  type McpUiHostCapabilities,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { useEffect, useRef, useState } from "react";
import { drawnDark } from "../../tokens/appearance.js";

/**
 * mcp-app-frame.tsx -- an MCP App drawn in place: one tool call's interactive UI, a provider's HTML, in a sandboxed frame the window speaks to over the extension's bridge.
 *
 * Under the MCP Apps extension (modelcontextprotocol.io/docs/extensions/apps)
 * a tool's server ships HTML that a host draws beside the tool's call and
 * speaks JSON-RPC to over `postMessage`. The app is drawn two frames deep: the
 * outer frame is the document the shell serves at `frameUrl`
 * (`@luke/features/mcp-app-frame`), sandboxed to its scripts alone, which
 * draws the HTML in a frame of its own under its own policy, since the
 * window's admits no inline script. The extension's own host bridge
 * (`@modelcontextprotocol/ext-apps`'s `AppBridge`) speaks to it: once the
 * outer document is ready it is handed the HTML; once the app has
 * initialized it is handed the call's input and then its result; the app's
 * height is the frame's; a tool the app calls on its own server is
 * `onCallTool`'s to answer. The host offers the app its server's tools and
 * nothing else, so a link it would open, a message it would send the
 * agent, or a file it would download is refused.
 *
 * The frame is drawn once the call has answered, its input and result as
 * they stood then, and is left out of the screen recording, which could not
 * see into it in any case. It takes no class or style: its outer layout is
 * its container's. It is loaded only once an app is drawn (`mcp-app.tsx`,
 * `@luke/ui/mcp-app`), so the bridge and the MCP SDK under it reach only the
 * bundle that draws one, and only as it does.
 */

/** How the window names itself to an app. */
const HOST_INFO = { name: "Luke", version: "1.0.0" } as const;

/** What the window offers an app: its own server's tools, through `onCallTool`. */
const HOST_CAPABILITIES: McpUiHostCapabilities = { serverTools: {} };

/** What the window answers a request it does not offer. */
const REFUSED = { isError: true } as const;

/** One tool call's MCP App, and what the window says to it. */
export interface McpAppFrameProps {
  /** The address of the document the app is drawn inside, which the shell serves. */
  frameUrl: string;
  /** The app's HTML, as its server served it. */
  html: string;
  /** What the frame is named for assistive technology: the tool's own name or title. */
  title: string;
  /** The arguments the tool was called with. */
  input: WireRecord;
  /** The tool's MCP result, which the app is handed once it has initialized. */
  result: WireRecord;
  /** Answers a call the app asks of a tool of its own server with the server's MCP result. */
  onCallTool: (name: string, input: WireRecord) => Promise<WireRecord>;
}

/** One tool call's MCP App, drawn in place. */
export function McpAppFrame({
  frameUrl,
  html,
  title,
  input,
  result,
  onCallTool,
}: McpAppFrameProps): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>();
  // Note that the bridge reads what the call said through refs, because it is opened once per app and a later render must not open another.
  const said = useRef({ input, result, onCallTool });
  said.current = { input, result, onCallTool };

  useEffect(() => {
    const element = frame.current;
    const view = element?.contentWindow;
    if (element === null || view === null || view === undefined) return undefined;
    const bridge = new AppBridge(null, HOST_INFO, HOST_CAPABILITIES, {
      hostContext: {
        theme: drawnDark(element) ? "dark" : "light",
        displayMode: "inline",
        availableDisplayModes: ["inline"],
        platform: "desktop",
      },
    });
    bridge.onsandboxready = () => {
      bridge.sendSandboxResourceReady({ html, sandbox: MCP_APP_SANDBOX }).catch(() => undefined);
    };
    bridge.oninitialized = () => {
      const { input: args, result: answered } = said.current;
      bridge
        .sendToolInput({ arguments: args })
        // SAFETY: the result is the tool's MCP `CallToolResult` as its server sent it, which the app reads by the extension's own schema.
        .then(() => bridge.sendToolResult(answered as Parameters<AppBridge["sendToolResult"]>[0]))
        .catch(() => undefined);
    };
    bridge.onsizechange = ({ height: asked }) => {
      if (asked !== undefined) setHeight(Math.ceil(asked));
    };
    bridge.oncalltool = async ({ name, arguments: args }) =>
      // SAFETY: as the result above, the server's own `CallToolResult`, its refusal an error result.
      (await said.current.onCallTool(name, (args ?? {}) as WireRecord)) as Awaited<
        ReturnType<NonNullable<AppBridge["oncalltool"]>>
      >;
    bridge.onopenlink = async () => REFUSED;
    bridge.onmessage = async () => REFUSED;
    bridge.ondownloadfile = async () => REFUSED;
    bridge.connect(new PostMessageTransport(view, view)).catch(() => undefined);
    return () => {
      bridge.close().catch(() => undefined);
    };
  }, [html]);

  return (
    <iframe
      ref={frame}
      className="luke-mcp-app-frame ph-no-capture block w-full rounded-control border border-border bg-background"
      title={title}
      src={frameUrl}
      sandbox={MCP_APP_SANDBOX}
      allow=""
      referrerPolicy="no-referrer"
      style={height === undefined ? undefined : { height }}
    />
  );
}
