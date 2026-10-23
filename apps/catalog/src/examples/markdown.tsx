import { MARKDOWN_LOOK, Markdown } from "@luke/ui/markdown";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * markdown.tsx -- a note's Markdown as the window draws a plan, a comment,
 * or a file's note: headings drawn as paragraphs a step above the words,
 * emphasis and code, a list with a nested one, task items read-only and
 * tickable, a table, a fence, a quote, and a rule, and the same words in a
 * narrow column. Every name and line is made up.
 */

const NOTE = `## Goal

Invite a teammate by **email**, with \`inviteMember\` sending the link. See [the spec](https://example.com/spec).

### Steps

- Model an invite as a pending membership.
- Send the link:
  - from \`apps/acme-corporation-engineering-platform/src/invites.ts\`
- [x] Write the migration
- [ ] Wire the settings row

| Step | Owner | Days |
| :--- | :---: | ---: |
| Schema | Dana | 2 |
| Mail | Sam | 1 |

\`\`\`ts
const invite = await inviteMember({ email });
\`\`\`

> Removal covers both, so nobody is left half invited.

---

Raw <b>HTML</b> stays as the words it is.`;

/** A tick that is always saved, as a plan the developer can edit answers one. */
const saved = () => Promise.resolve(true);

function MarkdownExamples(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="markdown-note" title="A note">
        <Markdown look={MARKDOWN_LOOK.NOTE} words={NOTE} />
      </CatalogSection>
      <CatalogSection id="markdown-tasks" title="A note whose tasks tick">
        <Markdown look={MARKDOWN_LOOK.NOTE} words={NOTE} onTask={saved} />
      </CatalogSection>
      <CatalogSection id="markdown-narrow" title="A narrow column">
        <div className="catalog-narrow">
          <Markdown look={MARKDOWN_LOOK.NOTE} words={NOTE} />
        </div>
      </CatalogSection>
    </>
  );
}

export const MARKDOWN_EXAMPLE: Example = {
  id: "markdown",
  title: "Markdown",
  Render: MarkdownExamples,
};
