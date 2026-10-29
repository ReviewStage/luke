/**
 * markdown.tsx -- the one Markdown renderer every surface draws words with: a note's (the plan, its versions, a comment, a file's note), a transcript's as it streams, and a site document's, all on Streamdown.
 *
 * Streamdown is react-markdown's own pipeline (remark, remark-rehype, and
 * hast to JSX) with a streaming reader in front of it, so one engine serves
 * words that are whole and words still arriving. Each look draws through the
 * part of it that keeps what that look has always drawn:
 *
 * - A note (`MARKDOWN_LOOK.NOTE`) is parsed whole through Streamdown's
 *   `Block`, inside this component's own `.luke-markdown` root, with nothing
 *   of Streamdown's own dress: its headings are paragraphs a step above the
 *   words (styled, never announced), a picture is its alternative words, raw
 *   HTML is text, and only the elements a place hands in are drawn its way.
 * - A transcript (`MARKDOWN_LOOK.TRANSCRIPT`) is Streamdown whole, read block
 *   by block while it streams, its HTML parsed and sanitised, its root and
 *   components the place's.
 * - A transcript's line (`MARKDOWN_LOOK.TRANSCRIPT_LINE`) is a transcript
 *   read as one block, its blocks' words run together into one line, its
 *   line breaks spaces, so a row holding one line draws a message's words,
 *   its chips among them, as its bubble does, as a queued message's row does.
 * - A document (`MARKDOWN_LOOK.DOCUMENT`) is parsed whole with real headings
 *   and no root of its own, because it is drawn into `Prose`'s, as the site
 *   renders its privacy policy and changelog at build time.
 * - A line (`MARKDOWN_LOOK.INLINE`) is parsed whole as a note is, with no
 *   root of its own, its blocks unwrapped into one run of inline words, so
 *   it is drawn inside a label or any other element that holds words alone,
 *   as a to-do's step is.
 *
 * Exported at `@luke/ui/markdown` alone, so the parser rides into no bundle
 * behind the barrel. Whatever a place knows better than this package, a
 * mention's chip, a coloured code block, a diagram, arrives as a component
 * or a step, so nothing here reaches an app.
 */

import { MOTION_DELAY_MS } from "@luke/brand";
import type { ElementContent, Root } from "hast";
import type { Root as MarkdownRoot, PhrasingContent, RootContent } from "mdast";
import { memo, type ReactNode, useMemo, useRef, useState } from "react";
import remarkGfm from "remark-gfm";
import {
  type AllowedTags,
  type AnimateOptions,
  Block,
  type Components,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  type ExtraProps,
  Streamdown,
  type StreamdownProps,
  type UrlTransform,
} from "streamdown";
import { cn } from "../cn.js";
import { landedMark } from "../components/landed/landed.js";
import { motionHeld } from "../motion-timing.js";
import { QUOTE_CLASS } from "../quote-face.js";
import { MARKDOWN_CLASS, markdownClass } from "./markdown-class.js";
import {
  type MarkdownTaskToggler,
  placeTaskItems,
  readTaskInput,
  taskInput,
} from "./markdown-tasks.js";

export type { MarkdownTaskToggler } from "./markdown-tasks.js";

/** How a place's words are drawn: as a note, a transcript, or a site's document. */
export const MARKDOWN_LOOK = {
  NOTE: "note",
  TRANSCRIPT: "transcript",
  TRANSCRIPT_LINE: "transcript-line",
  DOCUMENT: "document",
  INLINE: "inline",
} as const;

type MarkdownLook = (typeof MARKDOWN_LOOK)[keyof typeof MARKDOWN_LOOK];

/** The elements a place draws its own way, by tag. */
export type MarkdownComponents = Components;

/** What an element a place draws is handed beside its own attributes: the tree's node, with its place in the words. */
export type MarkdownNodeProps = ExtraProps;

/** The remark or rehype steps words are read with. */
export type MarkdownSteps = NonNullable<StreamdownProps["rehypePlugins"]>;

type MarkdownStep = MarkdownSteps[number];

/** One of Streamdown's own steps over raw HTML, by its name, which the library always holds. */
function streamdownStep(name: "raw" | "sanitize" | "harden"): MarkdownStep {
  const step = defaultRehypePlugins[name];
  if (step === undefined) throw new Error(`Streamdown holds no ${name} step`);
  return step;
}

