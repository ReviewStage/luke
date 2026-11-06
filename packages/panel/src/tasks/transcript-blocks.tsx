import {
  AGENT_TODO_STATUS,
  type AgentTodoStatus,
  type AgentTodos,
} from "@repo/features/agent-wire";
import type { IntegrationProvider } from "@repo/features/integration-wire";
import { readLink } from "@repo/features/link-grammar";
import {
  decodeMention,
  encodeMention,
  MENTION_KIND,
  mayNameMention,
} from "@repo/features/mention-link";
import type { CatalogModel, ModelChoice } from "@repo/features/models-wire";
import { formatBytes } from "@repo/features/number-format";
import { descriptionAttachmentOf } from "@repo/features/description-attachment-link";
import {
  agentCallLine,
  CALL_KIND,
  CALL_WORDS,
  type CallKind,
  type CallLine,
  callLine,
  callPlace,
  isAgentCallKind,
  isCommandKind,
  type MadeCallKind,
  madeCallLine,
  sameFieldsBy,
  sameTurnRow,
  TURN_ROW,
  type TurnRow,
} from "@repo/features/turn-rows";
import { keySpansIn } from "@repo/features/workspace-key";
import {
  DISCLOSURE_BODY,
  DISCLOSURE_LOOK,
  DISCLOSURE_SUMMARY,
  Disclosure,
  DisclosureBody,
  DisclosureChevron,
  DisclosureSummary,
  FAILURE_NOTE_TIME,
  FailureNote,
  GAP,
  GLYPH_ARRIVAL,
  GLYPH_INK,
  GlyphSlot,
  INLINE_REF_LOOK,
  InlineRef,
  LAYOUT_ELEMENT,
  LineButton,
  LineRow,
  NOTE_LINE_LOOK,
  NoteLine,
  OneLine,
  ProviderMark,
  RollingNumber,
  Shimmer,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
  useDisclosurePreviewShown,
  useDisclosureState,
} from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, actorName } from "@repo/ui/actor-model";
import { githubShapes, wholeRendering } from "@repo/ui/github-html";
import {
  AppWindowIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  BookOpenIcon,
  BotIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  CalendarCogIcon,
  CalendarPlusIcon,
  CalendarXIcon,
  CircleCheckIcon,
  CircleDotDashedIcon,
  CircleIcon,
  CirclePlusIcon,
  CircleStopIcon,
  CpuIcon,
  FilePenIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderInputIcon,
  FolderMinusIcon,
  FolderPlusIcon,
  GLYPH,
  GlobeIcon,
  HourglassIcon,
  ImageIcon,
  InboxIcon,
  LaptopIcon,
  LayoutListIcon,
  type LucideIcon,
  PencilLineIcon,
  PlayIcon,
  ScrollTextIcon,
  SearchIcon,
  SendIcon,
  TerminalIcon,
  TimerIcon,
  WrenchIcon,
} from "@repo/ui/icons";
import { siteName } from "@repo/ui/link-face";
import { gluedRun, LINK_GLUE } from "@repo/ui/link-glue";
import {
  MARKDOWN_HTML_STEP,
  type MarkdownComponents,
  type MarkdownNodeProps,
  type MarkdownSteps,
  markdownStep,
  TRANSCRIPT_REMARK_STEPS,
} from "@repo/ui/markdown";
import { QUOTE_CLASS } from "@repo/ui/quote-face";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import {
  type ComponentProps,
  type ComponentType,
  createContext,
  Fragment,
  type MouseEvent,
  memo,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import remarkBreaks from "remark-breaks";
import { ACTOR_SIZE, ActorLine, ActorMark, ActorRef } from "../actor-ref.js";
import { FoldBody } from "../ai-elements/fold.js";
import { MessageResponse, PANEL_MARKDOWN_COMPONENTS } from "../ai-elements/message.js";
import {
  REASONING_BODY_CLASS,
  REASONING_WORDS_CLASS,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../ai-elements/reasoning.js";
import {
  blockSays,
  TOOL_BLOCK,
  TOOL_STATE,
  Tool,
  type ToolBlock,
  ToolContent,
  ToolHeader,
  type ToolHeaderProps,
  ToolInput,
  ToolLine,
  ToolOutput,
  type ToolState,
  ToolStateMark,
  ToolSummary,
  ToolTerminal,
} from "../ai-elements/tool.js";
import { OUTSIDE_GLYPH_CLASS } from "../picture-block.js";
import { GLYPH_STATE, StateGlyph } from "../state-glyph.js";
import { TextLink } from "../text-link.js";
import { useInboxPictureDrawer } from "./inbox-pictures.js";
import { LoneLinkCard } from "./lone-link-card.js";
import { linkChip, type MentionDoors } from "./mention-chip.js";
import { ModelLabel } from "./model-label.js";
import { useDescriptionPictureDrawer } from "./description-pictures.js";
import { SubagentMark } from "./tab-look.js";
import { useMentionDoors } from "./task-mentions.js";
import { cardTitle, type SentWords, todosCount } from "./tool-call-model.js";
import {
  TRANSCRIPT_CODE_AND_TABLE_COMPONENTS,
  TranscriptMarkdownSource,
} from "./transcript-markdown.js";
import { useWordTargets } from "./use-known-names.js";
import { opensAsLink, useOpenLink } from "./use-open-link.js";
import { type CutBody, WHOLE_PART } from "./whole-parts.js";
import { WorkingTime } from "./working-time.js";

export const INERT_LINK_CLASS =
  "text-link-inert underline decoration-dotted decoration-inert-link decoration-1 underline-offset-[0.24em]";

function TranscriptLink({
  href,
  words,
  children,
}: {
  href: string | undefined;
  words: string;
  children: ReactNode;
}): ReactNode {
  const openLink = useOpenLink();
  if (href === undefined || !opensAsLink(href)) {
    return (
      <Tooltip label={href}>
        <span className={INERT_LINK_CLASS}>{children}</span>
      </Tooltip>
    );
  }
  return (
    <TextLink href={href} words={words} onOpen={openLink}>
      {children}
    </TextLink>
  );
}

function SiteChip({ href }: { href: string }): ReactNode {
  const openLink = useOpenLink();
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={<GLYPH.WEBSITE />}
      label={siteName(href) ?? href}
      hintLabel={href}
      onPress={(event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        openLink(href);
      }}
      linkHref={href}
      leaves
      data-site-chip=""
    />
  );
}

const MENTION_ELEMENT = {
  TAG: "app-mention",
  TARGET: "to",
} as const;

const PICTURE_ELEMENT = {
  TAG: "app-picture",
  ADDRESS: "to",
  WORDS: "words",
  CAPTION: "caption",
} as const;

const LONE_LINK_ELEMENT = {
  TAG: "app-lone-link",
  TARGET: "to",
  WORDS: "words",
} as const;

const PICTURE_ROW_ELEMENT = {
  TAG: "app-pictures",
  CLASS: "transcript-pictures",
} as const;

const MENTION_TAGS = {
  [MENTION_ELEMENT.TAG]: [MENTION_ELEMENT.TARGET],
  [PICTURE_ELEMENT.TAG]: [PICTURE_ELEMENT.ADDRESS, PICTURE_ELEMENT.WORDS, PICTURE_ELEMENT.CAPTION],
  [LINK_GLUE.TAG]: [],
  [LONE_LINK_ELEMENT.TAG]: [LONE_LINK_ELEMENT.TARGET, LONE_LINK_ELEMENT.WORDS],
  [PICTURE_ROW_ELEMENT.TAG]: [],
};

interface WordsNode {
  readonly type: string;
  readonly value?: string;
  readonly children?: readonly WordsNode[];
}

interface MarkdownNode extends WordsNode {
  readonly url?: string;
  readonly alt?: string | null;
  readonly title?: string | null;
  readonly identifier?: string;
  children?: readonly MarkdownNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
}

function wordsOf(node: WordsNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map((child) => wordsOf(child)).join("");
}

function markMentions(node: MarkdownNode, definitions: ReadonlyMap<string, MarkdownNode>): void {
  const target =
    node.type === "link"
      ? node.url
      : node.type === "linkReference" && node.identifier !== undefined
        ? definitions.get(node.identifier)?.url
        : undefined;
  if (target !== undefined && (mayNameMention(target) || readLink(target) !== undefined)) {
    node.data = {
      hName: MENTION_ELEMENT.TAG,
      hProperties: { [MENTION_ELEMENT.TARGET]: target },
    };
    return;
  }
  for (const child of node.children ?? []) markMentions(child, definitions);
}

function definitionsIn(
  node: MarkdownNode,
  found: Map<string, MarkdownNode> = new Map(),
): Map<string, MarkdownNode> {
  if (node.type === "definition" && node.identifier !== undefined && node.url !== undefined) {
    if (!found.has(node.identifier)) found.set(node.identifier, node);
  }
  for (const child of node.children ?? []) definitionsIn(child, found);
  return found;
}

function markPictures(node: MarkdownNode, definitions: ReadonlyMap<string, MarkdownNode>): void {
  const source =
    node.type === "image"
      ? node
      : node.type === "imageReference" && node.identifier !== undefined
        ? definitions.get(node.identifier)
        : undefined;
  if (node.type === "image" || node.type === "imageReference") {
    node.data = {
      hName: PICTURE_ELEMENT.TAG,
      hProperties: {
        [PICTURE_ELEMENT.ADDRESS]: source?.url ?? "",
        [PICTURE_ELEMENT.WORDS]: node.alt ?? "",
        [PICTURE_ELEMENT.CAPTION]: source?.title ?? "",
      },
    };
    return;
  }
  for (const child of node.children ?? []) markPictures(child, definitions);
}

function glueMentions(node: MarkdownNode): void {
  if (node.children === undefined) return;
  for (const child of node.children) glueMentions(child);
  node.children = gluedRun<MarkdownNode>(node.children, {
    held: (child) => child.data?.hName === MENTION_ELEMENT.TAG,
    text: (value) => ({ type: "text", value }),
    box: (inside) => ({ type: LINK_GLUE.TAG, data: { hName: LINK_GLUE.TAG }, children: inside }),
  });
}

function blank(node: MarkdownNode): boolean {
  return node.type === "break" || (node.type === "text" && (node.value ?? "").trim() === "");
}

function isPicture(node: MarkdownNode): boolean {
  return node.type === "image" || node.type === "imageReference";
}

function markPictureRows(node: MarkdownNode): void {
  const said = (node.children ?? []).filter((child) => !blank(child));
  if (node.type === "paragraph" && said.length > 0 && said.every(isPicture)) {
    node.data = { hName: PICTURE_ROW_ELEMENT.TAG };
    node.children = said;
    return;
  }
  for (const child of node.children ?? []) markPictureRows(child);
}

function markLoneLinks(tree: MarkdownNode, definitions: ReadonlyMap<string, MarkdownNode>): void {
  for (const paragraph of tree.children ?? []) {
    const said = (paragraph.children ?? []).filter((child) => !blank(child));
    const [link] = said;
    if (paragraph.type !== "paragraph" || said.length !== 1 || link === undefined) continue;
    const target =
      link.type === "link"
        ? link.url
        : link.type === "linkReference" && link.identifier !== undefined
          ? definitions.get(link.identifier)?.url
          : undefined;
    if (target === undefined) continue;
    paragraph.data = {
      hName: LONE_LINK_ELEMENT.TAG,
      hProperties: { [LONE_LINK_ELEMENT.TARGET]: target, [LONE_LINK_ELEMENT.WORDS]: wordsOf(link) },
    };
  }
}

const KEY_NODE = "taskKey";

const KEYLESS_NODES: ReadonlySet<string> = new Set([
  "code",
  "inlineCode",
  "link",
  "linkReference",
  "definition",
  "image",
  "imageReference",
  "html",
  KEY_NODE,
]);

function keyedRun(text: MarkdownNode, targets: ReadonlyMap<string, string>): MarkdownNode[] {
  const value = text.value ?? "";
  const spans = keySpansIn(value, targets);
  if (spans.length === 0) return [text];
  const run: MarkdownNode[] = [];
  let from = 0;
  for (const span of spans) {
    if (span.start > from) run.push({ type: "text", value: value.slice(from, span.start) });
    run.push({
      type: KEY_NODE,
      data: { hName: MENTION_ELEMENT.TAG, hProperties: { [MENTION_ELEMENT.TARGET]: span.known } },
      children: [{ type: "text", value: span.key }],
    });
    from = span.end;
  }
  if (from < value.length) run.push({ type: "text", value: value.slice(from) });
  return run;
}

function markTaskKeys(node: MarkdownNode, targets: ReadonlyMap<string, string>): void {
  if (node.children === undefined || KEYLESS_NODES.has(node.type)) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text") return keyedRun(child, targets);
    markTaskKeys(child, targets);
    return [child];
  });
}

