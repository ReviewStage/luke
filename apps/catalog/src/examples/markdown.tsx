import { MARKDOWN_LOOK, Markdown, TaskBox, type TaskBoxItem } from "@repo/ui/markdown";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

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

function SavedTaskBox({ label, checked }: TaskBoxItem): React.JSX.Element {
  const [asked, setAsked] = useState<boolean | undefined>(undefined);
  return <TaskBox label={label} checked={checked} write={{ run: setAsked, asked }} />;
}

const savedTaskBox = (item: TaskBoxItem) => <SavedTaskBox {...item} />;

function MarkdownExamples(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="markdown-note" title="A note">
        <Markdown look={MARKDOWN_LOOK.NOTE} words={NOTE} />
      </CatalogSection>
      <CatalogSection id="markdown-tasks" title="A note whose tasks tick">
        <Markdown look={MARKDOWN_LOOK.NOTE} words={NOTE} taskBox={savedTaskBox} />
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
