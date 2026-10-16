# Proposal: a Browser tab in the side panel

Status: decided by Dean on 2026-10-16: §5 as recommended, a
`WebContentsView` behind an experiment. That choice also approves the
AGENTS.md line in §4. The build follows §6.

The ask: "Browser tab. Similar to ChatGPT/Cursor/other devtools. Do some
research on how feasible this would be. And if the solution is obvious, then
build it."

**Short answer: it is feasible, but the solution is not obvious.** Three
things need a decision first: which embedding to use, since each one either
loosens the panel windows' one hardened posture or fights the panel's own
motion and overlays; what the tab browses; and whether a page's pixels may
ever reach session replay. This document lays out the options, recommends one,
and gives the PR stack it would take.

## 1. What the others ship

- **Cursor** (1.7 beta, 2.0 GA, autumn 2025): a browser tab inside the editor
  that the *agent* drives through MCP tools (navigate, click, type,
  screenshot, console and network logs). The developer can pick an element and
  send its DOM to the agent. Each action is approved by hand unless it is
  allowlisted.
- **OpenAI's Codex app**: a built-in browser for previewing `localhost` dev
  servers. The developer comments on elements, and the agent can use it as
  `@Browser` (click, type, inspect, screenshot) under Settings › Browser ›
  Agent permissions.
- **VS Code's Simple Browser**: an `<iframe>` in a webview. It suits
  `localhost`, but sites that refuse framing don't load.

All of them show what the agent is building, beside the agent. Their agent
and dev server run **on the developer's machine**. Luke's coding agents run in
a **Vercel Sandbox in the cloud**, so `localhost:3000` in an agent's transcript
is the sandbox's own `localhost` and the Mac can't reach it. That's the main
difference from the products we're copying, and it shapes §3.

## 2. How to embed a page (Electron 43.3.0)

| | `<iframe>` | `<webview>` | `WebContentsView` |
| --- | --- | --- | --- |
| Loads any site | No: `X-Frame-Options` / `frame-ancestors` refuse most real sites (GitHub, Google, many dashboards); `localhost` and most previews load | Yes | Yes |
| Hardened posture | Loosen `index.html`'s `frame-src luke-page:` to `http: https:` | Turn on `webviewTag` in `hardenedWebPreferences`, which every panel and the voice window share; Electron advises against `<webview>` for new work | Untouched: the view is a separate `webContents` that main owns, with its own preferences and no preload |
| Layers with the DOM (menus, dialogs, find bar, toasts, pane motion) | Yes | Yes | **No.** A native view draws over the whole renderer |
| Back, forward, reload, find, zoom | Partly (same-origin only) | Yes | Yes (`navigationHistory`, `findInPage`, `setZoomFactor`) |
| Cookies and logins | Third-party, partitioned | Own partition | Own partition |

**The cost of `WebContentsView` is the overlay problem.** DOM regularly sits
over the side panel's body:

- the find bar (`desktop.css` `.find-bar`, absolute, top right);
- popovers kept inside the panel's `data-popover-room`;
- the "+" menu, tab menus, and tooltips;
- ⌘K and confirm dialogs (`--z-dialog`);
- the toast stack (bottom right, where the panel stands);
- the floating call card.

