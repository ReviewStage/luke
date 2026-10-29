import { TestResultsCard } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * test-results-cards.tsx -- a test run as the card under the command that
 * ran it: every test passed; some failed, each named with its error's first
 * line, beside a skip; and more failures than the card names, the rest
 * counted. The runs are synthetic, as a runner's summary reads them.
 */

const GREEN = {
  passed: 42,
  failed: 0,
  skipped: 0,
  durationMs: 812,
  failures: [],
} as const;

const SOME_FAILED = {
  passed: 6,
  failed: 2,
  skipped: 1,
  durationMs: 1810,
  failures: [
    {
      name: "src/parser.test.ts > parser > reads jest",
      error: "AssertionError: expected 1 to be 2 // Object.is equality",
    },
    {
      name: "src/parser.test.ts > parser > reads go test -v",
      error: "TypeError: Cannot read properties of undefined (reading 'name')",
    },
  ],
} as const;

const MANY_FAILED = {
  passed: 120,
  failed: 8,
  skipped: 4,
  durationMs: 72_400,
  failures: Array.from({ length: 8 }, (_, at) => ({
    name: `tests/test_rows.py::test_row_${at + 1}`,
    error: `assert ${at + 1} == ${at + 2}`,
  })),
} as const;

function TestResultsCardsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="test-results-green" title="Every test passed">
        <div className="catalog-column">
          <TestResultsCard run={GREEN} />
        </div>
      </CatalogSection>
      <CatalogSection id="test-results-failed" title="Some failed, one skipped">
        <div className="catalog-column">
          <TestResultsCard run={SOME_FAILED} />
        </div>
      </CatalogSection>
      <CatalogSection id="test-results-many" title="More failures than the card names">
        <div className="catalog-column">
          <TestResultsCard run={MANY_FAILED} />
        </div>
      </CatalogSection>
    </>
  );
}

export const TEST_RESULTS_CARDS_EXAMPLE: Example = {
  id: "test-results-cards",
  title: "Test results cards",
  Render: TestResultsCardsExample,
};
