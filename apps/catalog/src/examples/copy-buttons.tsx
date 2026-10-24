import { BUTTON_SIZE, CopyButton, GAP, Inline } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * copy-buttons.tsx -- the one Copy, named for what it copies: one whose copy
 * lands and turns to the check, one the clipboard refuses and turns to the
 * alert, compact, and one with nothing to copy. The catalog's copy act is
 * the browser's own clipboard; an app hands in its shell's.
 */

const copyToClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

const refuse = (): Promise<void> => Promise.reject(new Error("The clipboard refused the copy."));

function CopyButtons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="copy-button-copies" title="Copies, and turns to the check">
        <Inline gap={GAP.CONTROL}>
          <CopyButton text="pnpm exec vitest run" what="code" copy={copyToClipboard} />
          <CopyButton text="https://example.com/plan/42" what="link" copy={copyToClipboard} />
        </Inline>
      </CatalogSection>
      <CatalogSection id="copy-button-refused" title="Refused, and says so">
        <CopyButton text="pnpm exec vitest run" what="code" copy={refuse} />
      </CatalogSection>
      <CatalogSection id="copy-button-sizes" title="Compact, and nothing to copy">
        <Inline gap={GAP.CONTROL}>
          <CopyButton
            text="feat/ui-copy-button"
            what="branch name"
            copy={copyToClipboard}
            size={BUTTON_SIZE.COMPACT}
          />
          <CopyButton text="" what="lines" copy={copyToClipboard} disabled />
        </Inline>
      </CatalogSection>
    </>
  );
}

export const COPY_BUTTONS_EXAMPLE: Example = {
  id: "copy-buttons",
  title: "Copy buttons",
  Render: CopyButtons,
};
