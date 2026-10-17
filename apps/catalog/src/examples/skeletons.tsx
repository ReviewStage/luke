import {
  GAP,
  Inline,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  Stack,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * skeletons.tsx -- each shape, lines set in a heading's and the body's type
 * so they stand where those lines will, and a list's rows while it is read.
 */

function Skeletons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="skeleton-shapes" title="Shapes">
        <Inline gap={GAP.FIELD} align="center">
          <span className="catalog-skeleton-line">
            <Skeleton width="160px" />
          </span>
          <span className="catalog-skeleton-control">
            <Skeleton shape={SKELETON_SHAPE.CONTROL} />
          </span>
          <Skeleton shape={SKELETON_SHAPE.CIRCLE} />
        </Inline>
      </CatalogSection>
      <CatalogSection id="skeleton-type" title="Lines in their type">
        <div className="catalog-column">
          <SkeletonRegion label="Reading the plan">
            <Stack gap={GAP.TIGHT}>
              <Text variant={TEXT_VARIANT.TITLE} as="div">
                <Skeleton width="55%" />
              </Text>
              <Text as="div">
                <Skeleton />
              </Text>
              <Text as="div">
                <Skeleton width="80%" />
              </Text>
            </Stack>
          </SkeletonRegion>
        </div>
      </CatalogSection>
      <CatalogSection id="skeleton-rows" title="A list's rows">
        <div className="catalog-narrow">
          <SkeletonRegion label="Reading members">
            <Stack gap={GAP.CONTROL}>
              {["70%", "45%", "60%"].map((width) => (
                <Inline key={width} gap={GAP.ICON} wrap={false}>
                  <Skeleton shape={SKELETON_SHAPE.CIRCLE} width="20px" />
                  <div className="catalog-grow">
                    <Text as="div">
                      <Skeleton width={width} />
                    </Text>
                  </div>
                </Inline>
              ))}
            </Stack>
          </SkeletonRegion>
        </div>
      </CatalogSection>
    </>
  );
}

export const SKELETONS_EXAMPLE: Example = {
  id: "skeletons",
  title: "Skeletons",
  Render: Skeletons,
};
