import type { IntegrationTool } from "./integration-health";
import { TOOL_BADGE, toolBadge, toolGroups } from "./integration-tool-groups";
import { Highlighted } from "./search-field";

/**
 * integration-tool-list.tsx -- one integration's tools as a list draws them, in the MCP popover's server page and in Settings › Integrations alike.
 *
 * The tools are laid out by `integration-tool-groups.ts`: alphabetical, in
 * runs under the name prefix they clearly share, with the rest under Other,
 * a run's heading drawn only where there is more than one run and staying
 * at its scroller's top while its run scrolls under it. Each tool is its
 * name in the code face, the badge its server's own annotations earn it,
 * and what it does in two lines at most, the whole line its title; the
 * words a search landed on are marked in both. Where the list is drawn,
 * and what scrolls it, is the owner's.
 */

/** What heads the tools no prefix runs. */
const OTHER_TOOLS = "Other";

function ToolItem({
  tool,
  tokens,
  server,
}: {
  tool: IntegrationTool;
  tokens: readonly string[];
  server: string;
}): React.JSX.Element {
  const badge = toolBadge(tool.annotations);
  return (
    <li className="integration-tool" title={tool.description || undefined}>
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
      {tool.description !== "" ? (
        <span className="integration-tool-description">
          <Highlighted text={tool.description} tokens={tokens} />
        </span>
      ) : null}
    </li>
  );
}

export function IntegrationToolList({
  server,
  tools,
  tokens,
}: {
  /** The integration's name, which the badges' titles and an unrun list's name say. */
  server: string;
  tools: readonly IntegrationTool[];
  /** The words a search asks for, marked where they landed. */
  tokens: readonly string[];
}): React.JSX.Element {
  const runs = toolGroups(tools);
  return (
    <>
      {runs.map((run) => (
        <div key={run.prefix ?? "rest"}>
          {runs.length > 1 ? (
            <div
              className="integration-tool-run"
              data-prefix={run.prefix !== undefined ? "true" : undefined}
            >
              {run.prefix !== undefined ? `${run.prefix}*` : OTHER_TOOLS}
            </div>
          ) : null}
          <ul
            className="integration-tool-list"
            aria-label={run.prefix !== undefined ? `${run.prefix}*` : `${server} tools`}
          >
            {run.tools.map((tool) => (
              <ToolItem key={tool.name} tool={tool} tokens={tokens} server={server} />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