const keySerials = new WeakMap<ReadonlyMap<string, string>, number>();

let keySetsSeen = 0;

function keySerial(targets: ReadonlyMap<string, string>): number {
  const held = keySerials.get(targets);
  if (held !== undefined) return held;
  keySetsSeen += 1;
  keySerials.set(targets, keySetsSeen);
  return keySetsSeen;
}

function markTaskKeysStep(targets: ReadonlyMap<string, string>): (tree: MarkdownNode) => void {
  return (tree) => markTaskKeys(tree, targets);
}

function markLinks(tree: MarkdownNode): void {
  const definitions = definitionsIn(tree);
  markMentions(tree, definitions);
  markPictures(tree, definitions);
  glueMentions(tree);
}

function markDocument(tree: MarkdownNode): void {
  const definitions = definitionsIn(tree);
  markMentions(tree, definitions);
  markPictures(tree, definitions);
  markPictureRows(tree);
  markLoneLinks(tree, definitions);
  glueMentions(tree);
}

const UNNAMED_PICTURE = "Picture";

function PictureElement({ node }: MarkdownNodeProps): ReactNode {
  const descriptionPicture = useDescriptionPictureDrawer();
  const inboxPicture = useInboxPictureDrawer();
  const address = String(node?.properties[PICTURE_ELEMENT.ADDRESS] ?? "");
  const said = String(node?.properties[PICTURE_ELEMENT.WORDS] ?? "");
  const caption = String(node?.properties[PICTURE_ELEMENT.CAPTION] ?? "");
  if (descriptionPicture !== undefined && descriptionAttachmentOf(address) !== undefined) {
    return descriptionPicture(address, said, caption === "" ? undefined : caption);
  }
  const itemPicture = inboxPicture?.(address, said, caption === "" ? undefined : caption);
  if (itemPicture !== undefined) return itemPicture;
  const words = said === "" ? UNNAMED_PICTURE : said;
  return (
    <TranscriptLink href={address === "" ? undefined : address} words={words}>
      <ImageIcon className={OUTSIDE_GLYPH_CLASS} aria-hidden="true" />
      {words}
    </TranscriptLink>
  );
}

