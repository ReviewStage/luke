import {
  GAP,
  Inline,
  NoRepositoryGlyph,
  RepositoryCard,
  RepositoryName,
  RepositoryPicture,
  Stack,
} from "@repo/ui";
import { repositoryLabel } from "@repo/ui/task-list-model";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

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
      <CatalogSection id="repository-glyphs" title="In a glyph's slot: picture, no repository">
        <Inline gap={GAP.CONTROL}>
          <RepositoryPicture repository="acme/relay" pictures={false} />
          <NoRepositoryGlyph />
        </Inline>
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
