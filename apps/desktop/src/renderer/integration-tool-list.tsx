import type { IntegrationTool } from "@luke/features/integration-health";
import {
  requiredFirst,
  TOOL_BADGE,
  TOOL_HINT,
  toolBadge,
  toolHints,
  toolHintWords,
  toolSummary,
  toolTitle,
} from "@luke/features/integration-tool-model";
import { ArrowLeftIcon, ChevronRightIcon } from "@luke/ui";
import { MarkdownMessage } from "./markdown-message";
import { Highlighted } from "./search-field";
import { Tooltip } from "./tooltip";

/**
 * integration-tool-list.tsx -- one integration's tools as a list draws them, and one tool's page, in the MCP popover and in Settings › Integrations alike.
 *
 * The list is the tools in the order its owner hands them
 * (`integration-tool-model.ts`'s alphabetical one). Each row is one line:
 * the tool's title where its server gave one, with its name beside it in
 * the code face, else its name alone, the badge its server's annotations
 * earn it, and the first sentence of what it does under them; the words a
 * search landed on are marked. One row is the owner's current one, drawn
 * highlighted, and a press on a row opens it; where the owner keeps the
 * keys in a field of its own, as the MCP popover's filter does, it hands a
 * press-start that keeps the focus there, and otherwise the current row is
 * the list's one stop for Tab, as a listbox's is. Where the owner opens
 * nothing, as a server's hover card does (`planning/server-card.tsx`), each
 * row is its words alone, with no press and no chevron.
 *
 * A tool's page is its head, the title and the name in the code face after
 * a back where its owner offers one, then every hint its server sent,
 * then what it does rendered as the markdown its server wrote, selectable,
 * the words a search landed on marked in it, then its parameters, those a
 * call must give first, each its name, its
 * type, what it is, and the values it takes as chips, its default outlined.
 * A page whose server said nothing of its tool says so. The page's body is
 * its one scroller, which the owner may hand the focus to, so the arrows
 * scroll it. Where either is drawn, and what the keys do, is the owner's.
 */

/** Keeps a row inside its scroller's view, scrolling only the scroller (the renderer's rule against `scrollIntoView`). */
export function keepInView(list: HTMLElement | null, row: Element | null): void {
  if (list === null || !(row instanceof HTMLElement)) return;
  const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (top + row.offsetHeight > list.scrollTop + list.clientHeight)
    list.scrollTop = top + row.offsetHeight - list.clientHeight;
}

/** The badge a tool wears on its row and at the head of its page's hints. */
function Badge({ tool }: { tool: IntegrationTool }): React.JSX.Element | null {
  const badge = toolBadge(tool.annotations);
  if (badge === undefined) return null;
  return (
    <span
      className="integration-tool-badge"
      data-destructive={badge === TOOL_BADGE.DESTRUCTIVE ? "true" : undefined}
    >
      {badge}
    </span>
  );
}

/** Whether a tool's name stands beside its title, which it does only where the title is not the name. */
function namedApart(tool: IntegrationTool): boolean {
  return toolTitle(tool) !== tool.name;
}

