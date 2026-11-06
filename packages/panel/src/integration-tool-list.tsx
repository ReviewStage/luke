import type { IntegrationTool } from "@repo/features/integration-health";
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
} from "@repo/features/integration-tool-model";
import {
  ALIGN,
  BackButton,
  FILL_ELEMENT,
  Fill,
  GAP,
  Inline,
  LAYOUT_ELEMENT,
  LIST_DENSITY,
  LIST_ROW_CURRENT,
  List,
  ListRow,
  type ListRowHint,
  NO_BACK_KEY,
  ONE_LINE_ELEMENT,
  OneLine,
  QUIET_MARK,
  type QuietMark,
  QuietWords,
  ScrollArea,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { ReplayMask, ReplayWords } from "@repo/ui/session-replay-marks";
import type { VirtualRowPlace, VirtualRowsHandle } from "@repo/ui/virtual-rows";
import { cloneElement, createContext, type ReactNode, type RefObject, useContext } from "react";
import { MarkdownMessage } from "./markdown-message.js";
import { Highlighted } from "./search-field.js";

const PARAMETER_VALUE =
  "rounded-ui-6 bg-fill-strong px-tight-gap font-mono text-caption text-muted-foreground data-[default=true]:text-foreground data-[default=true]:shadow-tool-default";

const DETAIL_TITLE =
  "integration-tool-detail-title m-0 flex-initial text-section font-ui-semibold text-foreground";

export function keepInView(list: HTMLElement | null, row: Element | null): void {
  if (list === null || !(row instanceof HTMLElement)) return;
  const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (top + row.offsetHeight > list.scrollTop + list.clientHeight)
    list.scrollTop = top + row.offsetHeight - list.clientHeight;
}

const RowHighlight = createContext<(() => void) | undefined>(undefined);

const PointerHighlight: ListRowHint = ({ children }) => {
  const highlight = useContext(RowHighlight);
  return cloneElement(children, {
    onPointerEnter: (event) => {
      children.props.onPointerEnter?.(event);
      highlight?.();
    },
  });
};

function ToolBadge({ tool }: { tool: IntegrationTool }): React.JSX.Element | null {
  const badge = toolBadge(tool.annotations);
  if (badge === undefined) return null;
  return (
    <QuietWords mark={badge === TOOL_BADGE.DESTRUCTIVE ? QUIET_MARK.FAILED : undefined}>
      {badge}
    </QuietWords>
  );
}

function hintMark(hint: ToolHint): QuietMark | undefined {
  return hint === TOOL_HINT.DESTRUCTIVE ? QUIET_MARK.FAILED : undefined;
}

function ToolWords({
  shown,
  children,
}: {
  shown: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <ReplayWords unmasked={shown} masked={!shown}>
      {children}
    </ReplayWords>
  );
}

function HintWords({
  words,
  server,
  masked,
}: {
  words: string;
  server: string;
  masked: boolean;
}): React.JSX.Element {
  const at = words.indexOf(server);
  if (!masked || at < 0) return <>{words}</>;
  return (
    <>
      {words.slice(0, at)}
      <ReplayMask>{server}</ReplayMask>
      {words.slice(at + server.length)}
    </>
  );
}

const TOOL_ESTIMATE_PX = 48;

function namedApart(tool: IntegrationTool): boolean {
  return toolTitle(tool) !== tool.name;
}

export function IntegrationToolList({
  scroller,
  handle,
  server,
  toolWordsShown = false,
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
  scroller: RefObject<HTMLElement | null>;
  handle?: RefObject<VirtualRowsHandle | null> | undefined;
  server: string;
  toolWordsShown?: boolean;
  tools: readonly IntegrationTool[];
  tokens: readonly string[];
  current: string | undefined;
  idOf?: (tool: IntegrationTool) => string;
  onCurrent?: (tool: IntegrationTool) => void;
  onOpen?: ((tool: IntegrationTool) => void) | undefined;
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>, tool: IntegrationTool) => void;
  keepFocus?: boolean;
  rowRef?: (tool: IntegrationTool, press: HTMLElement | null) => void;
}): React.JSX.Element {
  const row = (index: number, place: VirtualRowPlace) => {
    const tool = tools[index];
    if (tool === undefined) return null;
    const isCurrent = tool.name === current;
    return (
      <RowHighlight.Provider
        value={onCurrent === undefined || isCurrent ? undefined : () => onCurrent(tool)}
      >
        <ListRow
          place={place}
          id={idOf?.(tool)}
          ref={rowRef === undefined ? undefined : (press) => rowRef(tool, press)}
          title={
            <span className="integration-tool-name flex min-w-0 items-baseline gap-item-gap [&>.ui-quiet-words]:flex-none [&>.ui-quiet-words]:self-center">
              <OneLine
                className={
                  namedApart(tool)
                    ? "integration-tool-title flex-initial"
                    : "integration-tool-title integration-tool-code flex-initial font-mono text-caption-inline"
                }
                words={toolTitle(tool)}
              >
                <ToolWords shown={toolWordsShown}>
                  <Highlighted text={toolTitle(tool)} tokens={tokens} />
                </ToolWords>
              </OneLine>
              {namedApart(tool) ? (
                <OneLine
                  className="integration-tool-id min-w-0 flex-[0_100_auto] font-mono text-caption-inline font-ui-regular text-muted-foreground"
                  words={tool.name}
                >
                  <ToolWords shown={toolWordsShown}>
                    <Highlighted text={tool.name} tokens={tokens} />
                  </ToolWords>
                </OneLine>
              ) : null}
              <ToolBadge tool={tool} />
            </span>
          }
          description={
            tool.description === "" ? undefined : (
              <ToolWords shown={toolWordsShown}>
                <Highlighted text={toolSummary(tool.description)} tokens={tokens} />
              </ToolWords>
            )
          }
          current={isCurrent ? LIST_ROW_CURRENT.ITEM : undefined}
          chevron={onOpen !== undefined}
          keepFocus={keepFocus}
          tabbable={keepFocus ? true : undefined}
          onPress={onOpen === undefined ? undefined : () => onOpen(tool)}
          onKeyDown={onKeyDown === undefined ? undefined : (event) => onKeyDown(event, tool)}
          hint={
            onCurrent === undefined ? undefined : { Hint: PointerHighlight, label: toolTitle(tool) }
          }
        />
      </RowHighlight.Provider>
    );
  };
  return (
    <List
      label={`${server} tools`}
      density={LIST_DENSITY.COMPACT}
      run={{
        scroller,
        keys: tools.map((tool) => tool.name),
        estimate: TOOL_ESTIMATE_PX,
        handle,
        row,
      }}
    />
  );
}

