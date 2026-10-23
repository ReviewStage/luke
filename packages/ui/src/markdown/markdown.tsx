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
 * - A document (`MARKDOWN_LOOK.DOCUMENT`) is parsed whole with real headings
 *   and no root of its own, because it is drawn into `Prose`'s, as the site
 *   renders its privacy policy and changelog at build time.
 *
 * Exported at `@luke/ui/markdown` alone, so the parser rides into no bundle
 * behind the barrel. Whatever a place knows better than this package, a
 * mention's chip, a coloured code block, a diagram, arrives as a component
 * or a step, so nothing here reaches an app.
 */

import { memo, type ReactNode, useMemo, useRef } from "react";
import remarkGfm from "remark-gfm";
import {
  type AllowedTags,
  Block,
  type Components,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  type ExtraProps,
  Streamdown,
  type StreamdownProps,
  type UrlTransform,
} from "streamdown";
import { QUOTE_CLASS } from "../quote-face.js";
import { MARKDOWN_CLASS, markdownClass } from "./markdown-class.js";
import { type MarkdownTaskToggler, placeTaskItems, taskInput } from "./markdown-tasks.js";

export type { MarkdownTaskToggler } from "./markdown-tasks.js";

/** How a place's words are drawn: as a note, a transcript, or a site's document. */
export const MARKDOWN_LOOK = {
  NOTE: "note",
  TRANSCRIPT: "transcript",
  DOCUMENT: "document",
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
  /** The place's own class on the root; a document has none, being drawn into `Prose`'s. */
  className?: string | undefined;
  /** Whether a transcript's words are still arriving, read block by block, an unclosed fence or emphasis drawn as written so far. */
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
  const steps = useMemo(
    () => (toggles ? [placeTaskItems, ...(rehypePlugins ?? [])] : rehypePlugins),
    [toggles, rehypePlugins],
  );
  const drawn = useMemo<Components>(() => {
    const own = look === MARKDOWN_LOOK.NOTE ? NOTE_COMPONENTS : {};
    if (!toggles) return { ...own, ...components };
    const input = taskInput((at) => toggler.current?.(at) ?? Promise.resolve(false));
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
      {...(steps === undefined ? {} : { rehypePlugins: steps })}
      {...(urlTransform === undefined ? {} : { urlTransform })}
    />
  );
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
  if (look === MARKDOWN_LOOK.TRANSCRIPT) {
    return (
      <Streamdown
        mode={streaming ? "streaming" : "static"}
        {...(className === undefined ? {} : { className })}
        {...(components === undefined ? {} : { components })}
        {...(remarkPlugins === undefined ? {} : { remarkPlugins })}
        {...(rehypePlugins === undefined ? {} : { rehypePlugins })}
        {...(allowedTags === undefined ? {} : { allowedTags })}
        {...(literalTagContent === undefined ? {} : { literalTagContent })}
        {...(urlTransform === undefined ? {} : { urlTransform })}
        {...(normalizeHtmlIndentation === undefined ? {} : { normalizeHtmlIndentation })}
      >
        {words}
      </Streamdown>
    );
  }
  if (look === MARKDOWN_LOOK.DOCUMENT) return <WholeWords {...whole} />;
  return (
    <div className={markdownClass(className)}>
      <WholeWords {...whole} />
    </div>
  );
});