/** The Markdown steps a transcript is read with where it names none: GitHub's dialect and a fence's meta, as Streamdown reads them. */
export const TRANSCRIPT_REMARK_STEPS: MarkdownSteps = Object.values(defaultRemarkPlugins);

/**
 * The steps a drawn tree takes over raw HTML, each by name, for a place that
 * lists its own between them: the parse, the sanitizer, and the link
 * hardening, a transcript's three where it names none. A site document
 * written in this repository takes the parse alone, its HTML being ours.
 */
export const MARKDOWN_HTML_STEP = {
  PARSE: streamdownStep("raw"),
  SANITIZE: streamdownStep("sanitize"),
  HARDEN: streamdownStep("harden"),
} as const;

/**
 * GitHub's dialect, which is the one coding agents write: tables,
 * strikethrough, and task lists, with a single tilde left as the character it
 * is, so two home-directory paths in one sentence do not strike the words
 * between them.
 */
const NOTE_REMARK_STEPS: MarkdownSteps = [[remarkGfm, { singleTilde: false }]];

/**
 * How far ahead of the clock a streaming reply's words may be set to fade
 * in, in milliseconds. Note that this is the transcript's beat rather than a
 * motion token: a running agent's reply lands a finished sentence at a time,
 * up to twice a second, so a sentence is spread over about the wait for the
 * next one rather than drawn at once, and no further, or its last words would
 * still be fading in when the next sentence lands after them.
 */
const ARRIVING_SPREAD_MS = 480;

/**
 * How a streaming reply's newest words arrive: each word fades in on its own
 * (`markdown-motion.css`), a row's stagger after the word before it, and a
 * sentence that lands whole is spread over at most `ARRIVING_SPREAD_MS`.
 */
const WORDS_ARRIVING: AnimateOptions = {
  sep: "word",
  stagger: MOTION_DELAY_MS.ROW_STAGGER,
  maxBacklogMs: ARRIVING_SPREAD_MS,
};

function heading(level: number, children: ReactNode): React.JSX.Element {
  return (
    <p className={MARKDOWN_CLASS.HEADING} data-level={level}>
      {children}
    </p>
  );
}

/**
 * How a note draws the elements whose default would say the wrong thing in
 * it. A heading is styled, never announced: a reader walking the document's
 * headings should meet the window's, not a reply's. A picture has no picture
 * to draw in a caption, so its alternative words stand in for it. A quote is
 * the one every Markdown in the window draws (`quote-face.ts`).
 */
const NOTE_COMPONENTS: Components = {
  h1: ({ children }) => heading(1, children),
  h2: ({ children }) => heading(2, children),
  h3: ({ children }) => heading(3, children),
  h4: ({ children }) => heading(4, children),
  h5: ({ children }) => heading(5, children),
  h6: ({ children }) => heading(6, children),
  img: ({ alt }) => <>{alt ?? ""}</>,
  blockquote: ({ children }) => <blockquote className={QUOTE_CLASS}>{children}</blockquote>,
};

/**
 * The elements a line keeps as they are: the inline ones Markdown writes, and
 * those a place's own steps mark words with. A task item's box is no word, so
 * it is not among them.
 */
const INLINE_TAGS: ReadonlySet<string> = new Set([
  "a",
  "br",
  "code",
  "del",
  "em",
  "img",
  "ins",
  "mark",
  "span",
  "strong",
]);

/** A node's children with every element no line keeps replaced by its own children, and a task item's box dropped. */
function inlineChildren(children: readonly ElementContent[]): ElementContent[] {
  return children.flatMap((child): ElementContent[] => {
    if (child.type !== "element") return [child];
    if (child.tagName === "input") return [];
    const kept = inlineChildren(child.children);
    return INLINE_TAGS.has(child.tagName) ? [{ ...child, children: kept }] : kept;
  });
}

/**
 * The rehype step that draws a line's blocks as one run of words: a
 * paragraph, a heading, a list, a quote, and a table each give way to their
 * words, and a fence to its code, drawn as a code span. Note that the line
 * breaks the tree keeps between blocks stay, so two blocks' words read apart
 * as a space between them.
 */
