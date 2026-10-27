import {
  GAP,
  Inline,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  Stack,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * skeletons.tsx -- each shape, lines set in a heading's and the body's type
 * so they stand where those lines will, and a list's rows while it is read,
 * each drawn by a `*Skeleton` component, as every skeleton is.
 */

/** How wide each placeholder member's name stands. */
const MEMBER_WIDTHS = ["70%", "45%", "60%"] as const;

/** Each shape, its box the catalog's own size for it. */
function ShapesSkeleton(): React.JSX.Element {
  return (
    <Inline gap={GAP.FIELD}>
      <span className="catalog-skeleton-line">
        <Skeleton width="160px" />
      </span>
      <span className="catalog-skeleton-control">
        <Skeleton shape={SKELETON_SHAPE.CONTROL} />
      </span>
      <Skeleton shape={SKELETON_SHAPE.CIRCLE} />
      <span className="catalog-skeleton-block">
        <Skeleton shape={SKELETON_SHAPE.BLOCK} />
      </span>
    </Inline>
  );
}

/** A plan's heading over its lines, each block in the type its words will stand in. */
function PlanSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading the plan">
      <Stack gap={GAP.TIGHT}>
        <Text variant={TEXT_VARIANT.TITLE} as={TEXT_ELEMENT.DIV}>
          <Skeleton width="55%" />
        </Text>
        <Text as={TEXT_ELEMENT.DIV}>
          <Skeleton />
        </Text>
        <Text as={TEXT_ELEMENT.DIV}>
          <Skeleton width="80%" />
        </Text>
      </Stack>
    </SkeletonRegion>
  );
}

/** A list's rows while it is read, a person's circle before each name. */
function MembersSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading members">
      <Stack gap={GAP.CONTROL}>
        {MEMBER_WIDTHS.map((width) => (
          <Inline key={width} gap={GAP.ICON} wrap={false}>
            <Skeleton shape={SKELETON_SHAPE.CIRCLE} width="20px" />
            <div className="catalog-skeleton-grow">
              <Text as={TEXT_ELEMENT.DIV}>
                <Skeleton width={width} />
              </Text>
            </div>
          </Inline>
        ))}
      </Stack>
    </SkeletonRegion>
  );
}

function Skeletons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="skeleton-shapes" title="Shapes">
        <ShapesSkeleton />
      </CatalogSection>
      <CatalogSection id="skeleton-type" title="Lines in their type">
        <div className="catalog-column">
          <PlanSkeleton />
        </div>
      </CatalogSection>
      <CatalogSection id="skeleton-rows" title="A list's rows">
        <div className="catalog-narrow">
          <MembersSkeleton />
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
