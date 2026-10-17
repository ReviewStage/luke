import {
  CODING_AGENT_TODO_STATUS,
  type CodingAgentTodoStatus,
  type CodingAgentTodos,
} from "@luke/features/coding-agent-wire";
import type { IntegrationProvider } from "@luke/features/integration-wire";
import { readLink } from "@luke/features/luke-link";
import { mayNameMention } from "@luke/features/mention-link";
import type { CatalogModel, ModelChoice } from "@luke/features/models-wire";
import { planAttachmentOf } from "@luke/features/plan-attachment-link";
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
  TURN_ROW,
  type TurnRow,
} from "@luke/features/turn-rows";
import { cn, ProviderMark } from "@luke/ui";
import { type Actor, actorName } from "@luke/ui/actor-model";
import { githubShapes, wholeRendering } from "@luke/ui/github-html";
import { gluedRun, LINK_GLUE } from "@luke/ui/link-glue";
import { useClipped } from "@luke/ui/use-clipped";
import {
  AppWindowIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  BookOpenIcon,
  BotIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  CircleStopIcon,
  CodeXmlIcon,
  CpuIcon,
  EyeIcon,
  FilePenIcon,
  FileTextIcon,
  GlobeIcon,
  HourglassIcon,
  ImageIcon,
  InboxIcon,
  LaptopIcon,
  LayoutListIcon,
  ListTodoIcon,
  type LucideIcon,
  MessageCircleQuestionIcon,
  MessageCircleXIcon,
  PencilLineIcon,
  PhoneOffIcon,
  PlayIcon,
  ScrollTextIcon,
  SearchIcon,
  SendIcon,
  TerminalIcon,
  TimerIcon,
  WrenchIcon,
} from "lucide-react";
import {
  type ComponentProps,
  createContext,
  Fragment,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import {
  type Components,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  type ExtraProps,
} from "streamdown";
import { ACTOR_SIZE, ActorLine, ActorMark, ActorRef } from "../actor-ref";
import { Fold, FoldBody, FoldChevron, FoldSummary } from "../ai-elements/fold";
import { MessageResponse, PANEL_MARKDOWN_COMPONENTS } from "../ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "../ai-elements/reasoning";
import { Shimmer } from "../ai-elements/shimmer";
import {
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
} from "../ai-elements/tool";
import { GLYPH_STATE, StateGlyph } from "../state-glyph";
import { TextLink } from "../text-link";
import { Tooltip } from "../tooltip";
import { linkChip } from "./mention-chip";
import { ModelLabel } from "./model-label";
import { useMentionDoors } from "./plan-mentions";
import { usePlanPictureDrawer } from "./plan-pictures";
import { SubagentMark } from "./tab-look";
import { cardTitle } from "./tool-call-model";
import {
  TRANSCRIPT_CODE_AND_TABLE_COMPONENTS,
  TranscriptMarkdownSource,
} from "./transcript-markdown";
import { opensAsLink, useOpenLink } from "./use-open-link";
import { WorkingTime } from "./working-time";

/**
 * transcript-blocks.tsx -- the one way a transcript's blocks are drawn, on the Call tab and a coding agent's tab alike.
 *
 * Each tab decides what its rows say from its own wire
 * (`transcript-model.ts`, `work-model.ts`, `coding-agent-model.ts` with
 * `tool-call-model.ts`); how a block of each kind looks is decided here
 * once, over the AI Elements components (`../ai-elements/`): words as
 * markdown at the panel's scale with a web link opening in the browser, reasoning folded under one quiet line
 * previewing its words, a tool call as one collapsible row wearing its kind's icon and verb
 * (`turn-rows.ts`) that opens onto its input and its answer, a run of
 * calls folded under one line saying how many, a finished turn's lead
 * folded under what it holds, a subagent's row as one line like a call's
 * that opens its tab, a call about something drawn in a tab of its own as
 * its line that opens that tab, an agent's to-do list as a call's row that opens onto
 * the list, and a note between the rows. A
 * tab that drew one of these its own way would be a second transcript
 * style, which is what this file is here to refuse.
 */

/**
 * A link in a transcript's words. A web page, such as the pull request an
 * agent opened or the docs it read, is a plain link (`../text-link.tsx`)
 * that opens in the browser over the act channel (`use-open-link.ts`); any
 * other address is drawn as words that go nowhere, with the address as its
 * hint. `words` are its label's, which say whether it is its own address.
 * Note that the press is ours rather than Streamdown's, because Streamdown's
 * link asks in a modal of its own and then calls `window.open`, which the
 * window denies (`hardened-window.ts`), so its link opened nothing.
 */
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
      <span className="text-link-inert" title={href}>
        {children}
      </span>
    );
  }
  return (
    <TextLink href={href} words={words} onOpen={openLink}>
      {children}
    </TextLink>
  );
}

/** The element a mention's link is drawn as, and the one attribute that carries its target to the chip. */
const MENTION_ELEMENT = {
  TAG: "luke-mention",
  TARGET: "to",
} as const;

