import { CommitCard } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * commit-cards.tsx -- a commit as the card under the command that made it:
 * a short message on a branch, and a long message on a long branch, which
 * wrap rather than cut. The commits are synthetic, as git summarizes one.
 */

const SHORT = {
  hash: "3f9c2ab",
  branch: "main",
  message: "fix(panel): keep the row's fold open",
  filesChanged: 1,
  insertions: 4,
  deletions: 2,
} as const;

const LONG = {
  hash: "a81d04e",
  branch: "luke/feat/agent-tool-cards-trial",
  message:
    "feat(ui): a test results card and a commit card under an agent's command, read from its output",
  filesChanged: 9,
  insertions: 612,
  deletions: 14,
} as const;

function CommitCardsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="commit-short" title="A short message">
        <div className="catalog-column">
          <CommitCard commit={SHORT} />
        </div>
      </CatalogSection>
      <CatalogSection id="commit-long" title="A long message on a long branch">
        <div className="catalog-column">
          <CommitCard commit={LONG} />
        </div>
      </CatalogSection>
    </>
  );
}

export const COMMIT_CARDS_EXAMPLE: Example = {
  id: "commit-cards",
  title: "Commit cards",
  Render: CommitCardsExample,
};