function Parameters({
  tool,
  shown,
}: {
  tool: IntegrationTool;
  shown: boolean;
}): React.JSX.Element | null {
  if (tool.parameters === undefined) return null;
  return (
    <section className="integration-tool-parameters @container" aria-label="Parameters">
      <Text
        as={TEXT_ELEMENT.H3}
        variant={TEXT_VARIANT.GROUP}
        className="integration-tool-section m-0 mb-tight-gap flex items-baseline gap-item-gap"
      >
        {"Parameters"}
        <span className="integration-tool-section-count tabular-nums">
          {tool.parameters.length === 0 ? "none" : tool.parameters.length}
        </span>
      </Text>
      {tool.parameters.length === 0 ? null : (
        <dl className="integration-tool-parameter-list m-0 flex flex-col">
          {requiredFirst(tool.parameters).map((parameter) => (
            <div
              key={parameter.name}
              className="integration-tool-parameter flex flex-col gap-list-gap border-t border-border py-item-gap"
            >
              <dt className="integration-tool-parameter-head flex min-w-0 flex-wrap items-baseline gap-x-item-gap">
                <span className="integration-tool-parameter-name select-text font-mono text-caption-inline text-foreground wrap-anywhere">
                  <ToolWords shown={shown}>{parameter.name}</ToolWords>
                </span>
                <span className="integration-tool-parameter-type font-mono text-caption-inline text-muted-foreground">
                  <ToolWords shown={shown}>{parameter.type}</ToolWords>
                </span>
                {parameter.required ? (
                  <span className="integration-tool-parameter-required ml-auto text-caption-inline font-ui-semibold text-attention">
                    required
                  </span>
                ) : null}
              </dt>
              {parameter.description === undefined &&
              parameter.values === undefined &&
              parameter.default === undefined ? null : (
                <dd className="integration-tool-parameter-body m-0 flex select-text flex-col gap-tight-gap text-caption text-muted-foreground">
                  {parameter.description !== undefined ? (
                    <ToolWords shown={shown}>
                      <MarkdownMessage
                        words={parameter.description}
                        className="integration-tool-parameter-description [&_code]:text-foreground"
                      />
                    </ToolWords>
                  ) : null}
                  <ParameterValues
                    values={parameter.values}
                    fallback={parameter.default}
                    shown={shown}
                  />
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function ParameterValues({
  values = [],
  fallback,
  shown,
}: {
  values?: readonly string[] | undefined;
  fallback: string | undefined;
  shown: boolean;
}): React.JSX.Element | null {
  if (values.length === 0 && fallback === undefined) return null;
  return (
    <span className="integration-tool-parameter-values flex flex-wrap items-baseline gap-tight-gap text-muted-foreground">
      {values.map((value) => (
        <code
          key={value}
          className={PARAMETER_VALUE}
          data-default={value === fallback ? "true" : undefined}
        >
          <ToolWords shown={shown}>{value}</ToolWords>
        </code>
      ))}
      {fallback !== undefined && !values.includes(fallback) ? (
        <span>
          {"default "}
          <code className={PARAMETER_VALUE} data-default="true">
            <ToolWords shown={shown}>{fallback}</ToolWords>
          </code>
        </span>
      ) : null}
    </span>
  );
}

export function IntegrationToolDetail({
  server,
  serverReplayMasked = true,
  toolWordsShown = false,
  tool,
  tokens,
  backPlace,
  onBack,
  keepFocus,
  bodyRef,
  onBodyKeyDown,
}: {
  server: string;
  serverReplayMasked?: boolean;
  toolWordsShown?: boolean;
  tool: IntegrationTool;
  tokens: readonly string[];
  backPlace?: string;
  onBack?: () => void;
  keepFocus?: boolean;
  bodyRef?: React.Ref<HTMLDivElement>;
  onBodyKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}): React.JSX.Element {
  const hints = toolHints(tool.annotations);
  const title = toolTitle(tool);
  return (
    <Fill as={FILL_ELEMENT.ARTICLE} className="integration-tool-detail" aria-label={title}>
      <header className="integration-tool-detail-head flex h-pane-bar min-w-0 flex-none items-center gap-icon-gap border-b border-border px-list-inset">
        {onBack !== undefined && backPlace !== undefined ? (
          <BackButton
            label={backPlace}
            place={backPlace}
            command={NO_BACK_KEY}
            keepFocus={keepFocus}
            onBack={onBack}
          />
        ) : null}
        <OneLine
          as={ONE_LINE_ELEMENT.H2}
          className={
            namedApart(tool)
              ? DETAIL_TITLE
              : `${DETAIL_TITLE} integration-tool-code font-mono text-caption-inline`
          }
          words={title}
        >
          <ToolWords shown={toolWordsShown}>{title}</ToolWords>
        </OneLine>
        {namedApart(tool) ? (
          <OneLine
            as={ONE_LINE_ELEMENT.CODE}
            className="integration-tool-detail-name min-w-0 flex-[0_100_auto] select-text font-mono text-caption-inline text-muted-foreground"
            words={tool.name}
          >
            <ToolWords shown={toolWordsShown}>{tool.name}</ToolWords>
          </OneLine>
        ) : null}
      </header>
      <ScrollArea ref={bodyRef} tabIndex={-1} onKeyDown={onBodyKeyDown}>
        <div className="integration-tool-detail-body flex flex-col gap-block-gap px-list-inset pt-row-inset pb-list-inset">
          {hints.length > 0 ? (
            <Inline
              as={LAYOUT_ELEMENT.UL}
              gap={GAP.TIGHT}
              align={ALIGN.STRETCH}
              className="integration-tool-hints"
              aria-label={`What ${server}'s server says of this tool`}
            >
              {hints.map((hint) => (
                <li key={hint}>
                  <QuietWords mark={hintMark(hint)}>
                    <HintWords
                      words={toolHintWords(hint, server)}
                      server={server}
                      masked={serverReplayMasked}
                    />
                  </QuietWords>
                </li>
              ))}
            </Inline>
          ) : null}
          {tool.description === "" ? (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              No description.
            </Text>
          ) : (
            <ToolWords shown={toolWordsShown}>
              <MarkdownMessage
                words={tool.description}
                className="integration-tool-description-whole cursor-text select-text text-caption-inline leading-tool-description text-muted-foreground"
                found={tokens}
              />
            </ToolWords>
          )}
          <Parameters tool={tool} shown={toolWordsShown} />
        </div>
      </ScrollArea>
    </Fill>
  );
}
