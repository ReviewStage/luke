import type { IntegrationTool } from "@luke/features/integration-health";
import { useId, useState } from "react";
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
 * the description alike. Where the owner holds the keys in a field of its
 * own, as the MCP popover's filter does, it hands a press-start that keeps
 * the focus there; elsewhere a pressed tool takes the focus, as a button
 * does, so Return and Space reach it next. Where the list is drawn, and what
 * scrolls it, is the owner's.
 */

function ToolItem({
  tool,
  tokens,
  server,
  open,
  onToggle,
  onPressStart,
}: {
  tool: IntegrationTool;
  tokens: readonly string[];
  server: string;
  open: boolean;
  onToggle: () => void;
  onPressStart: ((event: React.MouseEvent) => void) | undefined;
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
        onMouseDown={onPressStart}
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
  onPressStart,
}: {
  /** The integration's name, which the badges' titles and the list's name say. */
  server: string;
  tools: readonly IntegrationTool[];
  /** The words a search asks for, marked where they landed. */
  tokens: readonly string[];
  /** A pointer's press on a tool, before it lands: where the owner keeps the focus in a field of its own. */
  onPressStart?: (event: React.MouseEvent) => void;
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
          onPressStart={onPressStart}
          onToggle={() => {
            // A tool that says nothing of what it does has nothing to open onto.
            if (tool.description !== "") setOpen(open === tool.name ? undefined : tool.name);
          }}
        />
      ))}
    </ul>
  );
}
