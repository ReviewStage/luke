import { lazy, Suspense } from "react";
import type { McpAppFrameProps } from "./mcp-app-frame.js";

/**
 * mcp-app.tsx -- an MCP App drawn in place (`mcp-app-frame.tsx`), its bridge and the MCP SDK under it loaded only once an app is drawn.
 *
 * Nothing stands in the app's place while the bridge loads, as nothing stands
 * there while the app's HTML is read.
 */

const McpAppFrame = lazy(() =>
  import("./mcp-app-frame.js").then((module) => ({ default: module.McpAppFrame })),
);

export type { McpAppFrameProps };

/** One tool call's MCP App, drawn in place once its bridge has loaded. */
export function McpApp(props: McpAppFrameProps): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <McpAppFrame {...props} />
    </Suspense>
  );
}