const unwrapBlocks = () => (tree: Root) => {
  tree.children = inlineChildren(
    tree.children.filter((child): child is ElementContent => child.type !== "doctype"),
  );
};

/** The space a line keeps between two blocks' words, and in a line break's place. */
const LINE_SPACE: RootContent = { type: "text", value: " " };

/** The nodes whose children are blocks, each read apart from the next by a space in a line. */
const BLOCK_HOLDERS: ReadonlySet<string> = new Set([
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
]);

/** The nodes that mark words and are kept around them in a line. */
const WORD_MARKS: ReadonlySet<string> = new Set(["emphasis", "strong", "delete"]);

/** Blocks' words as one run, each apart from the next by a space. */
function spaced(parts: readonly RootContent[][]): RootContent[] {
  return parts.flatMap((part, at) => (at === 0 ? part : [LINE_SPACE, ...part]));
}

/** A node as a line draws it: a line break as a space, a rule as nothing, a fence as its code in a span, a link and a word's mark kept, and every other node as its words. */
function lineContent(node: RootContent): RootContent[] {
  if (node.type === "break") return [LINE_SPACE];
  if (node.type === "thematicBreak") return [];
  if (node.type === "code") {
    return [{ type: "inlineCode", value: node.value.replaceAll("\n", " ") }];
  }
  if (!("children" in node) || node.type === "link" || node.type === "linkReference") return [node];
  const parts = node.children.map((child) => lineContent(child));
  const kept = BLOCK_HOLDERS.has(node.type) ? spaced(parts) : parts.flat();
  return WORD_MARKS.has(node.type) ? [{ ...node, children: kept } as RootContent] : kept;
}

/**
 * The remark step that draws a transcript's words as one line: a paragraph,
 * a heading, a list, a quote, and a table each give way to their words, a
 * fence to its code as a code span, and a line break to a space, each block
 * apart from the next by a space, all in one paragraph. Note that a link is
 * kept whole, a place's mark on it included, and a definition stays where it
 * was, since a reference link is read through it.
 */
const runOnOneLine = () => (tree: MarkdownRoot) => {
  const defines = (node: RootContent) =>
    node.type === "definition" || node.type === "footnoteDefinition";
  const definitions = tree.children.filter(defines);
  const blocks = tree.children.filter((node) => !defines(node));
  // Note that the words stand in one paragraph, because the root sets a line break between its children, which would space a word from its own mark.
  const words = spaced(blocks.map(lineContent)) as PhrasingContent[];
  tree.children = [{ type: "paragraph", children: words }, ...definitions];
};

/** A transcript's line read as the one block it is, so a reference link reads its definition wherever it stands. */
const oneBlock = (markdown: string): string[] => [markdown];

/** A serial for each value a step closes over, which Streamdown's processor cache cannot tell apart by itself. */
const stepSerials = new WeakMap<object, number>();
let nextStepSerial = 0;

/** A step's name as the processor cache reads it, standing for the step itself. */
const keyedSteps = new WeakMap<object, MarkdownStep>();

function serialOf(value: object): number {
  const held = stepSerials.get(value);
  if (held !== undefined) return held;
  nextStepSerial += 1;
  stepSerials.set(value, nextStepSerial);
  return nextStepSerial;
}

/**
 * A step with the values it closes over, as a place hands one in. Note that
 * Streamdown keeps one processor per list of steps and tells two lists apart
 * by each step's name and its first option's JSON alone, so a step closing
 * over a function, or over a second value, would be drawn with whichever
 * processor was built first. The step is handed a serial of its values as
 * its first option, which the cache reads, and its values after it, which
 * the step reads; a step's values are the same objects for as long as a
 * place memoises them, so the cache still serves a redraw.
 */