export function IntegrationToolList({
  server,
  tools,
  tokens,
  current,
  idOf,
  onCurrent,
  onOpen,
  onKeyDown,
  onPressStart,
  rowRef,
}: {
  /** The integration's name, which the badges' titles and the list's name say. */
  server: string;
  /** The tools, in the order they are drawn. */
  tools: readonly IntegrationTool[];
  /** The words a search asks for, marked where they landed. */
  tokens: readonly string[];
  /** The name of the row drawn highlighted, and the list's one Tab stop. */
  current: string | undefined;
  /** The id a row is drawn with, so an owner can find it. */
  idOf?: (tool: IntegrationTool) => string;
  /** The pointer came to rest on a row, where resting there moves the highlight. */
  onCurrent?: (tool: IntegrationTool) => void;
  /** A row was pressed; none where a row opens nothing, and is drawn as its words alone. */
  onOpen?: ((tool: IntegrationTool) => void) | undefined;
  /** A key on a row, where the rows hold the focus themselves. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>, tool: IntegrationTool) => void;
  /** A pointer's press on a row, before it lands: where the owner keeps the focus in a field of its own. */
  onPressStart?: (event: React.MouseEvent) => void;
  /** Each row's button as it is drawn and taken away, so an owner can hand it the focus. */
  rowRef?: (tool: IntegrationTool, button: HTMLButtonElement | null) => void;
}): React.JSX.Element {
  return (
    <ul className="integration-tool-list" aria-label={`${server} tools`}>
      {tools.map((tool) => {
        const isCurrent = tool.name === current;
        const words = (
          <>
            <span className="integration-tool-name">
              <span
                className="integration-tool-title"
                data-name={namedApart(tool) ? undefined : "true"}
              >
                <Highlighted text={toolTitle(tool)} tokens={tokens} />
              </span>
              {namedApart(tool) ? (
                <span className="integration-tool-id">
                  <Highlighted text={tool.name} tokens={tokens} />
                </span>
              ) : null}
              <Badge tool={tool} />
            </span>
            {tool.description !== "" ? (
              <span className="integration-tool-description">
                <Highlighted text={toolSummary(tool.description)} tokens={tokens} />
              </span>
            ) : null}
          </>
        );
        return (
          <li
            key={tool.name}
            id={idOf?.(tool)}
            className="integration-tool"
            data-current={isCurrent ? "true" : undefined}
          >
            {onOpen === undefined ? (
              <div className="integration-tool-head">{words}</div>
            ) : (
              <button
                ref={rowRef === undefined ? undefined : (button) => rowRef(tool, button)}
                type="button"
                className="integration-tool-head"
                tabIndex={onPressStart === undefined && !isCurrent ? -1 : undefined}
                aria-current={isCurrent ? "true" : undefined}
                onMouseDown={onPressStart}
                onMouseMove={
                  onCurrent === undefined || isCurrent ? undefined : () => onCurrent(tool)
                }
                onClick={() => onOpen(tool)}
                onKeyDown={onKeyDown === undefined ? undefined : (event) => onKeyDown(event, tool)}
              >
                {words}
                <span className="integration-tool-chevron" aria-hidden="true">
                  <ChevronRightIcon />
                </span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A tool's parameters, those a call must give first. */
function Parameters({ tool }: { tool: IntegrationTool }): React.JSX.Element | null {
  // A tool whose input schema its server's answer could not say is drawn with no parameters at all, rather than as taking none.
  if (tool.parameters === undefined) return null;
  return (
    <section className="integration-tool-parameters" aria-label="Parameters">
      <h3 className="integration-tool-section">
        {"Parameters"}
        <span className="integration-tool-section-count">
          {tool.parameters.length === 0 ? "none" : tool.parameters.length}
        </span>
      </h3>
      {tool.parameters.length === 0 ? null : (
        <dl className="integration-tool-parameter-list">
          {requiredFirst(tool.parameters).map((parameter) => (
            <div key={parameter.name} className="integration-tool-parameter">
              <dt className="integration-tool-parameter-head">
                <span className="integration-tool-parameter-name">{parameter.name}</span>
                <span className="integration-tool-parameter-type">{parameter.type}</span>
                {parameter.required ? (
                  <span className="integration-tool-parameter-required">required</span>
                ) : null}
              </dt>
              {parameter.description === undefined &&
              parameter.values === undefined &&
              parameter.default === undefined ? null : (
                <dd className="integration-tool-parameter-body">
                  {parameter.description !== undefined ? (
                    <MarkdownMessage
                      words={parameter.description}
                      className="integration-tool-parameter-description"
                    />
                  ) : null}
                  <ParameterValues values={parameter.values} fallback={parameter.default} />
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** The values a parameter takes as chips, its default outlined among them or said after them. */
function ParameterValues({
  values = [],
  fallback,
}: {
  values?: readonly string[] | undefined;
  fallback: string | undefined;
}): React.JSX.Element | null {
  if (values.length === 0 && fallback === undefined) return null;
  return (
    <span className="integration-tool-parameter-values">
      {values.map((value) => (
        <code key={value} data-default={value === fallback ? "true" : undefined}>
          {value}
        </code>
      ))}
      {fallback !== undefined && !values.includes(fallback) ? (
        <span>
          {"default "}
          <code data-default="true">{fallback}</code>
        </span>
      ) : null}
    </span>
  );
}

export function IntegrationToolDetail({
  server,
  tool,
  tokens,
  backLabel,
  onBack,
  onPressStart,
  bodyRef,
  onBodyKeyDown,
}: {
  /** The integration's name, which the hints and the badge's title say. */
  server: string;
  tool: IntegrationTool;
  /** The words a search asks for, marked where they landed in what it does. */
  tokens: readonly string[];
  /** What the back is named, where the owner offers one. */
  backLabel?: string;
  onBack?: () => void;
  /** A pointer's press on the back, before it lands. */
  onPressStart?: (event: React.MouseEvent) => void;
  /** The page's scroller, which the owner may hand the focus to. */
  bodyRef?: React.Ref<HTMLDivElement>;
  /** A key while the scroller holds the focus. */
  onBodyKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}): React.JSX.Element {
  const hints = toolHints(tool.annotations);
  const title = toolTitle(tool);
  return (
    <article className="integration-tool-detail" aria-label={title}>
      <header className="integration-tool-detail-head">
        {onBack !== undefined ? (
          <Tooltip label={backLabel}>
            <button
              type="button"
              className="icon-button integration-tool-back"
              aria-label={backLabel}
              onMouseDown={onPressStart}
              onClick={onBack}
            >
              <ArrowLeftIcon />
            </button>
          </Tooltip>
        ) : null}
        <h2
          className="integration-tool-detail-title"
          data-name={namedApart(tool) ? undefined : "true"}
        >
          {title}
        </h2>
        {namedApart(tool) ? (
          <code className="integration-tool-detail-name">{tool.name}</code>
        ) : null}
      </header>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the page's one scroller, whose keys scroll it as any focused scroller's do. */}
      <div
        ref={bodyRef}
        className="integration-tool-detail-body"
        tabIndex={-1}
        onKeyDown={onBodyKeyDown}
      >
        {hints.length > 0 ? (
          <ul
            className="integration-tool-hints"
            aria-label={`What ${server}'s server says of this tool`}
          >
            {hints.map((hint) => (
              <li
                key={hint}
                className="integration-tool-hint"
                data-hint={hint}
                data-tone={
                  hint === TOOL_HINT.DESTRUCTIVE
                    ? "danger"
                    : hint === TOOL_HINT.OPEN_WORLD || hint === TOOL_HINT.CLOSED_WORLD
                      ? "quiet"
                      : undefined
                }
              >
                {toolHintWords(hint, server)}
              </li>
            ))}
          </ul>
        ) : null}
        {tool.description === "" ? (
          <p className="integration-tool-silent">No description.</p>
        ) : (
          <MarkdownMessage
            words={tool.description}
            className="integration-tool-description-whole"
            found={tokens}
          />
        )}
        <Parameters tool={tool} />
      </div>
    </article>
  );
}
