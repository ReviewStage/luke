import { useId, useState } from "react";
import type { IntegrationTool } from "./integration-health";
import { byName, TOOL_BADGE, toolBadge } from "./integration-tool-model";
import { Highlighted } from "./search-field";

/**
 * integration-tool-list.tsx -- one integration's tools as a list draws them, in the MCP popover's server page and in Settings › Integrations alike.
 *
 * The tools are one alphabetical list (`integration-tool-model.ts`). Each is
 * its name in the code face, the badge its server's own annotations earn it,
 * and the start of what it does in two lines at most. A press on a tool, or
 * Return on it, opens it in place onto the whole of what it does, wrapped as
 * its server wrote it and selectable, and a second press closes it; one tool
 * is open at a time. The words a search landed on are marked in the name and
 * the description alike. A pointer's press on a tool leaves the focus where
 * it was, so the MCP popover's filter keeps the keys it hears; Tab still
 * reaches every tool. Where the list is drawn, and what scrolls it, is the
 * owner's.
 */

function ToolItem({
  tool,
  tokens,
  server,
  open,
  onToggle,
}: {
  tool: IntegrationTool;
  tokens: readonly string[];
  server: string;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const fullId = useId();
  const badge = toolBadge(tool.annotations);
  const described = tool.description !== "";
  return (
    <li className="integration-tool" data-open={open ? "true" : undefined}>
      <button
        type="button"
        className="integration-tool-head"
        aria-expanded={described ? open : undefined}
        aria-controls={open && described ? fullId : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggle}
      >
        <span className="integration-tool-name">
          <span className="integration-tool-id">
            <Highlighted text={tool.name} tokens={tokens} />
          </span>
          {badge !== undefined ? (
            <span
              className="integration-tool-badge"
              data-destructive={badge === TOOL_BADGE.DESTRUCTIVE ? "true" : undefined}
              title={`${server}'s server marks this tool ${badge.toLowerCase()}`}
            >
              {badge}
            </span>
          ) : null}
        </span>
        {described && !open ? (
          <span className="integration-tool-description">
            <Highlighted text={tool.description} tokens={tokens} />
          </span>
        ) : null}
      </button>
      {described && open ? (
        <p id={fullId} className="integration-tool-full">
          <Highlighted text={tool.description} tokens={tokens} />
        </p>
      ) : null}
    </li>
  );
}

export function IntegrationToolList({
  server,
  tools,
  tokens,
}: {
  /** The integration's name, which the badges' titles and the list's name say. */
  server: string;
  tools: readonly IntegrationTool[];
  /** The words a search asks for, marked where they landed. */
  tokens: readonly string[];
}): React.JSX.Element {
  const [open, setOpen] = useState<string | undefined>(undefined);
  return (
    <ul className="integration-tool-list" aria-label={`${server} tools`}>
      {byName(tools).map((tool) => (
        <ToolItem
          key={tool.name}
          tool={tool}
          tokens={tokens}
          server={server}
          open={open === tool.name}
          onToggle={() => {
            // A tool that says nothing of what it does has nothing to open onto.
            if (tool.description !== "") setOpen(open === tool.name ? undefined : tool.name);
          }}
        />
      ))}
    </ul>
  );
}