/** The element a picture's Markdown is drawn as, and the attributes that carry its address, its words, and its caption. */
const PICTURE_ELEMENT = {
  TAG: "luke-picture",
  ADDRESS: "to",
  WORDS: "words",
  CAPTION: "caption",
} as const;

/** The mention's element and the picture's, let through the drawing's sanitizer with what each carries. */
const MENTION_TAGS = {
  [MENTION_ELEMENT.TAG]: [MENTION_ELEMENT.TARGET],
  [PICTURE_ELEMENT.TAG]: [PICTURE_ELEMENT.ADDRESS, PICTURE_ELEMENT.WORDS, PICTURE_ELEMENT.CAPTION],
  [LINK_GLUE.TAG]: [],
};

/** A node of the words, as markdown reads them or as they are drawn, as much of one as its words are told by. */
interface WordsNode {
  readonly type: string;
  readonly value?: string;
  readonly children?: readonly WordsNode[];
}

/** A node of the words as markdown reads them, which a mention's link is marked on: a link's target, or the label a reference link and its definition share. */
interface MarkdownNode extends WordsNode {
  readonly url?: string;
  readonly alt?: string | null;
  readonly title?: string | null;
  readonly identifier?: string;
  children?: readonly MarkdownNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
}

/** The words under a node, however they are formatted. */
function wordsOf(node: WordsNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map((child) => wordsOf(child)).join("");
}

/**
 * Marks every link in the words whose target may name a mention, or is a
 * Luke link to any place (`readLink`), to be drawn as its own element,
 * which reads what it names against the plan its page is of (`linkChip`):
 * the same rule for a developer's `@`
 * mention, an agent's link, a reference link, and a bare address. A target
 * is read here before the page's repository is known (`mayNameMention`),
 * so every page of GitHub's is marked, and every other link is drawn as
 * the library draws it. Note that the mark is made on the markdown, before
 * it is drawn, because the drawing's sanitizer keeps no address on a link
 * but the web's, so a mention's target would never reach a link of ours.
 * Code holds no link, so a mention in code stays code.
 */
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

/** Each link definition in the words, its address and its title, by the label a reference names it with, the first standing where one is defined twice, as markdown reads them. */
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

/**
 * Marks every picture in the words to be drawn as its own element, which
 * names it as a link to where it points and never fetches it, because a
 * picture an agent writes is a request to wherever its address points the
 * moment the tab opens, and a model's words must make none; the pictures an
 * agent shows are its `show_image` calls'. The one picture drawn is a plan's
 * own, inside the plan's card, which is read through the host
 * (`plan-pictures.tsx`) rather than from its address. Note that the mark is
 * made on the markdown, before the drawing's hardening reads a picture at
 * all, which draws a relative one as a placeholder of its own and an
 * absolute one as nothing.
 */
function markPictures(node: MarkdownNode, definitions: ReadonlyMap<string, MarkdownNode>): void {
  // A reference's address and caption are its definition's.
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

/** Holds each link marked as a mention with the punctuation written against it (`link-glue.ts`), under a node and every node below it. */
function glueMentions(node: MarkdownNode): void {
  if (node.children === undefined) return;
  for (const child of node.children) glueMentions(child);
  node.children = gluedRun<MarkdownNode>(node.children, {
    held: (child) => child.data?.hName === MENTION_ELEMENT.TAG,
    text: (value) => ({ type: "text", value }),
    box: (inside) => ({ type: LINK_GLUE.TAG, data: { hName: LINK_GLUE.TAG }, children: inside }),
  });
}

/** The step that marks a transcript's links and its pictures, a reference's read through its definition, and holds each mention with its punctuation. */
function markLinks(tree: MarkdownNode): void {
  const definitions = definitionsIn(tree);
  markMentions(tree, definitions);
  markPictures(tree, definitions);
  glueMentions(tree);
}

/** What a picture with no words of its own is called where it is named. */
const UNNAMED_PICTURE = "Picture";

/**
 * A picture in a transcript's words: a plan's own picture drawn as the plan
 * draws it where its words stand inside `PlanPictures`, as the plan's card
 * does; any other a link to where it points, with the picture's glyph,
 * never drawn.
 */
function PictureElement({ node }: ExtraProps): ReactNode {
  const planPicture = usePlanPictureDrawer();
  const address = String(node?.properties[PICTURE_ELEMENT.ADDRESS] ?? "");
  const said = String(node?.properties[PICTURE_ELEMENT.WORDS] ?? "");
  const caption = String(node?.properties[PICTURE_ELEMENT.CAPTION] ?? "");
  if (planPicture !== undefined && planAttachmentOf(address) !== undefined) {
    return planPicture(address, said, caption === "" ? undefined : caption);
  }
  const words = said === "" ? UNNAMED_PICTURE : said;
  return (
    <TranscriptLink href={address === "" ? undefined : address} words={words}>
      <ImageIcon className="picture-outside-glyph" aria-hidden="true" />
      {words}
    </TranscriptLink>
  );
}

/** The markdown steps a transcript is read with: the library's own, then the mark on its links. */
const TRANSCRIPT_REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), () => markLinks];