function markLinksStep(): (tree: MarkdownNode) => void {
  return markLinks;
}

function markDocumentStep(): (tree: MarkdownNode) => void {
  return markDocument;
}

function remarkPluginsFor(
  typed: boolean,
  asDocument: boolean,
  keyTargets: ReadonlyMap<string, string>,
): MarkdownSteps {
  return [
    ...TRANSCRIPT_REMARK_STEPS,
    ...(typed ? [remarkBreaks] : []),
    ...(keyTargets.size === 0 ? [] : [markdownStep(markTaskKeysStep, keyTargets)]),
    asDocument ? markDocumentStep : markLinksStep,
  ];
}

function MentionElement({
  node,
  children,
}: MarkdownNodeProps & { children?: ReactNode }): ReactNode {
  const doors = useMentionDoors();
  const target = String(node?.properties[MENTION_ELEMENT.TARGET] ?? "");
  const words = node === undefined ? "" : wordsOf(node);
  const chip = node === undefined ? undefined : linkChip(target, words, doors);
  return (
    chip ?? (
      <TranscriptLink href={target} words={words}>
        {children}
      </TranscriptLink>
    )
  );
}

function LoneLinkElement({
  node,
  children,
}: MarkdownNodeProps & { children?: ReactNode }): ReactNode {
  const target = String(node?.properties[LONE_LINK_ELEMENT.TARGET] ?? "");
  const words = String(node?.properties[LONE_LINK_ELEMENT.WORDS] ?? "");
  return <LoneLinkCard target={target} words={words} fallback={<p>{children}</p>} />;
}

function PictureRowElement({ children }: MarkdownNodeProps & { children?: ReactNode }): ReactNode {
  return (
    <div
      className={`${PICTURE_ROW_ELEMENT.CLASS} my-block-gap grid grid-cols-picture-row items-start gap-block-gap`}
    >
      {children}
    </div>
  );
}

function LinkGlueElement({ children }: MarkdownNodeProps & { children?: ReactNode }): ReactNode {
  return <span className={LINK_GLUE.CLASS}>{children}</span>;
}

