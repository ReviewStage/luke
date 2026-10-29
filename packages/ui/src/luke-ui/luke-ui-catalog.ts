import { defineCatalog, defineSchema, type PromptContext, type Spec } from "@json-render/core";
import { Option, Schema } from "effect";
import { z } from "zod";
import { STATUS_TONE } from "../status-tone.js";
import { LUKE_UI_COMPONENT, LUKE_UI_LANGUAGE } from "./luke-ui-contract.js";

/**
 * luke-ui-catalog.ts -- the components an agent may draw in its message as a ```` ```luke-ui ```` fence, what each takes, the words that teach a model to write one, and the reading that admits a spec or refuses it.
 *
 * A trial of json-render (`@json-render/core`): a catalog names the
 * components a model may use and the props each takes, the model writes a
 * spec naming only those, and the renderer (`luke-ui-spec.tsx`) draws it
 * with `@luke/ui`'s own. The spec is json-render's flat map of elements by
 * key, its root naming one. The catalog is declared over json-render's own
 * schema builder rather than its React schema, for two reasons: the React
 * schema's prompt teaches a stream of JSON patches with no Markdown and no
 * fences, state, actions, and repeats, none of which a fence in a message
 * can carry, so this one's prompt (`promptTemplate`) teaches the fence
 * alone; and its elements take a type, props, and children and nothing
 * else, so a `visible`, an `on`, or a `repeat` a model writes is dropped as
 * the spec is read rather than handed to the renderer.
 *
 * Note that json-render declares props in zod, a second validation library
 * beside the repository's Effect Schema, which root AGENTS.md refuses at a
 * boundary; this is the trial's cost, and its pull request says what
 * shipping it would take. Note too that the catalog's own check holds an
 * element's type to the catalog's names but not its props, which it reads
 * as any record once a catalog has more than one component, so
 * `readLukeUiSpec` checks each element's props against its own component.
 *
 * Imports no React, at a subpath of its own, so the service reads the
 * prompt without resolving the renderer, and json-render and zod reach only
 * a bundle that reads a spec.
 */

/** The slot an element's children stand in, for a component that takes any. */
const DEFAULT_SLOT = "default";

/** A state's tone, as `STATUS_TONE` names it. */
const TONE = z.enum(Object.values(STATUS_TONE));

/** A status a row or a card says where it stands with: its words and its tone. */
const STATUS = z.object({ label: z.string().min(1), tone: TONE.optional() });

/** A fence's code as JSON, or none where it is not JSON. */
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** What the prompt reads of each component: its props, whether it takes children, and what it is for. */
interface PromptedComponents {
  readonly components: Readonly<
    Record<string, { props: z.ZodType; slots: readonly string[]; description: string }>
  >;
}

/**
 * The shape of a spec, and of the catalog it is read against. Note that an
 * element's children are optional, where json-render's React schema asks
 * every leaf for an empty list, because a model leaves an empty list out.
 */
const LUKE_UI_SCHEMA = defineSchema(
  (s) => ({
    spec: s.object({
      root: s.string(),
      elements: s.record(
        s.object({
          type: s.ref("catalog.components"),
          props: s.propsOf("catalog.components"),
          children: { ...s.array(s.string()), ...s.optional() },
        }),
      ),
    }),
    catalog: s.object({
      components: s.map({
        props: s.zod(),
        slots: s.array(s.string()),
        description: s.string(),
      }),
      actions: s.map({ params: s.zod(), description: s.string() }),
    }),
  }),
  // Note that json-render types a schema's template over a catalog it cannot know yet, and naming this catalog's own type here would be a cycle.
  { promptTemplate: (context) => lukeUiPromptOf(context as PromptContext<PromptedComponents>) },
);

/** The components, their props, and what each is for, which the prompt lists and the renderer draws. */
export const LUKE_UI_CATALOG = defineCatalog(LUKE_UI_SCHEMA, {
  components: {
    [LUKE_UI_COMPONENT.CARD]: {
      props: z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        status: STATUS.optional(),
      }),
      slots: [DEFAULT_SLOT],
      description:
        "A titled card framing its children one under another; its status, where given, stands at the title's end.",
    },
    [LUKE_UI_COMPONENT.FACTS]: {
      props: z.object({
        items: z.array(z.object({ label: z.string().min(1), value: z.string() })).min(1),
      }),
      slots: [],
      description: "Facts one under another, each a muted label and its value at the line's end.",
    },
    [LUKE_UI_COMPONENT.TABLE]: {
      props: z.object({
        label: z.string().min(1),
        columns: z
          .array(z.object({ label: z.string().min(1), numeric: z.boolean().optional() }))
          .min(1),
        rows: z.array(z.array(z.union([z.string(), z.number()]))).min(1),
      }),
      slots: [],
      description:
        "Records compared across columns: each row one cell per column, in order; a numeric column's figures line up at its end. `label` names the table for a screen reader.",
    },
    [LUKE_UI_COMPONENT.BADGE]: {
      props: STATUS,
      slots: [],
      description: "A short word saying where something stands, coloured by its tone.",
    },
    [LUKE_UI_COMPONENT.LIST]: {
      props: z.object({
        label: z.string().min(1),
        items: z
          .array(
            z.object({
              title: z.string().min(1),
              description: z.string().optional(),
              meta: z.string().optional(),
              status: STATUS.optional(),
            }),
          )
          .min(1),
      }),
      slots: [],
      description:
        "Things read one at a time, each a title, a line under it, and its metadata and status at the row's end. `label` names the list for a screen reader.",
    },
    [LUKE_UI_COMPONENT.TEXT]: {
      props: z.object({ text: z.string().min(1), muted: z.boolean().optional() }),
      slots: [],
      description: "A paragraph of plain words, not Markdown, in the quieter ink where muted.",
    },
  },
  actions: {},
});