/**
 * A link in a transcript's words: the chip that opens what it names
 * (`mention-chip.tsx`) where its target names a mention, read against the
 * task's page it is drawn on, or the window's doors off one; a link as any
 * other is where it names none.
 */
function MentionElement({ node, children }: ExtraProps & { children?: ReactNode }): ReactNode {
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

/** A mention held with the punctuation written against it, in the box no line breaks inside (`link-glue.ts`). */
function LinkGlueElement({ children }: ExtraProps & { children?: ReactNode }): ReactNode {
  return <span className={LINK_GLUE.CLASS}>{children}</span>;
}

/**
 * How a transcript's markdown is drawn: at the panel's scale, its code and
 * tables as `transcript-markdown.tsx` draws them, its links as
 * {@link TranscriptLink}, and its pictures as links to where they point
 * ({@link PictureElement}), never as an image, because an image is a
 * request to wherever its address points the moment the tab opens, and
 * nothing said on a call or written by a model should make one.
 */
const TRANSCRIPT_COMPONENTS: Components = {
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
  img: () => null,
};

/**
 * How a picture GitHub's rendering names is drawn by the place drawing the
 * words: its own image, read through the service, or nothing where the
 * place draws none, which draws its link instead.
 */
export type GitHubPictureDrawer = (src: string, alt: string) => ReactNode | undefined;

/** A picture GitHub's rendering names that its place draws none of: a link to where it points, as a transcript's picture is. */
export function GitHubPictureLink({ src, alt }: { src: string; alt: string }): ReactNode {
  const words = alt === "" ? UNNAMED_PICTURE : alt;
  return (
    <TranscriptLink href={src === "" ? undefined : src} words={words}>
      <ImageIcon className="picture-outside-glyph" aria-hidden="true" />
      {words}
    </TranscriptLink>
  );
}

/**
 * The steps GitHub's rendering is drawn through: the library's own HTML
 * parse, GitHub's dress reshaped into the window's own while its classes
 * still say what each part is (`@luke/ui/github-html`), then the library's
 * own sanitizer, GitHub's own allowlist, and its link hardening.
 */
const GITHUB_REHYPE_PLUGINS = [
  defaultRehypePlugins.raw,
  githubShapes,
  defaultRehypePlugins.sanitize,
  defaultRehypePlugins.harden,
].filter((plugin) => plugin !== undefined);

/** The one markdown step GitHub's rendering takes: handed over whole, as HTML. */
const GITHUB_REMARK_PLUGINS = [wholeRendering];

/**
 * Words GitHub rendered (`body_html`), drawn as a transcript's words are,
 * at the panel's scale, their code and tables the transcript's, their links
 * the transcript's: GitHub's own HTML read through the library's parse and
 * sanitizer, never set as HTML. Mentions, references, emoji, task lists,
 * and folded details stand as GitHub rendered them. A picture is the
 * place's to draw (`picture`), and stands as its link where it draws none.
 */
export function GitHubWords({
  html,
  picture,
}: {
  html: string;
  picture: GitHubPictureDrawer;
}): ReactNode {
  const components = useMemo<Components>(
    () => ({
      ...TRANSCRIPT_COMPONENTS,
      img: ({ src, alt }) => {
        const address = String(src ?? "");
        const words = String(alt ?? "");
        return picture(address, words) ?? <GitHubPictureLink src={address} alt={words} />;
      },
    }),
    [picture],
  );
  return (
    <MessageResponse
      mode="static"
      components={components}
      remarkPlugins={GITHUB_REMARK_PLUGINS}
      rehypePlugins={GITHUB_REHYPE_PLUGINS}
      normalizeHtmlIndentation={false}
    >
      {html}
    </MessageResponse>
  );
}

/**
 * An element of the transcript's own the words are drawn with, as a skill
 * named in a sent message is drawn as its chip (`skill-chip.tsx`): the words
 * with the element written in where it stands, its tag and the attributes it
 * carries, and what draws it. Its words are taken as they are, never as
 * markdown.
 */
export interface TranscriptElement {
  readonly markdown: string;
  readonly tag: string;
  readonly attributes: readonly string[];
  readonly components: Components;
}

/** A turn's words as markdown, with an element of the transcript's own written in where one is given. */
export function TranscriptWords({
  text,
  element,
}: {
  text: string;
  element?: TranscriptElement | undefined;
}): ReactNode {
  if (element === undefined) {
    return (
      <TranscriptMarkdownSource markdown={text}>
        <MessageResponse
          mode="static"
          components={TRANSCRIPT_COMPONENTS}
          remarkPlugins={TRANSCRIPT_REMARK_PLUGINS}
          allowedTags={MENTION_TAGS}
        >
          {text}
        </MessageResponse>
      </TranscriptMarkdownSource>
    );
  }
  // Note that the source stays the words as written, because a code block's copy reads it.
  return (
    <TranscriptMarkdownSource markdown={text}>
      <MessageResponse
        mode="static"
        components={{ ...TRANSCRIPT_COMPONENTS, ...element.components }}
        remarkPlugins={TRANSCRIPT_REMARK_PLUGINS}
        allowedTags={{ ...MENTION_TAGS, [element.tag]: [...element.attributes] }}
        literalTagContent={[element.tag]}
      >
        {element.markdown}
      </MessageResponse>
    </TranscriptMarkdownSource>
  );
}

/** The blank lines a reasoning may open on, up to the first line with words. */
const LEADING_BLANK_LINES = /^(?:[^\S\n]*\n)+/u;

/**
 * How many characters of a thought its closed line is handed: more than the
 * widest column shows, since the line cuts the rest itself. Note that the
 * words are cut here as well, because a transcript holds hundreds of closed
 * thoughts, and a long first paragraph whole in each line would put back in
 * the page what the fold keeps out of it.
 */
const REASONING_PREVIEW_LENGTH = 400;

/**
 * A model's reasoning, folded under one line until opened, its words as they
 * are but for the blank lines a model leaves around them. Note that only
 * whole blank lines go at the start, because the words keep their line breaks
 * and indents, and a trailing break would draw as an empty line under the last.
 *
 * The closed line previews the thought by its first line of words, as
 * plain words, as a task is named on its card: a model's thought often opens
 * on a bold title of its own, which a preview of every paragraph would run
 * into the sentence after it. Note that the preview keeps to that first line
 * rather than following the newest words while the thought streams, so it
 * stands still once the line fills the row, because a line rewritten word by
 * word draws the eye from the reply it sits in.
 */
export function TranscriptReasoning({ text }: { text: string }): ReactNode {
  return (
    <Reasoning>
      <ReasoningTrigger preview={cardTitle(text).slice(0, REASONING_PREVIEW_LENGTH)} />
      <ReasoningContent text={text.replace(LEADING_BLANK_LINES, "").trimEnd()} />
    </Reasoning>
  );
}

/** Each kind of call's icon: a verb's own, or, for a call about something the window draws a glyph for, that glyph's likeness: the Code tab's brackets for code shown, the transcript's scroll for an agent read, as Copy full transcript wears it, never the terminal a shell command wears. A list of the agents is a list's own, rows each led by its mark, since it reads them all rather than one; a list of the models wears a chip, what an agent runs on. */
const CALL_ICON = {
  [CALL_KIND.COMMAND]: TerminalIcon,
  [CALL_KIND.MAC_COMMAND]: LaptopIcon,
  [CALL_KIND.READ_FILE]: FileTextIcon,
  [CALL_KIND.WRITE_FILE]: FilePenIcon,
  [CALL_KIND.EDIT]: FilePenIcon,
  [CALL_KIND.SEARCH]: SearchIcon,
  [CALL_KIND.WEB_SEARCH]: SearchIcon,
  [CALL_KIND.WEB_PAGE]: GlobeIcon,
  [CALL_KIND.LOAD_SKILL]: BookOpenIcon,
  [CALL_KIND.SHOW_CODE]: CodeXmlIcon,
  [CALL_KIND.DRAW_ON_BOARD]: PencilLineIcon,
  [CALL_KIND.LOOK_AT_BOARD]: EyeIcon,
  [CALL_KIND.LOOK_AT_PICTURE]: ImageIcon,
  [CALL_KIND.QUEUE_QUESTION]: MessageCircleQuestionIcon,
  [CALL_KIND.WITHDRAW_QUESTION]: MessageCircleXIcon,
  [CALL_KIND.EDIT_PLAN]: FilePenIcon,
  [CALL_KIND.TODOS]: ListTodoIcon,
  [CALL_KIND.INBOX_POST]: InboxIcon,
  [CALL_KIND.INBOX_CLOSE]: InboxIcon,
  [CALL_KIND.INBOX_READ]: InboxIcon,
  [CALL_KIND.INBOX_REPLY]: InboxIcon,
  [CALL_KIND.WORKER]: BotIcon,
  [CALL_KIND.WORKER_WAIT]: HourglassIcon,
  [CALL_KIND.WORKER_CANCEL]: CircleStopIcon,
  [CALL_KIND.LIST_AGENTS]: LayoutListIcon,
  [CALL_KIND.READ_AGENT]: ScrollTextIcon,
  [CALL_KIND.MESSAGE_AGENT]: SendIcon,
  [CALL_KIND.START_AGENT]: PlayIcon,
  [CALL_KIND.ARCHIVE_AGENT]: ArchiveIcon,
  [CALL_KIND.UNARCHIVE_AGENT]: ArchiveRestoreIcon,
  [CALL_KIND.LIST_MODELS]: CpuIcon,
  [CALL_KIND.STOP_AGENT]: CircleStopIcon,
  [CALL_KIND.END_CALL]: PhoneOffIcon,
  [CALL_KIND.SHOW_PAGE]: AppWindowIcon,
  [CALL_KIND.READ_PAGE]: AppWindowIcon,
  [CALL_KIND.SHOW_IMAGE]: ImageIcon,
  [CALL_KIND.SLEEP]: TimerIcon,
  [CALL_KIND.OTHER]: WrenchIcon,
} as const satisfies Record<CallKind, LucideIcon>;

/**
 * The coding agent a call about one names, drawn on its row in the place of
 * "the coding agent" as its mention's chip is drawn in words: its tile and
 * its name on the chip's raised fill. It is no target of its own, because
 * the row it stands on is already the one that opens the agent and hangs
 * its card, and a second press or card inside it would be two targets for
 * one thing; so it takes the row's pointer and lifts with the row's hover
 * as a chip lifts with its own (tasks.css).
 */
function AgentCallChip({ agent }: { agent: Actor }): ReactNode {
  return (
    <span className="mention-chip tool-agent-chip" data-kind="agent">
      <span className="mention-chip-glyph">
        <ActorMark actor={agent} size={ACTOR_SIZE.INLINE} />
      </span>
      <span className="mention-chip-label">{actorName(agent)}</span>
    </span>
  );
}

/** A call's line, and the chip after its verb where it names its agent by one. */
interface ChippedLine {
  readonly line: CallLine;
  readonly chip: ReactNode | undefined;
}

/** A call's line and the chip it names its agent by: the agent's chip after the verb alone, for a call about one coding agent whose agent is known, and the call's own words otherwise. */
function chippedLine(
  kind: CallKind,
  subject: string | undefined,
  description: string | undefined,
  agent: Actor | undefined,
): ChippedLine {
  if (agent === undefined || !isAgentCallKind(kind)) {
    return { line: callLine(kind, subject, description), chip: undefined };
  }
  return { line: agentCallLine(kind, subject), chip: <AgentCallChip agent={agent} /> };
}

/** Whose Mac a transcript's Mac commands ran on, its agent's starter, the reader's own among them (`macOwnerOf`); none where the window cannot tell, whose ran on the reader's own as far as it knows. */
const MacOwnerContext = createContext<Actor | undefined>(undefined);

/** Names whose Mac the transcript under it ran its Mac commands on. */
export const MacOwnerProvider = MacOwnerContext.Provider;

export type TranscriptToolProps = Omit<ComponentProps<typeof Tool>, "children"> &
  Pick<ToolHeaderProps, "state" | "subject"> & {
    kind: CallKind;
    /** For a call of an integration's own tool, the integration, whose mark the row wears in its kind's icon's place. */
    provider?: IntegrationProvider | undefined;
    /** For a command, the plain words the model said it is for, which the row says in its verb's place; the closed row previews the command's first line after them, and the body holds it whole. */
    description?: string | undefined;
    /** For a call about one coding agent, the agent, whose chip the row names it by in the place of "the coding agent"; none where the agent is not known. */
    agent?: Actor | undefined;
    input: ToolBlock;
    /** Nothing while the call has not answered. */
    output: ToolBlock | undefined;
    errorText: string | undefined;
  };

/**
 * One tool call: its row saying what it did, closed until clicked, and its
 * input and answer under it once opened. A command is the closed row's
 * preview, dropped once the body under it shows the command whole behind
 * its prompt, or by a find, which draws that body hidden; a description
 * stays, since the body does not say it.
 */
export function TranscriptTool({
  state,
  kind,
  provider,
  subject,
  description,
  agent,
  input,
  output,
  errorText,
  ...props
}: TranscriptToolProps): ReactNode {
  const Icon = CALL_ICON[kind];
  const { line, chip } = chippedLine(kind, subject, description, agent);
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
        subjectInBody={command && input.kind === TOOL_BLOCK.COMMAND}
        place={
          kind === CALL_KIND.MAC_COMMAND && macOwner !== undefined ? (
            <ActorLine>
              {"On "}
              <ActorRef actor={macOwner} sentence possessive />
              {" Mac"}
            </ActorLine>
          ) : (
            callPlace(kind)
          )
        }
      />
      <ToolContent>
        <ToolInput block={input} />
        <ToolOutput block={output} errorText={errorText} />
      </ToolContent>
    </Tool>
  );
}