export function markdownStep<Values extends readonly unknown[]>(
  step: (...values: Values) => unknown,
  ...values: Values
): MarkdownStep {
  let keyed = keyedSteps.get(step);
  if (keyed === undefined) {
    const attach = (_serials: unknown, ...attached: Values) => step(...attached);
    Object.defineProperty(attach, "name", { value: step.name });
    // SAFETY: a unified attacher takes its options and answers a transformer, which `step` does.
    keyed = attach as unknown as MarkdownStep;
    keyedSteps.set(step, keyed);
  }
  const serials = values.map((value) =>
    (typeof value === "object" && value !== null) || typeof value === "function"
      ? serialOf(value)
      : value,
  );
  // SAFETY: a step's tuple is the step, then the options it is attached with.
  return [keyed, { serials }, ...values] as unknown as MarkdownStep;
}

/** A serial for each address rewriter, which a note's whole parse is keyed by, since its memo reads its words and steps alone. */
const transformSerials = new WeakMap<UrlTransform, number>();

function transformKey(transform: UrlTransform | undefined): number {
  if (transform === undefined) return 0;
  const held = transformSerials.get(transform);
  if (held !== undefined) return held;
  nextStepSerial += 1;
  transformSerials.set(transform, nextStepSerial);
  return nextStepSerial;
}

export interface MarkdownProps {
  /** The words, as written. */
  words: string;
  look: MarkdownLook;
  /** The place's own class on the root; a document and a line have none, being drawn into the place's own. */
  className?: string | undefined;
  /** Whether a note was just landed on, lit once as every place landed on is (`landed.ts`). */
  landed?: boolean | undefined;
  /** Whether a transcript's words are still arriving, read block by block, an unclosed fence or emphasis drawn as written so far, the newest fading in. */
  streaming?: boolean | undefined;
  /** The elements the place draws its own way, over the look's own. */
  components?: Components | undefined;
  /** The Markdown steps the words are read with, in the look's place: a note's and a document's are GitHub's dialect, a transcript's Streamdown's own. */
  remarkPlugins?: MarkdownSteps | undefined;
  /** The steps the drawn tree takes: a note's and a document's draw raw HTML as text where none parses it; a transcript's are Streamdown's parse, sanitizer, and hardening. */
  rehypePlugins?: MarkdownSteps | undefined;
  /** A transcript's own elements the sanitizer keeps, by tag, with the attributes each may carry. */
  allowedTags?: AllowedTags | undefined;
  /** A transcript's own elements whose words are taken as they are, never as Markdown. */
  literalTagContent?: string[] | undefined;
  /** Rewrites each address a link or a picture names; Streamdown's own where none is handed. */
  urlTransform?: UrlTransform | undefined;
  /** Whether a transcript's HTML blocks lose their indent before they are read. */
  normalizeHtmlIndentation?: boolean | undefined;
  /** Ticks or clears a note's task item pressed, as a plan the developer can edit does; every checkbox is read-only without it. */
  onTask?: MarkdownTaskToggler | undefined;
}

/**
 * Words parsed whole, through Streamdown's block reader, with no dress and
 * no root of their own: a note's elements, its task boxes where its reader
 * may tick them, and the place's own over them.
 */
function WholeWords({
  words,
  look,
  components,
  remarkPlugins,
  rehypePlugins,
  urlTransform,
  onTask,
}: Omit<MarkdownProps, "className">): React.JSX.Element {
  // Note that the toggler is read as a box is pressed, so a new one each render redraws nothing.
  const toggler = useRef(onTask);
  toggler.current = onTask;
  const toggles = onTask !== undefined;
  // Note that every box is named by its item, so one the reader cannot tick is placed too.
  const steps = useMemo(
    () => [
      placeTaskItems,
      ...(rehypePlugins ?? []),
      ...(look === MARKDOWN_LOOK.INLINE ? [unwrapBlocks] : []),
    ],
    [look, rehypePlugins],
  );
  const drawn = useMemo<Components>(() => {
    const own = look === MARKDOWN_LOOK.DOCUMENT ? {} : NOTE_COMPONENTS;
    const input = toggles
      ? taskInput((at, ticked) => toggler.current?.(at, ticked) ?? Promise.resolve(false))
      : readTaskInput;
    return { ...own, input, ...components };
  }, [look, toggles, components]);
  // Note that the block is keyed by its rewriter, because its memo compares the words, the components, and the steps, never the rewriter.
  return (
    <Block
      key={transformKey(urlTransform)}
      content={words}
      index={0}
      isIncomplete={false}
      shouldParseIncompleteMarkdown={false}
      shouldNormalizeHtmlIndentation={false}
      components={drawn}
      remarkPlugins={remarkPlugins ?? NOTE_REMARK_STEPS}
      rehypePlugins={steps}
      {...(urlTransform === undefined ? {} : { urlTransform })}
    />
  );
}

