/**
 * mcp-app-frame.ts -- the document an MCP App is drawn inside: served under a policy of its own, it draws the app's HTML in a sandboxed frame and carries the app's messages to the window and back.
 *
 * An app's HTML is a provider's, so it runs as nothing of Luke's own. The
 * window's policy admits no inline script, and a `srcdoc` frame inherits the
 * policy of the document that holds it, so an app drawn straight into a frame
 * of the window's would run none of its scripts. It is drawn instead in a
 * frame of this document's, the extension's "sandbox proxy"
 * (modelcontextprotocol.io/docs/extensions/apps): the window frames this
 * document from an address its shell serves (`luke-page://mcp-app/` on the
 * desktop, beside the pages) sandboxed to its scripts alone; the document says
 * it is ready (`ui/notifications/sandbox-proxy-ready`), takes the app's HTML
 * (`ui/notifications/sandbox-resource-ready`) into a `srcdoc` frame sandboxed
 * the same way, which inherits this document's policy, and passes every other
 * message on untouched, the window's to the app and the app's to the window.
 *
 * The policy is the page policy's (`page-policy.ts`) less cdnjs: the app may
 * run its own inline scripts and styles and load images, fonts, and media from
 * itself alone, and may fetch, post, frame, and submit nothing. The domains an
 * app's `_meta.ui.csp` asks for are not granted, so an app that loads its code
 * or reads its data from the network draws without them; what it reads it
 * reads through the window, which forwards its tool calls.
 */

import { PAGE_SCHEME } from "./page-frame.js";

/** The host the document is served under on the shell's page scheme. */
const MCP_APP_FRAME_HOST = "mcp-app";

/** The address the desktop serves the document at. */
export const MCP_APP_FRAME_URL = `${PAGE_SCHEME}://${MCP_APP_FRAME_HOST}/`;

/** Whether an address of the page scheme names the document, in the one shape `MCP_APP_FRAME_URL` spells. */
export function isMcpAppFrameUrl(url: string): boolean {
  return url === MCP_APP_FRAME_URL;
}

/** The sandbox the window's frame of the document, and the document's frame of the app, each run under. */
export const MCP_APP_SANDBOX = "allow-scripts";

/** The content security policy the document, and the app it draws, run under. */
const MCP_APP_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "worker-src blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  `sandbox ${MCP_APP_SANDBOX}`,
].join("; ");

/** The headers the document is answered with. */
export const MCP_APP_FRAME_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": MCP_APP_CONTENT_SECURITY_POLICY,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
} as const;

/**
 * The document: a frame filling it, and the script that draws the app in it
 * and passes messages each way. Only the window that frames it is heard as
 * the window, and only the app's own frame as the app.
 */
export const MCP_APP_FRAME_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<style>html,body{margin:0;height:100%;background:transparent}iframe{display:block;border:0;width:100%;height:100%;background:transparent}</style>
</head>
<body>
<script>
const app = document.createElement("iframe");
app.setAttribute("sandbox", "${MCP_APP_SANDBOX}");
app.setAttribute("allow", "");
app.title = "MCP App";
document.body.append(app);
addEventListener("message", (event) => {
  const message = event.data;
  if (event.source === parent) {
    if (message && message.method === "ui/notifications/sandbox-resource-ready") {
      const html = message.params && message.params.html;
      app.srcdoc = typeof html === "string" ? html : "";
      return;
    }
    if (app.contentWindow) app.contentWindow.postMessage(message, "*");
    return;
  }
  if (event.source === app.contentWindow) parent.postMessage(message, "*");
});
parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "*");
</script>
</body>
</html>
`;
