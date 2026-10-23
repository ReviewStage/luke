import { FILE_TEXT_EXTENT, FileText } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * file-text.tsx -- a file's words as written: a skill's SKILL.md whole,
 * scrolling past its reading height, and a peek of pasted text faded at
 * its foot.
 */

const SKILL = `---
name: grill-me
description: Interview the user relentlessly about a plan or design until it holds up.
---

# Grill me

Ask one question at a time, and wait for the answer before the next.

1. Restate the plan in one paragraph.
2. Find the decision it rests on that nobody has made yet.
3. Ask about that, and only that.

When the plan holds up, hand off to the \`grilling\` skill, which runs the interview
in full and writes down what was decided. Keep going until there is nothing left
to ask, then say so plainly.

- Never answer your own question.
- Never ask two at once.
- A long line wraps rather than running sideways off the edge of the well, however long it is, so nothing hides past the right edge.
`;

function FileTextExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="file-text-whole" title="The whole file, scrolling in place">
        <div className="catalog-column">
          <FileText text={SKILL} label="grill-me's SKILL.md" />
        </div>
      </CatalogSection>
      <CatalogSection id="file-text-peek" title="A peek of its head">
        <div className="catalog-column">
          <FileText text={SKILL} label="Pasted text" extent={FILE_TEXT_EXTENT.PEEK} />
        </div>
      </CatalogSection>
    </>
  );
}

export const FILE_TEXT_EXAMPLE: Example = {
  id: "file-text",
  title: "File text",
  Render: FileTextExample,
};
