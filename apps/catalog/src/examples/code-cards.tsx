import { CODE_CARD_TITLE, CODE_ROW, CodeCard, TextButton } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * code-cards.tsx -- the one card for a block of code: a short block headed
 * by its language, one headed by its file with the host's colours on its
 * runs, a block of 60 lines cut at 40 behind Show all, a suggestion drawn
 * as rows on the added and removed grounds, and a body the caller draws under
 * a header with an action of its own. The catalog's copy act is the
 * browser's own clipboard; an app hands in its shell's.
 */

const copyToClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

const SHORT = ["pnpm install", "pnpm exec vitest run packages/ui"].join("\n");

const COLOURED = [
  'import { CODE_CARD_TITLE, CODE_ROW, CodeCard, TextButton } from "@luke/ui";',
  "",
  "export const cut = 40;",
].join("\n");

/** The colours the host's highlighter hands for `COLOURED`, GitHub's own in each appearance. */
const COLOURED_LINES = [
  [
    { text: "import", color: "#ff7b72", lightColor: "#cf222e" },
    { text: " { CodeCard } " },
    { text: "from", color: "#ff7b72", lightColor: "#cf222e" },
    { text: " " },
    { text: '"@luke/ui"', color: "#a5d6ff", lightColor: "#0a3069" },
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
      <CatalogSection id="code-card-file" title="Headed by its file, coloured by the host">
        <CodeCard
          title="packages/ui/src/cut.ts"
          code={COLOURED}
          lines={COLOURED_LINES}
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
          copied={COLOURED}
          actions={<TextButton onClick={() => {}}>Open file</TextButton>}
          copy={copyToClipboard}
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