const TRANSCRIPT_COMPONENTS: MarkdownComponents = {
  ...PANEL_MARKDOWN_COMPONENTS,
  ...TRANSCRIPT_CODE_AND_TABLE_COMPONENTS,
  a: ({ href, children, node }) => (
    <TranscriptLink href={href} words={node === undefined ? "" : wordsOf(node)}>
      {children}
    </TranscriptLink>
  ),
  [MENTION_ELEMENT.TAG]: MentionElement,
  [PICTURE_ELEMENT.TAG]: PictureElement,
  [LINK_GLUE.TAG]: LinkGlueElement,
  [LONE_LINK_ELEMENT.TAG]: LoneLinkElement,
  [PICTURE_ROW_ELEMENT.TAG]: PictureRowElement,
  img: () => null,
};

export type GitHubPictureDrawer = (
  src: string,
  alt: string,
  linked: boolean,
) => ReactNode | undefined;

const InsideGitHubLink = createContext(false);

function GitHubImage({
  src,
  alt,
  picture,
}: {
  src: string;
  alt: string;
  picture: GitHubPictureDrawer;
}): ReactNode {
  const linked = useContext(InsideGitHubLink);
  return picture(src, alt, linked) ?? <GitHubPictureLink src={src} alt={alt} />;
}

export function GitHubPictureLink({ src, alt }: { src: string; alt: string }): ReactNode {
  const words = alt === "" ? UNNAMED_PICTURE : alt;
  return (
    <TranscriptLink href={src === "" ? undefined : src} words={words}>
      <ImageIcon className={OUTSIDE_GLYPH_CLASS} aria-hidden="true" />
      {words}
    </TranscriptLink>
  );
}

const GITHUB_REHYPE_PLUGINS: MarkdownSteps = [
  MARKDOWN_HTML_STEP.PARSE,
  githubShapes,
  MARKDOWN_HTML_STEP.SANITIZE,
  MARKDOWN_HTML_STEP.HARDEN,
];

const GITHUB_REMARK_PLUGINS = [wholeRendering];

export function GitHubWords({
  html,
  picture,
}: {
  html: string;
  picture: GitHubPictureDrawer;
}): ReactNode {
  const components = useMemo<MarkdownComponents>(
    () => ({
      ...TRANSCRIPT_COMPONENTS,
      a: ({ href, children, node }) => (
        <InsideGitHubLink.Provider value={true}>
          <TranscriptLink href={href} words={node === undefined ? "" : wordsOf(node)}>
            {children}
          </TranscriptLink>
        </InsideGitHubLink.Provider>
      ),
      img: ({ src, alt }) => (
        <GitHubImage src={String(src ?? "")} alt={String(alt ?? "")} picture={picture} />
      ),
    }),
    [picture],
  );
  return (
    <MessageResponse
      words={html}
      components={components}
      remarkPlugins={GITHUB_REMARK_PLUGINS}
      rehypePlugins={GITHUB_REHYPE_PLUGINS}
      normalizeHtmlIndentation={false}
    />
  );
}

export interface TranscriptElement {
  readonly markdown: string;
  readonly tag: string;
  readonly attributes: readonly string[];
  readonly components: MarkdownComponents;
}

function useElementDraw(element: TranscriptElement | undefined): {
  components: MarkdownComponents;
  allowedTags: Record<string, string[]>;
  literal: string[] | undefined;
} {
  const extra = element?.components;
  const tag = element?.tag;
  const attributes = element?.attributes.join(" ");
  return useMemo(
    () =>
      extra === undefined || tag === undefined || attributes === undefined
        ? { components: TRANSCRIPT_COMPONENTS, allowedTags: MENTION_TAGS, literal: undefined }
        : {
            components: { ...TRANSCRIPT_COMPONENTS, ...extra },
            allowedTags: { ...MENTION_TAGS, [tag]: attributes === "" ? [] : attributes.split(" ") },
            literal: [tag],
          },
    [extra, tag, attributes],
  );
}

export function TranscriptWords({
  text,
  element,
  typed = false,
  asDocument = false,
  streaming = false,
  line = false,
}: {
  text: string;
  element?: TranscriptElement | undefined;
  typed?: boolean | undefined;
  asDocument?: boolean | undefined;
  streaming?: boolean | undefined;
  line?: boolean | undefined;
}): ReactNode {
  const keyTargets = useWordTargets();
  const remarkPlugins = useMemo(
    () => remarkPluginsFor(typed, asDocument, keyTargets),
    [typed, asDocument, keyTargets],
  );
  const { components, allowedTags, literal } = useElementDraw(element);
  return (
    <TranscriptMarkdownSource markdown={text}>
      <MessageResponse
        key={keySerial(keyTargets)}
        words={element === undefined ? text : element.markdown}
        streaming={streaming}
        line={line}
        components={components}
        remarkPlugins={remarkPlugins}
        allowedTags={allowedTags}
        literalTagContent={literal}
      />
    </TranscriptMarkdownSource>
  );
}

const LEADING_BLANK_LINES = /^(?:[^\S\n]*\n)+/u;

const REASONING_PREVIEW_LENGTH = 400;

export function TranscriptReasoning({
  text,
  cut,
}: {
  text: string;
  cut?: CutBody | undefined;
}): ReactNode {
  const shown = cut === undefined ? text : cut.head;
  return (
    <Reasoning>
      <ReasoningTrigger preview={cardTitle(shown).slice(0, REASONING_PREVIEW_LENGTH)} />
      {cut === undefined ? (
        <ReasoningContent text={text.replace(LEADING_BLANK_LINES, "").trimEnd()} />
      ) : (
        <FoldBody className={REASONING_BODY_CLASS}>
          <CutWords cut={cut} waiting={CUT_WORDS.THOUGHT}>
            <p className={REASONING_WORDS_CLASS}>{cutText(cut)}</p>
          </CutWords>
        </FoldBody>
      )}
    </Reasoning>
  );
}

const CUT_WORDS = {
  THOUGHT: "Reading the whole thought…",
  OUTPUT: "Reading the whole output…",
} as const;

function cutText(cut: CutBody): string {
  return `${cut.head}\n\n… ${formatBytes(cut.bytes)} in all; only its start and end could be read …\n\n${cut.tail}`;
}

