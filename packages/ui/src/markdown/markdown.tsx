import type { ElementContent, Root } from "hast";
import type { Root as MarkdownRoot, PhrasingContent, RootContent } from "mdast";
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
import { cn } from "../cn.js";
import { QUOTE_CLASS } from "../quote-face.js";
import { MARKDOWN_CLASS, markdownClass } from "./markdown-class.js";
import {
  type MarkdownTaskBox,
  placeTaskItems,
  readTaskInput,
  TaskBox,
  type TaskWrite,
  taskInput,
} from "./markdown-tasks.js";

export type { MarkdownTaskBox, TaskBoxItem, TaskWrite } from "./markdown-tasks.js";
export { TaskBox } from "./markdown-tasks.js";

export const MARKDOWN_LOOK = {
  NOTE: "note",
  TRANSCRIPT: "transcript",
  TRANSCRIPT_LINE: "transcript-line",
  DOCUMENT: "document",
  INLINE: "inline",
} as const;

type MarkdownLook = (typeof MARKDOWN_LOOK)[keyof typeof MARKDOWN_LOOK];

export type MarkdownComponents = Components;

export type MarkdownNodeProps = ExtraProps;

export type MarkdownSteps = NonNullable<StreamdownProps["rehypePlugins"]>;

type MarkdownStep = MarkdownSteps[number];

function streamdownStep(name: "raw" | "sanitize" | "harden"): MarkdownStep {
  const step = defaultRehypePlugins[name];
  if (step === undefined) throw new Error(`Streamdown holds no ${name} step`);
  return step;
}

export const TRANSCRIPT_REMARK_STEPS: MarkdownSteps = Object.values(defaultRemarkPlugins);

export const MARKDOWN_HTML_STEP = {
  PARSE: streamdownStep("raw"),
  SANITIZE: streamdownStep("sanitize"),
  HARDEN: streamdownStep("harden"),
} as const;

const NOTE_REMARK_STEPS: MarkdownSteps = [[remarkGfm, { singleTilde: false }]];

function heading(level: number, children: ReactNode): React.JSX.Element {
  return (
    <p className={MARKDOWN_CLASS.HEADING} data-level={level}>
      {children}
    </p>
  );
}

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

const NO_WRITE: TaskWrite = { run: () => undefined, asked: undefined };

const untickable: MarkdownTaskBox = ({ label, checked }) => (
  <TaskBox label={label} checked={checked} write={NO_WRITE} />
);

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

function inlineChildren(children: readonly ElementContent[]): ElementContent[] {
  return children.flatMap((child): ElementContent[] => {
    if (child.type !== "element") return [child];
    if (child.tagName === "input") return [];
    const kept = inlineChildren(child.children);
    return INLINE_TAGS.has(child.tagName) ? [{ ...child, children: kept }] : kept;
  });
}

const unwrapBlocks = () => (tree: Root) => {
  tree.children = inlineChildren(
    tree.children.filter((child): child is ElementContent => child.type !== "doctype"),
  );
};

const LINE_SPACE: RootContent = { type: "text", value: " " };

const BLOCK_HOLDERS: ReadonlySet<string> = new Set([
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
]);

const WORD_MARKS: ReadonlySet<string> = new Set(["emphasis", "strong", "delete"]);

function spaced(parts: readonly RootContent[][]): RootContent[] {
  return parts.flatMap((part, at) => (at === 0 ? part : [LINE_SPACE, ...part]));
}

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

const runOnOneLine = () => (tree: MarkdownRoot) => {
  const defines = (node: RootContent) =>
    node.type === "definition" || node.type === "footnoteDefinition";
  const definitions = tree.children.filter(defines);
  const blocks = tree.children.filter((node) => !defines(node));
  const words = spaced(blocks.map(lineContent)) as PhrasingContent[];
  tree.children = [{ type: "paragraph", children: words }, ...definitions];
};

const oneBlock = (markdown: string): string[] => [markdown];

const stepSerials = new WeakMap<object, number>();
let nextStepSerial = 0;

const keyedSteps = new WeakMap<object, MarkdownStep>();

function serialOf(value: object): number {
  const held = stepSerials.get(value);
  if (held !== undefined) return held;
  nextStepSerial += 1;
  stepSerials.set(value, nextStepSerial);
  return nextStepSerial;
}

export function markdownStep<Values extends readonly unknown[]>(
  step: (...values: Values) => unknown,
  ...values: Values
): MarkdownStep {
  let keyed = keyedSteps.get(step);
  if (keyed === undefined) {
    const attach = (_serials: unknown, ...attached: Values) => step(...attached);
    Object.defineProperty(attach, "name", { value: step.name });
    keyed = attach as unknown as MarkdownStep;
    keyedSteps.set(step, keyed);
  }
  const serials = values.map((value) =>
    (typeof value === "object" && value !== null) || typeof value === "function"
      ? serialOf(value)
      : value,
  );
  return [keyed, { serials }, ...values] as unknown as MarkdownStep;
}

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
  words: string;
  look: MarkdownLook;
  className?: string | undefined;
  streaming?: boolean | undefined;
  components?: Components | undefined;
  remarkPlugins?: MarkdownSteps | undefined;
  rehypePlugins?: MarkdownSteps | undefined;
  allowedTags?: AllowedTags | undefined;
  literalTagContent?: string[] | undefined;
  urlTransform?: UrlTransform | undefined;
  normalizeHtmlIndentation?: boolean | undefined;
  taskBox?: MarkdownTaskBox | undefined;
}

function WholeWords({
  words,
  look,
  components,
  remarkPlugins,
  rehypePlugins,
  urlTransform,
  taskBox,
}: Omit<MarkdownProps, "className">): React.JSX.Element {
  const drawer = useRef(taskBox);
  drawer.current = taskBox;
  const toggles = taskBox !== undefined;
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
      ? taskInput((item) => (drawer.current ?? untickable)(item))
      : readTaskInput;
    return { ...own, input, ...components };
  }, [look, toggles, components]);
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
  if (look === MARKDOWN_LOOK.TRANSCRIPT || look === MARKDOWN_LOOK.TRANSCRIPT_LINE) {
    const line = look === MARKDOWN_LOOK.TRANSCRIPT_LINE;
    const steps = line ? lineSteps : remarkPlugins;
    const root = line ? cn(className, "whitespace-nowrap") : className;
    return (
      <Streamdown
        mode={streaming ? "streaming" : "static"}
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
    <div className={markdownClass(className)}>
      <WholeWords {...whole} />
    </div>
  );
});