/**
 * Whether a transcript has streamed since it was drawn, and whether its
 * newest words fade in as they land. A transcript that has streamed is read
 * block by block for as long as it is drawn, its words settled or not,
 * because reading settled words whole draws a new tree in place of the one
 * on screen, which takes away what the reader selected and cuts off a word
 * still fading in, the last sentence's most of all, since it lands with the
 * turn's end. Words fade only where motion is not held, read when the
 * streaming starts, because a fade's delays would still stagger the words
 * where its durations are zeroed.
 */
function useStreamed(streaming: boolean): { streamed: boolean; fades: boolean } {
  const [streamed, setStreamed] = useState(streaming);
  const [fades, setFades] = useState(() => streaming && !motionHeld());
  // Note that the start is taken in the render that sees it, so its first words fade too.
  if (streaming && !streamed) {
    setStreamed(true);
    setFades(!motionHeld());
  }
  return { streamed, fades };
}

/**
 * Words drawn as the Markdown they were written in. A note and a document
 * are drawn again only when what they are handed changes, since the words
 * are parsed afresh on every draw, and a plan drawing every section on each
 * frame of its typing would parse them all; a place hands its components
 * and steps memoised for the same reason.
 */
export const Markdown = memo(function Markdown({
  className,
  streaming = false,
  landed = false,
  ...whole
}: MarkdownProps): React.JSX.Element {
  const {
    words,
    look,
    components,
    remarkPlugins,
    rehypePlugins,
    allowedTags,
    literalTagContent,
    urlTransform,
    normalizeHtmlIndentation,
  } = whole;
  // Note that a transcript's task boxes are drawn as a note's read-only ones, named by their items
  // where the place hands steps of its own, since Streamdown keeps its allowed tags only on its own.
  const transcriptSteps = useMemo(
    () => (rehypePlugins === undefined ? undefined : [...rehypePlugins, placeTaskItems]),
    [rehypePlugins],
  );
  const lineSteps = useMemo(
    () => [...(remarkPlugins ?? TRANSCRIPT_REMARK_STEPS), runOnOneLine],
    [remarkPlugins],
  );
  const transcriptComponents = useMemo<Components>(
    () => ({ input: readTaskInput, ...components }),
    [components],
  );
  const { streamed, fades } = useStreamed(streaming);
  if (look === MARKDOWN_LOOK.TRANSCRIPT || look === MARKDOWN_LOOK.TRANSCRIPT_LINE) {
    const line = look === MARKDOWN_LOOK.TRANSCRIPT_LINE;
    const steps = line ? lineSteps : remarkPlugins;
    // Note that a line's root keeps its words from wrapping, over Streamdown's own root, which wraps them.
    const root = line ? cn(className, "whitespace-nowrap") : className;
    return (
      <Streamdown
        mode={streamed ? "streaming" : "static"}
        {...(fades ? { animated: WORDS_ARRIVING, isAnimating: true } : {})}
        {...(root === undefined ? {} : { className: root })}
        components={transcriptComponents}
        {...(steps === undefined ? {} : { remarkPlugins: steps })}
        {...(line ? { parseMarkdownIntoBlocksFn: oneBlock } : {})}
        {...(transcriptSteps === undefined ? {} : { rehypePlugins: transcriptSteps })}
        {...(allowedTags === undefined ? {} : { allowedTags })}
        {...(literalTagContent === undefined ? {} : { literalTagContent })}
        {...(urlTransform === undefined ? {} : { urlTransform })}
        {...(normalizeHtmlIndentation === undefined ? {} : { normalizeHtmlIndentation })}
      >
        {words}
      </Streamdown>
    );
  }
  if (look === MARKDOWN_LOOK.DOCUMENT || look === MARKDOWN_LOOK.INLINE) {
    return <WholeWords {...whole} />;
  }
  return (
    <div className={markdownClass(className)} {...landedMark(landed)}>
      <WholeWords {...whole} />
    </div>
  );
});
