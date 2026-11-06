import {
  CODE_CARD_TITLE,
  CODE_ROW,
  CodeCard,
  FileCodeCard,
  TerminalIcon,
  TextButton,
} from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const copyToClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

const SHORT = ["pnpm install", "pnpm exec vitest run packages/ui"].join("\n");

const COLORED = [
  'import { CODE_CARD_TITLE, CODE_ROW, CodeCard, TextButton } from "@repo/ui";',
  "",
  "export const cut = 40;",
].join("\n");

const COLORED_LINES = [
  [
    { text: "import", color: "#ff7b72", lightColor: "#cf222e" },
    { text: " { CodeCard } " },
    { text: "from", color: "#ff7b72", lightColor: "#cf222e" },
    { text: " " },
    { text: '"@repo/ui"', color: "#a5d6ff", lightColor: "#0a3069" },
    { text: ";" },
  ],
  [],
  [
    { text: "export const", color: "#ff7b72", lightColor: "#cf222e" },
    { text: " " },
    { text: "cut", color: "#79c0ff", lightColor: "#0550ae" },
    { text: " = " },
    { text: "40", color: "#79c0ff", lightColor: "#0550ae" },
    { text: ";" },
  ],
];

const SUGGESTION = ["const days = 30;", "const days = 7;", "export default days;"];

const LONG = Array.from(
  { length: 60 },
  (_, at) => `  step${at + 1}: "Line ${at + 1} of the block",`,
).join("\n");

function CodeCards(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="code-card-language" title="Headed by its language">
        <CodeCard title="shell" code={SHORT} copy={copyToClipboard} />
      </CatalogSection>
      <CatalogSection id="code-card-glyph" title="Headed by its language's name, after its glyph">
        <CodeCard
          glyph={<TerminalIcon />}
          title="Shell"
          titleIs={CODE_CARD_TITLE.WORDS}
          code={SHORT}
          copy={copyToClipboard}
        />
      </CatalogSection>
      <CatalogSection id="code-card-file" title="Headed by its file, colored by the host">
        <CodeCard
          title="packages/ui/src/cut.ts"
          code={COLORED}
          lines={COLORED_LINES}
          copy={copyToClipboard}
        />
      </CatalogSection>
      <CatalogSection id="code-card-cut" title="Cut at 40 lines, with Show all">
        <CodeCard title="yaml" code={LONG} copy={copyToClipboard} />
      </CatalogSection>
      <CatalogSection id="code-card-rows" title="Drawn as rows, copying its new lines">
        <CodeCard
          title="Suggested change"
          titleIs={CODE_CARD_TITLE.WORDS}
          code={SUGGESTION.join("\n")}
          rows={[CODE_ROW.REMOVED, CODE_ROW.ADDED, CODE_ROW.ADDED]}
          copied={SUGGESTION.slice(1).join("\n")}
          copy={copyToClipboard}
        />
      </CatalogSection>
      <CatalogSection id="code-card-body" title="A body of the caller's own, with an action">
        <CodeCard
          title="packages/ui/src/cut.ts"
          body="Drawn by the caller, not cut."
          copied={COLORED}
          actions={<TextButton onClick={() => {}}>Open file</TextButton>}
          copy={copyToClipboard}
        />
      </CatalogSection>
      <CatalogSection id="code-card-file-open" title="A file's lines, with the file's opening">
        <FileCodeCard
          title="packages/ui/src/cut.ts"
          label="packages/ui/src/cut.ts, Line 3"
          body="The lines, as the caller draws them."
          copied="export const cut = 40;"
          copy={copyToClipboard}
          onOpen={() => {}}
        />
      </CatalogSection>
    </>
  );
}

export const CODE_CARDS_EXAMPLE: Example = {
  id: "code-cards",
  title: "Code cards",
  Render: CodeCards,
};
