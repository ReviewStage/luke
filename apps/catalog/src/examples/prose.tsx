import { Prose } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * prose.tsx -- a generated document in the site's document type: headings at
 * each level, paragraphs, a list with a nested one, code, a chord of keys,
 * and links, and the same words in a narrow column. Every name and line is
 * made up.
 */

const DOCUMENT = `
<h2>What we collect</h2>
<p>Acme keeps the words you say to it for <strong>thirty days</strong>, then deletes them. Read <a href="#prose-document">the policy</a> for the rest.</p>
<h3>Plans</h3>
<ul>
  <li>A plan's steps, as written.</li>
  <li>The files each step touches:
    <ul><li><code>apps/acme-corporation-engineering-platform/src/budget.ts</code></li></ul>
  </li>
</ul>
<ol>
  <li>Open a plan.</li>
  <li>Press <kbd>⌘</kbd><kbd>K</kbd> to find a step.</li>
</ol>
<p>Fixed in <a href="https://github.com/acme/acme/pull/42">#42</a>.</p>
`;

function ProseExamples(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="prose-document" title="A document">
        <Prose html={DOCUMENT} />
      </CatalogSection>
      <CatalogSection id="prose-narrow" title="A narrow column">
        <div className="catalog-narrow">
          <Prose html={DOCUMENT} />
        </div>
      </CatalogSection>
    </>
  );
}

export const PROSE_EXAMPLE: Example = {
  id: "prose",
  title: "Prose",
  Render: ProseExamples,
};