function CutWords({
  cut,
  waiting,
  children,
}: {
  cut: CutBody;
  waiting: string;
  children: ReactNode;
}): ReactNode {
  const { open } = useDisclosureState();
  const { onOpen } = cut;
  useEffect(() => {
    if (open) onOpen();
  }, [open, onOpen]);
  if (cut.state === WHOLE_PART.FAILED) return children;
  return (
    <p data-part-reading="">
      <Shimmer>{waiting}</Shimmer>
    </p>
  );
}

const CALL_ICON = {
  [CALL_KIND.COMMAND]: TerminalIcon,
  [CALL_KIND.MAC_COMMAND]: LaptopIcon,
  [CALL_KIND.BROWSER]: GlobeIcon,
  [CALL_KIND.READ_FILE]: FileTextIcon,
  [CALL_KIND.WRITE_FILE]: FilePenIcon,
  [CALL_KIND.EDIT]: FilePenIcon,
  [CALL_KIND.SEARCH]: SearchIcon,
  [CALL_KIND.WEB_SEARCH]: SearchIcon,
  [CALL_KIND.WEB_PAGE]: GlobeIcon,
  [CALL_KIND.LOAD_SKILL]: BookOpenIcon,
  [CALL_KIND.LOOK_AT_PICTURE]: ImageIcon,
  [CALL_KIND.EDIT_DESCRIPTION]: FilePenIcon,
  [CALL_KIND.TODOS]: () => <GLYPH.TODOS />,
  [CALL_KIND.INBOX_POST]: InboxIcon,
  [CALL_KIND.INBOX_CLOSE]: InboxIcon,
  [CALL_KIND.INBOX_READ]: InboxIcon,
  [CALL_KIND.INBOX_REPLY]: InboxIcon,
  [CALL_KIND.INBOX_WITHDRAW]: InboxIcon,
  [CALL_KIND.WORKER]: BotIcon,
  [CALL_KIND.WORKER_WAIT]: HourglassIcon,
  [CALL_KIND.WORKER_CANCEL]: CircleStopIcon,
  [CALL_KIND.WORKER_MESSAGE]: SendIcon,
  [CALL_KIND.STOP_BACKGROUND]: CircleStopIcon,
  [CALL_KIND.LIST_AGENTS]: LayoutListIcon,
  [CALL_KIND.READ_AGENT]: ScrollTextIcon,
  [CALL_KIND.MESSAGE_AGENT]: SendIcon,
  [CALL_KIND.START_AGENT]: PlayIcon,
  [CALL_KIND.ARCHIVE_AGENT]: ArchiveIcon,
  [CALL_KIND.UNARCHIVE_AGENT]: ArchiveRestoreIcon,
  [CALL_KIND.LIST_MODELS]: CpuIcon,
  [CALL_KIND.STOP_AGENT]: CircleStopIcon,
  [CALL_KIND.UPDATE_AGENT]: PencilLineIcon,
  [CALL_KIND.READ_TASK]: FileTextIcon,
  [CALL_KIND.CREATE_SECTION]: FolderPlusIcon,
  [CALL_KIND.DELETE_SECTION]: FolderMinusIcon,
  [CALL_KIND.LIST_AUTOMATIONS]: CalendarClockIcon,
  [CALL_KIND.CREATE_AUTOMATION]: CalendarPlusIcon,
  [CALL_KIND.UPDATE_AUTOMATION]: CalendarCogIcon,
  [CALL_KIND.DELETE_AUTOMATION]: CalendarXIcon,
  [CALL_KIND.RUN_AUTOMATION]: CalendarCheckIcon,
  [CALL_KIND.MOVE_TASK]: FolderInputIcon,
  [CALL_KIND.UPDATE_TASK]: FilePenIcon,
  [CALL_KIND.LIST_ISSUES]: () => <GLYPH.ISSUE />,
  [CALL_KIND.READ_ISSUE]: () => <GLYPH.ISSUE />,
  [CALL_KIND.CREATE_ISSUE]: CirclePlusIcon,
  [CALL_KIND.UPDATE_ISSUE]: FilePenIcon,
  [CALL_KIND.CREATE_TASK]: FilePlusIcon,
  [CALL_KIND.SHOW_PAGE]: AppWindowIcon,
  [CALL_KIND.READ_PAGE]: AppWindowIcon,
  [CALL_KIND.SHOW_IMAGE]: ImageIcon,
  [CALL_KIND.OPEN_PULL_REQUEST]: () => <GLYPH.PULL_REQUEST />,
  [CALL_KIND.SLEEP]: TimerIcon,
  [CALL_KIND.LIST_TASKS]: () => <GLYPH.TASK />,
  [CALL_KIND.REMEMBER]: () => <GLYPH.MEMORY />,
  [CALL_KIND.RECALL]: () => <GLYPH.MEMORY />,
  [CALL_KIND.READ_COMMENTS]: () => <GLYPH.COMMENT />,
  [CALL_KIND.REPLY_TO_COMMENT]: () => <GLYPH.COMMENT />,
  [CALL_KIND.RESOLVE_THREAD]: () => <GLYPH.SETTLED />,
  [CALL_KIND.REOPEN_THREAD]: () => <GLYPH.COMMENT />,
  [CALL_KIND.SEARCH_TOOLS]: () => <GLYPH.MCP_SERVER />,
  [CALL_KIND.MCP_TOOL]: () => <GLYPH.MCP_SERVER />,
  [CALL_KIND.OTHER]: WrenchIcon,
} as const satisfies Record<CallKind, ComponentType<{ "aria-hidden"?: "true" }>>;