The panel also slides in and out on `transform` and `clip-path`
(`pane-motion.tsx`, and `side-panel.tsx`'s exit), resizes every frame under
its drag edge, and can fill the window. A native view follows none of that on
its own.

The usual answer, and the one recommended here, is that **the live view is
shown only while it is at rest and uncovered**:

- The renderer reports the tab body's rectangle to main through an `act`
  (`ResizeObserver` plus the panel's settle).
- While anything covers the body, or the panel is moving or resizing, main
  hides the view and the renderer draws a still of it instead
  (`webContents.capturePage()`), so the change can't be seen.
- One renderer-side flag ("an overlay is open"), set by the overlay
  primitives (`anchored-popover`, `action-menu`, `modal-shell`, `toast`, the
  find bar), decides this. It is not a check at each call site.

## 3. What the tab browses

1. **Any address the developer types, the Mac's own `localhost` included.**
   This needs nothing from the service, and it covers a dev server the
   developer runs themselves, a Vercel preview of an agent's pull request, and
   docs.
2. **An agent's sandbox dev server ("Open preview").** The Terminal tab
   proposal (`terminal-tab.md` §5 and §6) already lists this as a later idea.
   Vercel Sandbox can expose up to 15 ports (`Sandbox.create({ ports })`,
   `sandbox.update({ ports })`) at `https://<sub>.vercel.run`
   (`sandbox.domain(port)`). Today Luke opens none
   (`packages/service/src/agents/agent-runtime/sandbox.ts`), and Vercel calls
   these URLs public, with no documented visitor authentication. So the URL
   would be a bearer-less address of whatever the agent's server serves while
   the sandbox runs, which is a security decision in its own right. It also
   needs the sandbox held up while the tab is open, as a terminal holds it.

   The v1 tab needs no port forwarding, since it runs on the Mac and reaches
   the Mac's own `localhost` directly. Forwarding only matters for "Open
   preview", which has two ways in:

   - **Vercel's exposed ports**, as above. They're cheap, but the address is
     open to anyone who has it.
   - **A forward through Luke's service.** The terminal relay
     (`apps/web/server/terminal/`) carries one sandbox port to a loopback port
     on the Mac under the account's session, the way `ssh -L` does. Only the
     signed-in account reaches it. The cost is an HTTP and WebSocket tunnel,
     plus holding the sandbox up while the tab is open.

   The second keeps an agent's unfinished app private, so it is the one
   recommended when "Open preview" is taken up. The Browser tab opens either
   address the same way.
3. **The agent drives the browser (Cursor, Codex).** The agent already has
   Playwright and Chromium in its sandbox and screenshots its own work there
   (`coder-host/instructions.ts`). Driving the *developer's* view from a cloud
   agent would be a new Mac-side tool over the gateway, like `run_on_mac`,
   with approvals. This is the largest piece and is left out of scope here.

## 4. Privacy and the "Never" rules

- The view gets its own persistent partition (`persist:browser`), so a site's
  cookies never share a jar with Luke's own renderer. It gets no preload,
  `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
- A permission request (camera, microphone, geolocation, notifications, HID,
  serial) is denied by default.
- `window.open` opens a new Browser tab. Downloads are refused, or go to
  `~/Downloads` behind a confirm. A non-`http(s)` scheme goes to the system
  through `shell.openExternal`, behind a confirm.
- Session replay can't see the live view, which is another `webContents`. It
  **would** see the still drawn during an overlay, since that is an `<img>` in
  the panel: the still must carry `ph-no-capture` and be masked in
  `session-replay.ts`. Its address bar's words are masked like every other
  word.
- A page's address, title, and contents never enter a trace, a counted event,
  a fixture, app state, or the voice window. Counting "a Browser tab opened"
  carries no address. An AGENTS.md "Never" line saying so is the Terminal
  tab's precedent, and it needs Dean's approval.

## 5. Recommendation

Build **§3.1 on `WebContentsView`, behind an experiment** (Settings ›
Experimental › Browser tab): a Browser tab in the side panel with an address
bar, back, forward, reload, ⌘F through `findInPage`, and ⌘L for the address.
It's opened from the "+" and from a link ⌘-clicked in a transcript. Like the
Page tab, it is kept nowhere across a launch, not pinned, and held to the open
task. "Open preview" (§3.2) and agent control (§3.3) stay later steps, each on
Dean's say.

Why not the cheaper `<iframe>`: it would ship in about half the files, but
most real pages refuse to load in it. A browser that can't open GitHub or a
protected Vercel preview reads as broken, and loosening `frame-src` to every
origin is a hardening change for a lesser feature.

## 6. PR stack (if §5 is chosen)

Roughly 20 to 26 files, mostly following the Page tab's path through
`tab-strip-model.ts`, `use-side-panel.ts`, `side-panel.tsx`, `tab-look.tsx`,
and their tests.

1. `feat(settings): a Browser tab experiment` adds the `EXPERIMENT` key and
   its rows in `counted.ts`, `product-events.ts`, and `settings-anchors.ts`.
2. `feat(desktop): main holds one browser view per Browser tab` adds the
   `WebContentsView` with its partition, permission, navigation, and download
   posture, plus the `browser.*` acts in `packages/host/src/acts.ts` (open,
   navigate, back, forward, reload, bounds, show, hide, find, close) and their
   router rows. It is tested against a fake window seam.
3. `feat(desktop): a Browser tab in the side panel` adds the `{browser}` strip
   kind, the address bar, the pane that reports its bounds, and the "+" entry,
   all behind the experiment.
4. `feat(desktop): a covered or moving Browser tab shows a still` adds the
   overlay flag on the overlay primitives, the capture, and the session-replay
   mask.
5. `feat(desktop): ⌘F, ⌘L, and ⌘-click open in a Browser tab`.

Later, each on Dean's say: "Open preview" of a sandbox port; element comments
sent to an agent; agent control.

## 7. Questions for Dean

1. Which embedding: `WebContentsView` (recommended), `<iframe>`, or not now?
2. Is v1 the developer's own browsing only (§3.1), with "Open preview" later?
3. Is the AGENTS.md line in §4 approved?
