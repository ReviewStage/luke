/**
 * one-line.tsx -- words held to one line in a narrow column, ending in an
 * ellipsis and in a fade, and a short line that ends on its last letter;
 * the pointer resting on a line cut short reads it whole in a pill, the
 * catalog's own stand-in for the timing an app gives its hints.
 */

import {
  GAP,
  ONE_LINE_ELEMENT,
  ONE_LINE_END,
  OneLine,
  type OneLineHint,
  Stack,
  TooltipPill,
} from "@luke/ui";
import { type ReactNode, useId, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const ADDRESS = "sam.rivera+release-notifications@relay.example.com";

/** A pill reading `words` whole over a line, while the pointer rests on it and it is cut short. */
function PillOver({
  words,
  clipped,
  children,
}: {
  words: string;
  clipped: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | undefined>(undefined);
  return (
    <>
      <span
        className="catalog-one-line"
        onPointerEnter={(event) => setAnchor(event.currentTarget)}
        onPointerLeave={() => setAnchor(undefined)}
      >
        {children}
      </span>
      {anchor === undefined || !clipped ? null : (
        <TooltipPill id={id} anchor={anchor} instant={false} label={words} />
      )}
    </>
  );
}

/** The catalog's hint for a line saying `words`. */
function pillHint(words: string): OneLineHint {
  return (line, clipped) => (
    <PillOver words={words} clipped={clipped}>
      {line}
    </PillOver>
  );
}

function OneLines(): React.JSX.Element {
  return (
    <CatalogSection id="one-line-ends" title="Ends, in a narrow column">
      <div className="catalog-narrow">
        <Stack gap={GAP.CONTROL}>
          <OneLine hint={pillHint(ADDRESS)}>{ADDRESS}</OneLine>
          <OneLine as={ONE_LINE_ELEMENT.STRONG} end={ONE_LINE_END.FADE} hint={pillHint(ADDRESS)}>
            {ADDRESS}
          </OneLine>
          <OneLine as={ONE_LINE_ELEMENT.SMALL} hint={pillHint("sam@relay.dev")}>
            sam@relay.dev
          </OneLine>
        </Stack>
      </div>
    </CatalogSection>
  );
}

export const ONE_LINE_EXAMPLE: Example = { id: "one-line", title: "One line", Render: OneLines };