/** The example the prompt shows, a card holding facts. */
const EXAMPLE_SPEC = {
  root: "checks",
  elements: {
    checks: {
      type: LUKE_UI_COMPONENT.CARD,
      props: { title: "Checks", status: { label: "Passing", tone: STATUS_TONE.COMPLETE } },
      children: ["results"],
    },
    results: {
      type: LUKE_UI_COMPONENT.FACTS,
      props: {
        items: [
          { label: "Lint", value: "Passed" },
          { label: "Tests", value: "412 passed" },
        ],
      },
    },
  },
} as const;

/**
 * The words that teach a model the fence: what it is for, the spec's shape
 * by example, the catalog's components as json-render writes their props,
 * and the rules a spec is read by.
 */
function lukeUiPromptOf({ catalog, formatZodType }: PromptContext<PromptedComponents>): string {
  const components = Object.entries(catalog.components).map(
    ([name, component]) =>
      `- ${name}: ${formatZodType(component.props)}. ${component.description}${component.slots.length > 0 ? " Takes children." : ""}`,
  );
  return [
    `Where a status, a comparison, or a set of facts reads better drawn than written, put it in a fenced code block whose language is \`${LUKE_UI_LANGUAGE}\`, holding one JSON spec. Luke draws the spec with its own components in your message; a spec it cannot read is shown as its code.`,
    "",
    `A spec is a flat map of elements by key, its \`root\` naming one: \`${JSON.stringify(EXAMPLE_SPEC)}\``,
    "",
    "The components, the only ones a spec may name:",
    ...components,
    "",
    "- Every element has a `type` and its `props`; `children` lists other elements by key, only on a component that takes children.",
    "- An element stands in the tree once: no key is a child twice or its own ancestor.",
    "- Props are plain JSON values: no state, actions, visibility, repeats, or expressions. The spec is drawn once, as written.",
    "- Words in props are plain text, not Markdown.",
    "- Keep it small and beside your words, never in place of them: what a sentence says as well stays a sentence.",
  ].join("\n");
}

/** The words that teach a model to write a ```` ```luke-ui ```` fence. */
export function lukeUiPrompt(): string {
  return LUKE_UI_CATALOG.prompt();
}

/** Each component by the name a spec types it with, for a spec read against its own props and slots. */
const COMPONENTS: ReadonlyMap<
  string,
  { props: z.ZodType<Record<string, unknown>>; slots: readonly string[] }
> = new Map(Object.entries(LUKE_UI_CATALOG.data.components));

/**
 * Whether every element reached from the root stands once: each child it
 * names exists and is reached by no other path, and only a component that
 * takes children names any. Note that an element nothing reaches is left
 * standing, as json-render leaves one, since nothing draws it.
 */
function standsAsTree(spec: Spec): boolean {
  const reached = new Set<string>();
  const pending = [spec.root];
  for (const key of pending) {
    // Note that a key is read as the spec's own, so one a model wrote as `toString` is no element.
    const element = Object.hasOwn(spec.elements, key) ? spec.elements[key] : undefined;
    if (element === undefined || reached.has(key)) return false;
    reached.add(key);
    const children = element.children ?? [];
    const slots = COMPONENTS.get(element.type)?.slots ?? [];
    if (children.length > 0 && !slots.includes(DEFAULT_SLOT)) return false;
    pending.push(...children);
  }
  return true;
}

/**
 * A fence's code as a spec the renderer may draw, its every element's props
 * read against its own component and stripped of what that component does
 * not take; nothing where the code is not JSON, names a component outside
 * the catalog, gives one a prop it refuses, or does not stand as a tree.
 */
export function readLukeUiSpec(code: string): Spec | undefined {
  const read = LUKE_UI_CATALOG.validate(Option.getOrUndefined(decodeJson(code)));
  if (!read.success || read.data === undefined) return undefined;
  const elements = Object.entries(read.data.elements).map(([key, element]) => {
    const props = COMPONENTS.get(element.type)?.props.safeParse(element.props);
    return props?.success === true
      ? ([key, { ...element, props: props.data }] as const)
      : undefined;
  });
  if (elements.some((element) => element === undefined)) return undefined;
  // Note that the map is built from entries, so a key a model wrote as `__proto__` stays a key.
  const spec: Spec = {
    root: read.data.root,
    elements: Object.fromEntries(elements.filter((element) => element !== undefined)),
  };
  return standsAsTree(spec) ? spec : undefined;
}