function AgentCallChip({
  agent,
  opens,
  card,
}: {
  agent: Actor;
  opens?: AgentOpening | undefined;
  card?: ReactNode;
}): ReactNode {
  if (opens === undefined) {
    return (
      <InlineRef
        look={INLINE_REF_LOOK.PILL}
        glyph={<ActorMark actor={agent} size={ACTOR_SIZE.INLINE} />}
        label={actorName(agent)}
        hint={card === undefined ? false : undefined}
        card={card}
        data-tool-agent-ref=""
      />
    );
  }
  const press = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    opens.onOpen();
  };
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={<ActorMark actor={agent} size={ACTOR_SIZE.INLINE} />}
      label={actorName(agent)}
      onPress={press}
      hintLabel={opens.hint}
      card={opens.card}
      data-tool-agent-ref=""
    />
  );
}

interface AgentOpening {
  readonly hint: string;
  readonly card: ReactNode;
  readonly onOpen: () => void;
}

interface ChippedLine {
  readonly line: CallLine;
  readonly chip: ReactNode | undefined;
}

function chippedLine(
  kind: CallKind,
  subject: string | undefined,
  description: string | undefined,
  agent: Actor | undefined,
  opens?: AgentOpening,
  card?: ReactNode,
): ChippedLine {
  if (agent === undefined || !isAgentCallKind(kind)) {
    return { line: callLine(kind, subject, description), chip: undefined };
  }
  return {
    line: agentCallLine(kind, subject),
    chip: <AgentCallChip agent={agent} opens={opens} card={card} />,
  };
}

const FILE_CALLS: ReadonlySet<CallKind> = new Set([
  CALL_KIND.READ_FILE,
  CALL_KIND.WRITE_FILE,
  CALL_KIND.EDIT,
]);

function calledChip(
  kind: CallKind,
  files: readonly string[] | undefined,
  page: string | undefined,
  doors: MentionDoors,
): ReactNode | undefined {
  if (kind === CALL_KIND.WEB_PAGE) {
    return page === undefined || siteName(page) === undefined ? undefined : (
      <SiteChip href={page} />
    );
  }
  const first = FILE_CALLS.has(kind) ? files?.[0] : undefined;
  const repository = doors.place.repository;
  if (first === undefined || repository === null) return undefined;
  const target = encodeMention({ kind: MENTION_KIND.FILE, path: first }, doors.place);
  if (decodeMention(target, repository)?.kind !== MENTION_KIND.FILE) return undefined;
  return linkChip(target, target, doors);
}

function moreFiles(files: readonly string[] | undefined): string | undefined {
  return files === undefined || files.length < 2 ? undefined : `+${files.length - 1}`;
}

const MacOwnerContext = createContext<Actor | undefined>(undefined);

export const MacOwnerProvider = MacOwnerContext.Provider;

export type TranscriptToolProps = Omit<ComponentProps<typeof Tool>, "children"> &
  Pick<ToolHeaderProps, "state" | "subject"> & {
    kind: CallKind;
    provider?: IntegrationProvider | undefined;
    server?: string | undefined;
    description?: string | undefined;
    agent?: Actor | undefined;
    agentCard?: ReactNode;
    made?: { readonly kind: MadeCallKind; readonly chip: ReactNode } | undefined;
    files?: readonly string[] | undefined;
    page?: string | undefined;
    input: ToolBlock;
    output: ToolBlock | undefined;
    errorText: string | undefined;
    cut?: CutBody | undefined;
  };

export function TranscriptTool({
  state,
  kind,
  provider,
  server,
  subject,
  description,
  agent,
  agentCard,
  made,
  files,
  page,
  input,
  output,
  errorText,
  cut,
  ...props
}: TranscriptToolProps): ReactNode {
  const Icon = CALL_ICON[kind];
  const called = calledChip(kind, files, page, useMentionDoors());
  const { line, chip } =
    made !== undefined
      ? { line: madeCallLine(made.kind), chip: made.chip }
      : called === undefined
        ? chippedLine(kind, subject, description, agent, undefined, agentCard)
        : { line: { ...callLine(kind, moreFiles(files), undefined), code: false }, chip: called };
  const command = isCommandKind(kind);
  const macOwner = useContext(MacOwnerContext);
  return (
    <Tool {...props}>
      <ToolHeader
        state={state}
        icon={
          provider === undefined ? (
            <Icon aria-hidden="true" />
          ) : (
            <ProviderMark provider={provider} />
          )
        }
        label={line.verb}
        subject={line.subject}
        chip={chip}
        subjectIsCode={line.code}
        subjectInBody={(command && input.kind === TOOL_BLOCK.COMMAND) || blockSays(input, subject)}
        place={
          kind === CALL_KIND.MAC_COMMAND && macOwner !== undefined ? (
            <ActorLine>
              {"On "}
              <ActorRef actor={macOwner} sentence possessive />
              {" Mac"}
            </ActorLine>
          ) : (
            callPlace(kind, server)
          )
        }
      />
      <ToolContent bare>
        {input.kind === TOOL_BLOCK.COMMAND ? (
          cut === undefined ? (
            <ToolTerminal input={input} block={output} errorText={errorText} />
          ) : (
            <CutWords cut={cut} waiting={CUT_WORDS.OUTPUT}>
              <ToolTerminal
                input={input}
                block={{ kind: TOOL_BLOCK.TEXT, text: cutText(cut) }}
                errorText={undefined}
              />
            </CutWords>
          )
        ) : (
          <>
            <ToolInput block={input} />
            {cut === undefined ? (
              <ToolOutput block={output} errorText={errorText} />
            ) : (
              <CutWords cut={cut} waiting={CUT_WORDS.OUTPUT}>
                <ToolOutput
                  block={{ kind: TOOL_BLOCK.TEXT, text: cutText(cut) }}
                  errorText={undefined}
                />
              </CutWords>
            )}
          </>
        )}
      </ToolContent>
    </Tool>
  );
}