/**
 * A call whose subject stands in a tab of its own, as a coding agent's start
 * does once the agent began, a page once shown, or the board drawn on: the
 * call's line as a call's row draws it, its icon, what it did, and where it
 * stands, as the one button that opens that tab rather than folding its
 * input and answer open in place, its hover saying what it opens, or
 * hanging the card that tab hangs, an agent's, where it is given one. A
 * call about one coding agent names the agent by its chip, which the row's
 * press and card are for (`AgentCallChip`).
 */
export function TranscriptOpeningCall({
  callId,
  kind,
  subject,
  agent,
  state,
  hint,
  card,
  onOpen,
}: {
  callId: string;
  kind: CallKind;
  subject: string | undefined;
  /** For a call about one coding agent, the agent, whose chip the row names it by; none where the agent is not known. */
  agent?: Actor | undefined;
  state: ToolState;
  /** What the hover says the row opens. */
  hint: string;
  /** The card the hover hangs in the hint's place: the tab's own, where the tab it opens hangs one. */
  card?: ReactNode;
  onOpen: () => void;
}): ReactNode {
  const Icon = CALL_ICON[kind];
  const { line, chip } = chippedLine(kind, subject, undefined, agent);
  return (
    <Tooltip label={hint} card={card ?? undefined}>
      <button
        type="button"
        className="tool-line tool-opening"
        data-call-id={callId}
        data-opens=""
        onClick={onOpen}
      >
        <ToolLine
          state={state}
          icon={<Icon aria-hidden="true" />}
          label={line.verb}
          subject={line.subject}
          chip={chip}
          subjectIsCode={line.code}
        />
      </button>
    </Tooltip>
  );
}

