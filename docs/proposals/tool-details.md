# Proposal: how a tool's full description is shown

Status: **approved by Dean on 2026-10-14** ("I love B, let's do it"), and
built in two PRs: the wire (a tool's title and parameters, #2671), then the
shared detail page in the MCP popover and Settings › Integrations.

The design show lives at `docs/proposals/tool-details/index.html`, one
self-contained file built from the desktop renderer's real components and
stylesheet over synthetic tools; it fetches nothing. The research behind it,
every claim with its URL, is `docs/proposals/tool-details/research.md`.

Dean's ask: "I don't like the UI for seeing full description of tools. Can
we get a redesign?", and later "Are there other annotations that we could
use?"

## Decisions

1. **Option B, a detail page.** A tool's row is one line: its title, its name
   in the code face beside it, its badge, and the first sentence of what it
   does. Enter, Right, or a press opens the tool's page: back, the title and
   the name, the server's hints, the description rendered as markdown, and
   the parameters, the required first, each with its type and its values as
   chips. Escape, Left, or Backspace goes back with the filter and the
   highlight kept. In Settings the page stands beside the list and follows
   the arrows. One list and one page component serve both places
   (`apps/desktop/src/renderer/integration-tool-list.tsx`).
2. **The hints stay off the rows.** The rows keep today's two badges,
   Read-only and Destructive. The page alone says "Only adds, never deletes",
   "Safe to retry", "Reaches outside <provider>", and "Only <provider>'s own
   data", each only where the server sent the hint, never guessed and never
   read as the spec's default.
3. **The title is the display name**, in the spec's order: the tool's own
   `title`, then `annotations.title`, then its name.
4. **Parameters come from the input schema's top level**, read by the
   service into a bounded list (`packages/service/src/integrations/mcp-tool-parameters.ts`);
   nothing nested is expanded. A description is kept up to 8,000 characters.
5. **Icons are deferred.** A tool's `icons` (spec 2025-11-25) would need the
   service to fetch each and hand it on as `data:`, because the panel's CSP
   refuses another host's image.
