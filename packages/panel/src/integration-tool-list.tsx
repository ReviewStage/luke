import type { IntegrationTool } from "@luke/features/integration-health";
import {
  requiredFirst,
  TOOL_BADGE,
  TOOL_HINT,
  type ToolHint,
  toolBadge,
  toolHints,
  toolHintWords,
  toolSummary,
  toolTitle,
} from "@luke/features/integration-tool-model";
import {
  ArrowLeftIcon,
  BADGE_TONE,
  Badge,
  type BadgeTone,
  IconButton,
  LIST_DENSITY,
  LIST_ROW_CURRENT,
  List,
  ListRow,
  type ListRowHint,
  ScrollArea,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { cloneElement, createContext, useContext } from "react";
import { MarkdownMessage } from "./markdown-message.js";
import { Highlighted } from "./search-field.js";
import { Tooltip } from "./tooltip.js";

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
 * keys in a field of its own, as the MCP popover's filter does, a press
 * keeps the focus there (`keepFocus`), and otherwise the current row is
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
 * The badge and the hints are `@luke/ui`'s Badge, the danger tone for what
 * destroys.
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

/** What makes a row's tool the current one, where its owner moves the highlight to the pointer. */
const RowHighlight = createContext<(() => void) | undefined>(undefined);

/**
 * The pointer coming onto a row makes its tool the current one, as a
 * menu's highlight follows the pointer. Note that it rides the row's hint
 * slot, the one door to its press's pointer handlers, and raises no words.
 */
const PointerHighlight: ListRowHint = ({ children }) => {
  const highlight = useContext(RowHighlight);
  return cloneElement(children, {
    onPointerEnter: (event) => {
      children.props.onPointerEnter?.(event);
      highlight?.();
    },
  });
};

/** The badge a tool wears on its row and at the head of its page's hints. */
function ToolBadge({ tool }: { tool: IntegrationTool }): React.JSX.Element | null {
  const badge = toolBadge(tool.annotations);
  if (badge === undefined) return null;
  return (
    <Badge tone={badge === TOOL_BADGE.DESTRUCTIVE ? BADGE_TONE.DANGER : BADGE_TONE.NEUTRAL}>
      {badge}
    </Badge>
  );
}

/** The tone a hint is said in: the danger tone for what destroys, the quiet one for the rest. */
function hintTone(hint: ToolHint): BadgeTone {
  return hint === TOOL_HINT.DESTRUCTIVE ? BADGE_TONE.DANGER : BADGE_TONE.NEUTRAL;
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
  keepFocus = false,
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
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>, tool: IntegrationTool) => void;
  /** Whether a pointer's press on a row leaves the focus where it is: where the owner keeps the keys in a field of its own. */
  keepFocus?: boolean;
  /** Each row's press as it is drawn and taken away, so an owner can hand it the focus. */
  rowRef?: (tool: IntegrationTool, press: HTMLElement | null) => void;
}): React.JSX.Element {
  return (
    <List label={`${server} tools`} density={LIST_DENSITY.COMPACT}>
      {tools.map((tool) => {
        const isCurrent = tool.name === current;
        return (
          <RowHighlight.Provider
            key={tool.name}
            value={onCurrent === undefined || isCurrent ? undefined : () => onCurrent(tool)}
          >
            <ListRow
              id={idOf?.(tool)}
              ref={rowRef === undefined ? undefined : (press) => rowRef(tool, press)}
              title={
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
                  <ToolBadge tool={tool} />
                </span>
              }
              description={
                tool.description === "" ? undefined : (
                  <Highlighted text={toolSummary(tool.description)} tokens={tokens} />
                )
              }
              current={isCurrent ? LIST_ROW_CURRENT.ITEM : undefined}
              chevron={onOpen !== undefined}
              keepFocus={keepFocus}
              tabbable={keepFocus || isCurrent}
              onPress={onOpen === undefined ? undefined : () => onOpen(tool)}
              onKeyDown={onKeyDown === undefined ? undefined : (event) => onKeyDown(event, tool)}
              hint={
                onCurrent === undefined
                  ? undefined
                  : { Hint: PointerHighlight, label: toolTitle(tool) }
              }
            />
          </RowHighlight.Provider>
        );
      })}
    </List>
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
  keepFocus,
  bodyRef,
  onBodyKeyDown,
}: {
  /** The integration's name, which the hints and the badge's title say. */
  server: string;
  tool: IntegrationTool;
  /** The words a search asks for, marked where they landed in what it does. */
  tokens: readonly string[];
  /** What the back is named, where the owner offers one; it stands only where both are given. */
  backLabel?: string;
  onBack?: () => void;
  /** Whether a pointer's press on the back leaves the focus where it is, in a field of the owner's. */
  keepFocus?: boolean;
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
        {onBack !== undefined && backLabel !== undefined ? (
          <Tooltip label={backLabel}>
            <IconButton
              icon={<ArrowLeftIcon />}
              label={backLabel}
              keepFocus={keepFocus}
              onClick={onBack}
            />
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
      {/* The page's one scroller, focused by script so its keys scroll it as any focused scroller's do. */}
      <ScrollArea ref={bodyRef} tabIndex={-1} onKeyDown={onBodyKeyDown}>
        <div className="integration-tool-detail-body">
          {hints.length > 0 ? (
            <ul
              className="integration-tool-hints"
              aria-label={`What ${server}'s server says of this tool`}
            >
              {hints.map((hint) => (
                <li key={hint}>
                  <Badge tone={hintTone(hint)}>{toolHintWords(hint, server)}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
          {tool.description === "" ? (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
              No description.
            </Text>
          ) : (
            <MarkdownMessage
              words={tool.description}
              className="integration-tool-description-whole"
              found={tokens}
            />
          )}
          <Parameters tool={tool} />
        </div>
      </ScrollArea>
    </article>
  );
}