/**
 * How a to-do of each status is drawn: its glyph and the glyph's ink, how
 * its words are set, and what the glyph says aloud. Pending is an empty
 * circle, done a check in the muted ink with its words muted beside it, as
 * Linear and Things mark a finished item, and in progress a dotted circle
 * in the full ink, so the one item the list is at is the one that stands
 * out; while the agent is at it, the working mark an agent at work wears
 * (`state-glyph.tsx`) takes the dot's place (`TodoItems`). Note that a
 * done item is not struck through, because a rule through two or three
 * wrapped lines reads as noise over words the muted ink already quiets.
 */
const TODO_LOOK = {
  [CODING_AGENT_TODO_STATUS.PENDING]: {
    Icon: CircleIcon,
    mark: "text-muted-foreground",
    words: "",
    label: "Pending",
  },
  [CODING_AGENT_TODO_STATUS.IN_PROGRESS]: {
    Icon: CircleDotIcon,
    mark: "text-foreground",
    words: "",
    label: "In progress",
  },
  [CODING_AGENT_TODO_STATUS.DONE]: {
    Icon: CircleCheckIcon,
    mark: "text-muted-foreground",
    words: "text-muted-foreground",
    label: "Done",
  },
} as const satisfies Record<
  CodingAgentTodoStatus,
  { Icon: LucideIcon; mark: string; words: string; label: string }
