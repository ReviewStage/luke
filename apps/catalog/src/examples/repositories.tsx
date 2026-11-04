/**
 * repositories.tsx -- a repository as every surface names it: its owner's
 * picture, then its name; `owner/name` where another in the view shares the
 * name; no repository's crossed-out folder; a picture that cannot be drawn
 * standing as the repository's glyph; and its card, the owner under the
 * name. The catalog draws no owners' pictures, which
 * it would ask of the network, so each picture stands as the glyph.
 */

import { GAP, RepositoryCard, RepositoryName, Stack } from "@repo/ui";
import { repositoryLabel } from "@repo/ui/task-list-model";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** The repositories one view names, two of which share a name. */
const VIEW = [
  { repository: "acme/relay" },
  { repository: "acme/site" },
  { repository: "labs/site" },
  { repository: null },
] as const;

function Repositories(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="repository-names" title="Named in a line, in a narrow column">
        <div className="catalog-narrow">
          <Stack gap={GAP.CONTROL}>
            {VIEW.map(({ repository }) => (
              <RepositoryName
                key={repository ?? "none"}
                repository={repository}
                label={repository === null ? undefined : repositoryLabel(repository, VIEW)}
                pictures={false}
              />
            ))}
            <RepositoryName
              repository="acme/release-notifications-for-every-workspace"
              pictures={false}
            />
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="repository-card" title="Card">
        <RepositoryCard repository="acme/relay" pictures={false} />
      </CatalogSection>
    </>
  );
}

export const REPOSITORIES_EXAMPLE: Example = {
  id: "repositories",
  title: "Repositories",
  Render: Repositories,
};
