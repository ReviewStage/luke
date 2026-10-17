import { ARTWORK_EXAMPLE } from "./examples/artwork";
import { AUTH_PAGE_EXAMPLE } from "./examples/auth-page";
import { BADGES_EXAMPLE } from "./examples/badges";
import { BUTTONS_EXAMPLE } from "./examples/buttons";
import { CHECKBOXES_EXAMPLE } from "./examples/checkboxes";
import { CHIPS_EXAMPLE } from "./examples/chips";
import { DIALOGS_EXAMPLE } from "./examples/dialogs";
import { FORM_FIELD_EXAMPLE } from "./examples/form-field";
import { HOVER_CARDS_EXAMPLE } from "./examples/hover-cards";
import { LAYOUT_EXAMPLE } from "./examples/layout";
import { SEGMENTED_EXAMPLE } from "./examples/segmented";
import { SETTINGS_ROW_EXAMPLE } from "./examples/settings-row";
import { SKELETONS_EXAMPLE } from "./examples/skeletons";
import { SPINNERS_EXAMPLE } from "./examples/spinners";
import { SWITCHES_EXAMPLE } from "./examples/switches";
import { TEXT_FIELDS_EXAMPLE } from "./examples/text-fields";
import { TOOLTIPS_EXAMPLE } from "./examples/tooltips";
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

export const EXAMPLES: readonly Example[] = [
  ARTWORK_EXAMPLE,
  TYPOGRAPHY_EXAMPLE,
  LAYOUT_EXAMPLE,
  BADGES_EXAMPLE,
  BUTTONS_EXAMPLE,
  CHIPS_EXAMPLE,
  DIALOGS_EXAMPLE,
  FORM_FIELD_EXAMPLE,
  HOVER_CARDS_EXAMPLE,
  TEXT_FIELDS_EXAMPLE,
  TOOLTIPS_EXAMPLE,
  CHECKBOXES_EXAMPLE,
  SWITCHES_EXAMPLE,
  SEGMENTED_EXAMPLE,
  SPINNERS_EXAMPLE,
  SKELETONS_EXAMPLE,
  SETTINGS_ROW_EXAMPLE,
  AUTH_PAGE_EXAMPLE,
];