export function TranscriptOpeningCall({
  callId,
  kind,
  subject,
  agent,
  state,
  hint,
  card,
  sent,
  onOpen,
}: {
  callId: string;
  kind: CallKind;
  subject: string | undefined;
  agent?: Actor | undefined;
  state: ToolState;
  hint: string;
  card?: ReactNode;
  sent?: SentWords | undefined;
  onOpen: () => void;
}): ReactNode {
  const Icon = CALL_ICON[kind];
  if (sent !== undefined) {
    return (
      <SentCall
        callId={callId}
        kind={kind}
        subject={subject}
        agent={agent}
        state={state}
        sent={sent}
        opens={{ hint, card, onOpen }}
      />
    );
  }
  const { line, chip } = chippedLine(kind, subject, undefined, agent);
  return (
    <Tooltip label={hint} card={card ?? undefined}>
      <LineButton data-call-id={callId} data-opens="" onClick={onOpen}>
        <ToolLine
          state={state}
          icon={<Icon aria-hidden="true" />}
          label={line.verb}
          subject={line.subject}
          chip={chip}
          subjectIsCode={line.code}
        />
      </LineButton>
    </Tooltip>
  );
}

const SENT_WORDS = {
  NOTE: "Note",
} as const;

const UNNAMED_AGENT: Actor = {
  kind: ACTOR_KIND.AGENT,
  name: TAB_WORDS.AGENT,
  provider: undefined,
  state: ACTOR_STATE.REST,
};

function SentCall({
  callId,
  kind,
  subject,
  agent,
  state,
  sent,
  opens,
}: {
  callId: string;
  kind: CallKind;
  subject: string | undefined;
  agent: Actor | undefined;
  state: ToolState;
  sent: SentWords;
  opens: AgentOpening;
}): ReactNode {
  const Icon = CALL_ICON[kind];
  const { line, chip } = chippedLine(kind, subject, undefined, agent ?? UNNAMED_AGENT, opens);
  return (
    <Tool data-call-id={callId}>
      <ToolHeader
        state={state}
        icon={<Icon aria-hidden="true" />}
        label={line.verb}
        subject={line.subject}
        chip={chip}
        subjectIsCode={line.code}
        subjectInBody
      />
      <ToolContent name="tool-sent-words" bare>
        {sent.words === undefined ? null : (
          <blockquote className={QUOTE_CLASS}>
            <TranscriptWords text={sent.words} />
          </blockquote>
        )}
        {sent.note === undefined ? null : (
          <blockquote className={QUOTE_CLASS}>
            <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {SENT_WORDS.NOTE}
            </Text>
            <TranscriptWords text={sent.note} />
          </blockquote>
        )}
      </ToolContent>
    </Tool>
  );
}

const TODO_LOOK = {
  [AGENT_TODO_STATUS.PENDING]: { Icon: CircleIcon, label: "Pending" },
  [AGENT_TODO_STATUS.IN_PROGRESS]: { Icon: CircleDotDashedIcon, label: "In progress" },
  [AGENT_TODO_STATUS.DONE]: { Icon: CircleCheckIcon, label: "Done" },
} as const satisfies Record<AgentTodoStatus, { Icon: LucideIcon; label: string }>;

export type TranscriptTodosProps = Omit<ComponentProps<typeof Tool>, "children"> &
  Pick<ToolHeaderProps, "state" | "subject"> & {
    todos: AgentTodos["todos"];
    errorText: string | undefined;
    live: boolean;
  };

function TodoItems({
  todos,
  live,
  docked = false,
}: {
  todos: AgentTodos["todos"];
  live: boolean;
  docked?: boolean;
}): ReactNode {
  return (
    <Stack
      as={LAYOUT_ELEMENT.UL}
      gap={GAP.TIGHT}
      className={`todo-items leading-body${docked ? " max-h-todos-dock overflow-y-auto overscroll-contain" : ""}`}
    >
      {todos.map((todo, index) => (
        <TodoItem key={index} todo={todo} live={live} />
      ))}
    </Stack>
  );
}

function TodoItem({ todo, live }: { todo: AgentTodos["todos"][number]; live: boolean }): ReactNode {
  const [first] = useState(todo.status);
  const look = TODO_LOOK[todo.status];
  const working = live && todo.status === AGENT_TODO_STATUS.IN_PROGRESS;
  const arrived = todo.status !== first;
  const done = todo.status === AGENT_TODO_STATUS.DONE;
  return (
    <li className="todo-item flex items-start gap-icon-gap" data-todo-status={todo.status}>
      <GlyphSlot
        key={todo.status}
        line
        ink={todo.status === AGENT_TODO_STATUS.IN_PROGRESS ? GLYPH_INK.TEXT : GLYPH_INK.MUTED}
        label={look.label}
        arrival={arrived ? (done ? GLYPH_ARRIVAL.CHECK : GLYPH_ARRIVAL.STEP) : undefined}
      >
        {working ? (
          <StateGlyph state={GLYPH_STATE.WORKING} />
        ) : (
          <StateGlyph state={GLYPH_STATE.REST} glyph={<look.Icon aria-hidden="true" />} />
        )}
      </GlyphSlot>
      <span
        className={`min-w-0 wrap-anywhere transition-[color] duration-(--ui-duration-quick) ease-motion-exit${done ? " text-muted-foreground" : ""}`}
      >
        {todo.content}
      </span>
    </li>
  );
}

export function TranscriptTodos({
  state,
  subject,
  todos,
  errorText,
  live,
  ...props
}: TranscriptTodosProps): ReactNode {
  const words = CALL_WORDS[CALL_KIND.TODOS];
  return (
    <Tool data-todos="" {...props}>
      <ToolHeader
        state={state}
        icon={<GLYPH.TODOS />}
        label={words.verb}
        subject={subject}
        subjectIsCode={words.code}
      />
      <FoldBody className="mt-list-gap mr-0 mb-tight-gap ml-transcript-gutter select-text">
        <TodoItems todos={todos} live={live} />
        {errorText === undefined ? null : (
          <FailureNote failure={UNREPORTED.TOOL} time={FAILURE_NOTE_TIME.PAST}>
            {errorText}
          </FailureNote>
        )}
      </FoldBody>
    </Tool>
  );
}