>;

export type TranscriptTodosProps = Omit<ComponentProps<typeof Tool>, "children"> &
  Pick<ToolHeaderProps, "state" | "subject"> & {
    todos: CodingAgentTodos["todos"];
    errorText: string | undefined;
    /** Whether this is the list the agent is at now: its newest while it works. */
    live: boolean;
  };

/**
 * A to-do list's items, each behind the glyph of where it stands. The
 * glyph sits in a 16px column, as a call's icon does, with the call's 8px
 * gap after it, so a list set at a row's text column, or at its card's
 * icon, keeps its words on that row's words. The glyph is centred on its
 * item's first line, which at a 20px line centres it on the capitals, and
 * a wrapped line hangs under the words rather than the glyph. The item in
 * progress wears the moving working mark only on a `live` list, because a
 * list the agent wrote over or stopped at is a record, and a mark frozen
 * mid-lap there reads as a spinner that broke.
 */
function TodoItems({
  todos,
  live,
  className,
}: {
  todos: CodingAgentTodos["todos"];
  live: boolean;
  className?: string;
}): ReactNode {
  return (
    <ul
      className={cn(
        "m-0 flex list-none flex-col gap-1 p-0 leading-5 [--state-glyph-size:14px]",
        className,
      )}
    >
      {todos.map((todo, index) => {
        const look = TODO_LOOK[todo.status];
        const working = live && todo.status === CODING_AGENT_TODO_STATUS.IN_PROGRESS;
        return (
          <li key={index} className="flex items-start gap-2" data-todo-status={todo.status}>
            <span
              className={cn("flex h-[1lh] w-4 shrink-0 items-center justify-center", look.mark)}
              role="img"
              aria-label={look.label}
            >
              {working ? (
                <StateGlyph state={GLYPH_STATE.WORKING} />
              ) : (
                <StateGlyph state={GLYPH_STATE.REST} glyph={<look.Icon aria-hidden="true" />} />
              )}
            </span>
            <span className={cn("min-w-0 [overflow-wrap:anywhere]", look.words)}>
              {todo.content}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One write of an agent's to-do list: a call's row saying how far the list
 * has got, which opens onto the list itself, set bare at the row's text
 * column as Claude Code and Codex hang theirs under the call, since it is
 * words rather than the code a call's card holds, and selectable as a
 * call's body is; a failure is said under it as a subagent's is. Whether it starts open is the caller's, since only
 * the newest list is worth reading unasked, and so is whether it is `live`,
 * the list the agent is at, whose item in progress wears the moving mark.
 */
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
        icon={<ListTodoIcon aria-hidden="true" />}
        label={words.verb}
        subject={subject}
        subjectIsCode={words.code}
      />
      <FoldBody className="mt-0.5 mb-1 ml-7 select-text">
        <TodoItems todos={todos} live={live} />
        {errorText === undefined ? null : (
          <p
            className="m-0 mt-1 text-danger whitespace-pre-wrap [overflow-wrap:anywhere]"
            role="alert"
          >
            {errorText}
          </p>
        )}
      </FoldBody>
    </Tool>
  );
}

/**
 * The list the agent is working through, docked above the composer while
 * it works, as Claude Code keeps its list over the prompt and VS Code's
 * chat over its log: one line saying how far the list has got and the
 * item it is at, which opens onto the whole list. Closed by default, as
 * VS Code's collapses to the item in progress, so it costs the log one
 * line. It is a card on the task card's look, since it stands outside the
 * log, and it is drawn by the caller only while the list is worked. It
 * opens upward off the composer, as one sheet (tasks.css).
 */
export function TranscriptTodosDock({
  todos,
  summary,
  focus,
}: {
  todos: CodingAgentTodos["todos"];
  /** How far the list has got, as the row says it. */
  summary: string;
  /** The item the list is at; none once every item is done. */
  focus: string | undefined;
}): ReactNode {
  return (
    <Fold
      className="overflow-clip rounded-lg border border-border bg-muted text-[12.5px] [--focus-ring-offset:var(--focus-ring-inset)]"
      data-todos-dock=""
      aria-label="To-dos"
    >
      <FoldSummary className="flex h-8 cursor-pointer items-center gap-2 rounded-[inherit] px-3 transition-colors hover:bg-secondary [[open]>&]:rounded-b-none">
        <ListTodoIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="shrink-0 text-muted-foreground">{summary}</span>
        {focus === undefined ? null : <span className="min-w-0 flex-1 truncate">{focus}</span>}
        <FoldChevron className="ml-auto" />
      </FoldSummary>
      <FoldBody className="border-t border-border">
        <TodoItems todos={todos} live className="px-3 py-2" />
      </FoldBody>
    </Fold>
  );
}

/** What a subagent's row says it runs on: the model and effort, and the catalog the model is named from. */
interface SubagentPair {
  readonly choice: ModelChoice;
  readonly models: readonly CatalogModel[];
}

export type TranscriptSubagentProps = {
  /** The call that started the subagent, which the row carries as `data-call-id`. */
  callId: string;
  /** The job the subagent was handed, as its tab names it. */
  job: string;
  /** What it runs on; none where the row knows no pair. */
  pair: SubagentPair | undefined;
  state: ToolState;
  /** When the subagent began, which a running row counts from beside its working mark; none where unknown or not counted, when the mark stands alone. */
  startedAt?: number | undefined;
  /** Why the call failed, drawn under the row, since a call refused before its worker began leaves no tab to read it in. */
  errorText: string | undefined;
  /** Opens the subagent's tab, or chooses it where it is open; none where the row stands in a tab that opens no tab. */
  onOpen: (() => void) | undefined;
  /** The card the hover hangs in its hint's place, the subagent's tab's own; none where the row knows none. */
  card?: ReactNode;
};

/** What the hover over a subagent's row says it opens. */
const SUBAGENT_HINT = "Open the subagent";

/**
 * A subagent's row, on the Call tab and a coding agent's tab alike, running
 * or finished: one line drawn as a call's row is, in its muted ink, wearing
 * the mark of the harness its model runs in (the worker's robot where the
 * model is unknown), the job in the full ink as a call's verb is, fading
 * where the line cuts it, the model and effort it runs on as every pair is
 * drawn (`model-label.tsx`), and the mark a call's
 * row wears for where it stands, with how long it has worked beside the
 * working mark while it runs (`working-time.tsx`). The whole line is
 * the one button that opens the subagent's tab, its hover hanging that
 * tab's card, or saying what it opens where it is given none, and the tab
 * is where its steps and its answer are read, so it folds nothing open in
 * place. Where it
 * opens no tab it is the same line, pressed by nothing. A call that failed
 * says why in red under the line, open from the start.
 */
export function TranscriptSubagent({
  callId,
  job,
  pair,
  state,
  startedAt,
  errorText,
  onOpen,
  card,
}: TranscriptSubagentProps): ReactNode {
  const [words, clipped] = useClipped();
  const running = state === TOOL_STATE.INPUT_STREAMING || state === TOOL_STATE.INPUT_AVAILABLE;
  const line = (
    <>
      <span className="subagent-icon">
        <SubagentMark model={pair?.choice.model} />
      </span>
      <span ref={words} className="subagent-job" data-overflow={String(clipped)}>
        {job}
      </span>
      {pair === undefined ? null : (
        <span className="subagent-pair" data-subagent-pair="">
          <ModelLabel choice={pair.choice} models={pair.models} />
        </span>
      )}
      {running && startedAt !== undefined ? (
        <WorkingTime startedAt={startedAt} className="subagent-time" />
      ) : null}
      <ToolStateMark state={state} />
    </>
  );
  const row =
    onOpen === undefined ? (
      <div className="subagent-line" data-subagent-row="" data-call-id={callId}>
        {line}
      </div>
    ) : (
      <Tooltip label={SUBAGENT_HINT} card={card ?? undefined}>
        <button
          type="button"
          className="subagent-line"
          data-subagent-row=""
          data-call-id={callId}
          onClick={onOpen}
        >
          {line}
        </button>
      </Tooltip>
    );
  if (errorText === undefined) return row;
  return (
    <div>
      {row}
      <p className="subagent-error" role="alert">
        {errorText}
      </p>
    </div>
  );
}

/** What the label of a fold's line adds where a call it holds failed. */
const CALL_FAILED_WORDS = "a call failed";

/**
 * A line that folds the rows beneath it: a run of calls, or a finished
 * turn's lead. Note that it stays in the muted ink, summary and all,
 * unlike a call's line, because it counts rows rather than saying what one
 * did, and the rows it opens onto are what a reader scans. It wears the
 * fold's chevron in a row's icon column, as the plan's card does at its
 * head, because its count already says what it holds, so what is left to
 * say is whether it is open, and an icon of its own would read as one more
 * of the calls it opens onto. Where a call it holds failed, the line wears
 * that call's failed mark after its count, open or closed, as an editor's
 * tree marks a folder holding a file with problems either way, so a
 * failure is never folded out of sight, and its label says a call failed.
 */
function TurnFold({
  summary,
  running,
  failed,
  open = false,
  children,
}: {
  summary: string;
  running: boolean;
  failed: boolean;
  open?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <Fold className="text-[12.5px]" defaultOpen={open} data-turn-fold="">
      <FoldSummary
        className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        aria-label={failed ? `${summary}, ${CALL_FAILED_WORDS}` : undefined}
      >
        <FoldChevron />
        {running ? <Shimmer>{summary}</Shimmer> : <span>{summary}</span>}
        {failed ? <ToolStateMark state={TOOL_STATE.OUTPUT_ERROR} /> : null}
      </FoldSummary>
      <FoldBody className="ml-6 flex flex-col gap-1 pt-1">{children}</FoldBody>
    </Fold>
  );
}

/** One row of a turn: a block drawn by its tab, a run of calls, or a folded lead, with what trails the turn inside it where it is a fold. */
function TurnRowView<B>({
  row,
  trailer,
  children,
}: {
  row: TurnRow<B>;
  trailer: ReactNode;
  children: (block: B) => ReactNode;
}): ReactNode {
  switch (row.kind) {
    case TURN_ROW.BLOCK:
      return (
        <>
          {children(row.block)}
          {trailer}
        </>
      );
    case TURN_ROW.GROUP:
      return (
        <TurnFold summary={row.summary} running={row.running} failed={row.failed} open={row.open}>
          {row.blocks.map((block, index) => (
            <Fragment key={index}>{children(block)}</Fragment>
          ))}
          {trailer}
        </TurnFold>
      );
    case TURN_ROW.FOLDED:
      return (
        <TurnFold summary={row.summary} running={false} failed={row.failed}>
          <TranscriptRows rows={row.rows} trailer={trailer}>
            {children}
          </TranscriptRows>
        </TurnFold>
      );
  }
}

/**
 * A turn's rows (`turn-rows.ts`): each block drawn by its tab, a run of
 * calls and a folded lead drawn here. What trails the turn, as a spoken
 * turn's "Worked for" line does, is drawn inside its last row where that
 * row is a fold, so a folded turn keeps to its one line, and after it
 * otherwise.
 */
export function TranscriptRows<B>({
  rows,
  trailer,
  children,
}: {
  rows: readonly TurnRow<B>[];
  /** What follows the rows, drawn inside the last fold where the rows end on one; nothing where the tab draws it itself. */
  trailer?: ReactNode;
  /** How the tab draws one of its own blocks. */
  children: (block: B) => ReactNode;
}): ReactNode {
  // Note that a group is keyed by whether it opens, because the fold reads `defaultOpen` once, and a group that stops being the turn's latest work has to fold.
  return rows.map((row, index) => (
    <TurnRowView
      key={row.kind === TURN_ROW.GROUP ? `${row.key}-${String(row.open)}` : row.key}
      row={row}
      trailer={index === rows.length - 1 ? trailer : null}
    >
      {children}
    </TurnRowView>
  ));
}

/** A quiet note between a transcript's rows: what was left out, or what stands in a row's place. */
export function TranscriptNote({ className, ...props }: ComponentProps<"p">): ReactNode {
  return <p className={cn("m-0 text-[11.5px] text-muted-foreground", className)} {...props} />;
}
