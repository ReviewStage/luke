import { ARTWORK_EXAMPLE } from "./examples/artwork";
import { LAYOUT_EXAMPLE } from "./examples/layout";
import { TYPOGRAPHY_EXAMPLE } from "./examples/typography";

/**
 * examples.ts -- every example the catalog draws, in the order its index lists them.
 *
 * An example is one component, or one family, drawn on synthetic data in
 * each state a reader or a test needs to see. The PR that adds a shared
 * component adds its example here in the same change.
 */

/** One entry of the index: its address, its heading, and what it draws. */
export interface Example {
  readonly id: string;
  readonly title: string;
  readonly Render: () => React.JSX.Element;
}

export const EXAMPLES: readonly Example[] = [ARTWORK_EXAMPLE, TYPOGRAPHY_EXAMPLE, LAYOUT_EXAMPLE];