export function TranscriptTodosDock({
  todos,
  focus,
}: {
  todos: AgentTodos["todos"];
  focus: string | undefined;
}): ReactNode {
  const { done, total } = todosCount(todos);
  return (
    <Disclosure look={DISCLOSURE_LOOK.DOCK} data-todos-dock="" aria-label="To-dos">
      <DisclosureSummary look={DISCLOSURE_SUMMARY.HEAD}>
        <DisclosureChevron />
        <GlyphSlot>
          <GLYPH.TODOS />
        </GlyphSlot>
        <span className="shrink-0 text-muted-foreground">
          <RollingNumber value={done} /> of <RollingNumber value={total} /> done
        </span>
        <TodosDockFocus focus={focus} />
      </DisclosureSummary>
      <DisclosureBody inset={DISCLOSURE_BODY.CARD}>
        <TodoItems todos={todos} live docked />
      </DisclosureBody>
    </Disclosure>
  );
}

function TodosDockFocus({ focus }: { focus: string | undefined }): ReactNode {
  const previewed = useDisclosurePreviewShown(focus !== undefined);
  if (focus === undefined || !previewed) return null;
  return (
    <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} truncate className="flex-1">
      {focus}
    </Text>
  );
}

interface SubagentPair {
  readonly choice: ModelChoice;
  readonly models: readonly CatalogModel[];
}

export type TranscriptSubagentProps = {
  callId: string;
  job: string;
  pair: SubagentPair | undefined;
  state: ToolState;
  startedAt?: number | undefined;
  errorText: string | undefined;
  onOpen: (() => void) | undefined;
  card?: ReactNode;
  body?: { readonly input: ToolBlock; readonly output: ToolBlock | undefined } | undefined;
};

const SUBAGENT_HINT = "Open the subagent";

export function TranscriptSubagent({
  callId,
  job,
  pair,
  state,
  startedAt,
  errorText,
  onOpen,
  card,
  body,
}: TranscriptSubagentProps): ReactNode {
  const running = state === TOOL_STATE.INPUT_STREAMING || state === TOOL_STATE.INPUT_AVAILABLE;
  const line = (
    <>
      <GlyphSlot>
        <SubagentMark model={pair?.choice.model} />
      </GlyphSlot>
      <OneLine className="subagent-job flex-1 text-foreground">{job}</OneLine>
      {pair === undefined ? null : (
        <span className="subagent-pair shrink-0" data-subagent-pair="">
          <ModelLabel choice={pair.choice} models={pair.models} />
        </span>
      )}
      {running && startedAt !== undefined ? (
        <WorkingTime startedAt={startedAt} className="shrink-0" />
      ) : null}
      <ToolStateMark state={state} />
    </>
  );
  const row =
    onOpen === undefined && body !== undefined ? (
      <Tool>
        <ToolSummary data-subagent-row="" data-call-id={callId}>
          {line}
        </ToolSummary>
        <ToolContent bare>
          <ToolInput block={body.input} />
          <ToolOutput block={body.output} errorText={undefined} />
        </ToolContent>
      </Tool>
    ) : onOpen === undefined ? (
      <LineRow data-subagent-row="" data-call-id={callId}>
        {line}
      </LineRow>
    ) : (
      <Tooltip label={SUBAGENT_HINT} card={card ?? undefined}>
        <LineButton data-subagent-row="" data-call-id={callId} onClick={onOpen}>
          {line}
        </LineButton>
      </Tooltip>
    );
  return (
    <div className="subagent-row @container/subagent-row text-caption-inline">
      {row}
      {errorText === undefined ? null : (
        <FailureNote failure={UNREPORTED.TOOL} time={FAILURE_NOTE_TIME.PAST}>
          {errorText}
        </FailureNote>
      )}
    </div>
  );
}

function TurnFold({
  summary,
  running,
  open = false,
  children,
}: {
  summary: string;
  running: boolean;
  open?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <Disclosure defaultOpen={open} data-turn-fold="">
      <DisclosureSummary>
        {running ? <Shimmer>{summary}</Shimmer> : <span>{summary}</span>}
      </DisclosureSummary>
      <DisclosureBody>{children}</DisclosureBody>
    </Disclosure>
  );
}

function TurnRowView<B>({
  row,
  children,
}: {
  row: TurnRow<B>;
  children: (block: B) => ReactNode;
}): ReactNode {
  switch (row.kind) {
    case TURN_ROW.BLOCK:
      return children(row.block);
    case TURN_ROW.GROUP:
      return (
        <TurnFold summary={row.summary} running={row.running} open={row.open}>
          {row.blocks.map((block, index) => (
            <Fragment key={index}>{children(block)}</Fragment>
          ))}
        </TurnFold>
      );
    case TURN_ROW.FOLDED:
      return (
        <TurnFold summary={row.summary} running={false}>
          <TranscriptRows rows={row.rows}>{children}</TranscriptRows>
        </TurnFold>
      );
  }
}

const SteadyTurnRow = memo(TurnRowView, (a, b) =>
  sameFieldsBy(a, b, { row: sameTurnRow }),
) as typeof TurnRowView;

export function TranscriptRows<B>({
  rows,
  children,
}: {
  rows: readonly TurnRow<B>[];
  children: (block: B) => ReactNode;
}): ReactNode {
  return rows.map((row) => (
    <SteadyTurnRow
      key={row.kind === TURN_ROW.GROUP ? `${row.key}-${String(row.open)}` : row.key}
      row={row}
    >
      {children}
    </SteadyTurnRow>
  ));
}

export function TranscriptNote({ children }: { children: ReactNode }): ReactNode {
  return <NoteLine look={NOTE_LINE_LOOK.INSET}>{children}</NoteLine>;
}
