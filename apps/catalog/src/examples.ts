import { ANCHORED_POPOVER_EXAMPLE } from "./examples/anchored-popover";
import { ARTWORK_EXAMPLE } from "./examples/artwork";
import { ATTACHMENT_CHIPS_EXAMPLE } from "./examples/attachment-chips";
import { AUTH_PAGE_EXAMPLE } from "./examples/auth-page";
import { AVATARS_EXAMPLE } from "./examples/avatars";
import { BADGES_EXAMPLE } from "./examples/badges";
import { BREADCRUMBS_EXAMPLE } from "./examples/breadcrumbs";
import { BUTTONS_EXAMPLE } from "./examples/buttons";
import { CARDS_EXAMPLE } from "./examples/cards";
import { CHECKBOXES_EXAMPLE } from "./examples/checkboxes";
import { CHIPS_EXAMPLE } from "./examples/chips";
import { COLLECTION_PAGE_EXAMPLE } from "./examples/collection-page";
import { COMBOBOX_EXAMPLE } from "./examples/combobox";
import { CONFIRM_DIALOGS_EXAMPLE } from "./examples/confirm-dialogs";
import { DATA_TABLE_EXAMPLE } from "./examples/data-table";
import { DETAIL_PAGE_EXAMPLE } from "./examples/detail-page";
import { DIALOGS_EXAMPLE } from "./examples/dialogs";
import { DISCLOSURES_EXAMPLE } from "./examples/disclosures";
import { EMPTY_STATES_EXAMPLE } from "./examples/empty-states";
import { ERROR_STATES_EXAMPLE } from "./examples/error-states";
import { FOLDING_BUTTONS_EXAMPLE } from "./examples/folding-buttons";
import { FORM_FIELD_EXAMPLE } from "./examples/form-field";
import { FORM_SECTION_EXAMPLE } from "./examples/form-section";
import { HOVER_CARDS_EXAMPLE } from "./examples/hover-cards";
import { INLINE_EDITS_EXAMPLE } from "./examples/inline-edits";
import { INLINE_REFS_EXAMPLE } from "./examples/inline-refs";
import { LAYOUT_EXAMPLE } from "./examples/layout";
import { LIST_ROW_EXAMPLE } from "./examples/list-row";
import { MENU_EXAMPLE } from "./examples/menu";
import { PAGINATION_EXAMPLE } from "./examples/pagination";
import { POPOVER_PANELS_EXAMPLE } from "./examples/popover-panels";
import { PROSE_EXAMPLE } from "./examples/prose";
import { PUBLIC_PAGE_EXAMPLE } from "./examples/public-page";
import { SEARCH_FIELDS_EXAMPLE } from "./examples/search-fields";
import { SEGMENTED_EXAMPLE } from "./examples/segmented";
import { SELECT_EXAMPLE } from "./examples/select";
import { SETTINGS_PAGE_EXAMPLE } from "./examples/settings-page";
import { SETTINGS_ROW_EXAMPLE } from "./examples/settings-row";
import { SETTINGS_SECTION_EXAMPLE } from "./examples/settings-section";
import { SKELETONS_EXAMPLE } from "./examples/skeletons";
import { SPINNERS_EXAMPLE } from "./examples/spinners";
import { SPLIT_BUTTONS_EXAMPLE } from "./examples/split-buttons";
import { SWITCHES_EXAMPLE } from "./examples/switches";
import { TABS_EXAMPLE } from "./examples/tabs";
import { TEXT_FIELDS_EXAMPLE } from "./examples/text-fields";
import { TEXT_LINKS_EXAMPLE } from "./examples/text-links";
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
  ANCHORED_POPOVER_EXAMPLE,
  TYPOGRAPHY_EXAMPLE,
  LAYOUT_EXAMPLE,
  ATTACHMENT_CHIPS_EXAMPLE,
  AVATARS_EXAMPLE,
  BADGES_EXAMPLE,
  BREADCRUMBS_EXAMPLE,
  BUTTONS_EXAMPLE,
  CARDS_EXAMPLE,
  CHIPS_EXAMPLE,
  COLLECTION_PAGE_EXAMPLE,
  COMBOBOX_EXAMPLE,
  CONFIRM_DIALOGS_EXAMPLE,
  DATA_TABLE_EXAMPLE,
  DETAIL_PAGE_EXAMPLE,
  DIALOGS_EXAMPLE,
  DISCLOSURES_EXAMPLE,
  EMPTY_STATES_EXAMPLE,
  ERROR_STATES_EXAMPLE,
  FOLDING_BUTTONS_EXAMPLE,
  FORM_FIELD_EXAMPLE,
  FORM_SECTION_EXAMPLE,
  HOVER_CARDS_EXAMPLE,
  INLINE_EDITS_EXAMPLE,
  INLINE_REFS_EXAMPLE,
  TEXT_FIELDS_EXAMPLE,
  TEXT_LINKS_EXAMPLE,
  TOOLTIPS_EXAMPLE,
  CHECKBOXES_EXAMPLE,
  SWITCHES_EXAMPLE,
  TABS_EXAMPLE,
  LIST_ROW_EXAMPLE,
  MENU_EXAMPLE,
  PAGINATION_EXAMPLE,
  POPOVER_PANELS_EXAMPLE,
  PROSE_EXAMPLE,
  PUBLIC_PAGE_EXAMPLE,
  SEARCH_FIELDS_EXAMPLE,
  SEGMENTED_EXAMPLE,
  SELECT_EXAMPLE,
  SETTINGS_PAGE_EXAMPLE,
  SETTINGS_SECTION_EXAMPLE,
  SPINNERS_EXAMPLE,
  SPLIT_BUTTONS_EXAMPLE,
  SKELETONS_EXAMPLE,
  SETTINGS_ROW_EXAMPLE,
  AUTH_PAGE_EXAMPLE,
];
