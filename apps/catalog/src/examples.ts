import { ANCHORED_POPOVER_EXAMPLE } from "./examples/anchored-popover";
import { ARTWORK_EXAMPLE } from "./examples/artwork";
import { ATTACHMENT_CHIPS_EXAMPLE } from "./examples/attachment-chips";
import { AUTH_PAGE_EXAMPLE } from "./examples/auth-page";
import { AVATARS_EXAMPLE } from "./examples/avatars";
import { BADGES_EXAMPLE } from "./examples/badges";
import { BANNERS_EXAMPLE } from "./examples/banners";
import { BAR_ITEMS_EXAMPLE } from "./examples/bar-items";
import { BLOCK_LISTS_EXAMPLE } from "./examples/block-lists";
import { BLOCK_MENU_EXAMPLE } from "./examples/block-menu";
import { BREADCRUMBS_EXAMPLE } from "./examples/breadcrumbs";
import { BUTTONS_EXAMPLE } from "./examples/buttons";
import { CALENDAR_EXAMPLE } from "./examples/calendar";
import { CARD_PRESSES_EXAMPLE } from "./examples/card-presses";
import { CARDS_EXAMPLE } from "./examples/cards";
import { CHECKBOXES_EXAMPLE } from "./examples/checkboxes";
import { CHIPS_EXAMPLE } from "./examples/chips";
import { CHOICE_BAR_EXAMPLE } from "./examples/choice-bar";
import { CHOICE_LIST_EXAMPLE } from "./examples/choice-list";
import { COLLECTION_PAGE_EXAMPLE } from "./examples/collection-page";
import { COMBOBOX_EXAMPLE } from "./examples/combobox";
import { COMPOSER_FRAMES_EXAMPLE } from "./examples/composer-frames";
import { CONFIRM_DIALOGS_EXAMPLE } from "./examples/confirm-dialogs";
import { CORNER_COUNTS_EXAMPLE } from "./examples/corner-counts";
import { DATA_TABLE_EXAMPLE } from "./examples/data-table";
import { DETAIL_PAGE_EXAMPLE } from "./examples/detail-page";
import { DIALOGS_EXAMPLE } from "./examples/dialogs";
import { DISCLOSURES_EXAMPLE } from "./examples/disclosures";
import { DRAWER_SWIPES_EXAMPLE } from "./examples/drawer-swipes";
import { EDITABLE_DOCUMENT_EXAMPLE } from "./examples/editable-document";
import { EMPTY_STATES_EXAMPLE } from "./examples/empty-states";
import { ERROR_STATES_EXAMPLE } from "./examples/error-states";
import { FACTS_EXAMPLE } from "./examples/facts";
import { FILE_PICKERS_EXAMPLE } from "./examples/file-picker";
import { FILE_TEXT_EXAMPLE } from "./examples/file-text";
import { FOLDING_BUTTONS_EXAMPLE } from "./examples/folding-buttons";
import { FORM_FIELD_EXAMPLE } from "./examples/form-field";
import { FORM_SECTION_EXAMPLE } from "./examples/form-section";
import { FORMAT_TOOLBAR_EXAMPLE } from "./examples/format-toolbar";
import { GLYPH_SLOTS_EXAMPLE } from "./examples/glyph-slots";
import { HOVER_CARDS_EXAMPLE } from "./examples/hover-cards";
import { INLINE_EDITS_EXAMPLE } from "./examples/inline-edits";
import { INLINE_REFS_EXAMPLE } from "./examples/inline-refs";
import { KEEP_FOCUS_EXAMPLE } from "./examples/keep-focus";
import { LAYOUT_EXAMPLE } from "./examples/layout";
import { LINE_BUTTONS_EXAMPLE } from "./examples/line-buttons";
import { LINK_FIELD_EXAMPLE } from "./examples/link-field";
import { LIST_MOTION_EXAMPLE } from "./examples/list-motion";
import { LIST_ROW_EXAMPLE } from "./examples/list-row";
import { LOADING_INDICATORS_EXAMPLE } from "./examples/loading-indicators";
import { MARKDOWN_EXAMPLE } from "./examples/markdown";
import { MENU_EXAMPLE } from "./examples/menu";
import { MESSAGES_EXAMPLE } from "./examples/messages";
import { NAV_ITEMS_EXAMPLE } from "./examples/nav-items";
import { NOTE_LINES_EXAMPLE } from "./examples/note-lines";
import { ONE_LINE_EXAMPLE } from "./examples/one-line";
import { PAGE_THUMBS_EXAMPLE } from "./examples/page-thumbs";
import { PAGINATION_EXAMPLE } from "./examples/pagination";
import { PANE_PINS_EXAMPLE } from "./examples/pane-pins";
import { PICTURE_TILES_EXAMPLE } from "./examples/picture-tiles";
import { POPOVER_PANELS_EXAMPLE } from "./examples/popover-panels";
import { PORTAL_FENCE_EXAMPLE } from "./examples/portal-fence";
import { PRESS_SHORTCUTS_EXAMPLE } from "./examples/press-shortcuts";
import { PROGRESS_EXAMPLE } from "./examples/progress";
import { PROSE_EXAMPLE } from "./examples/prose";
import { PROVIDER_BUTTONS_EXAMPLE } from "./examples/provider-buttons";
import { PUBLIC_PAGE_EXAMPLE } from "./examples/public-page";
import { REMOTE_SURFACE_EXAMPLE } from "./examples/remote-surface";
import { RESIZE_CORNERS_EXAMPLE } from "./examples/resize-corners";
import { RESIZE_EDGES_EXAMPLE } from "./examples/resize-edges";
import { REVEALS_EXAMPLE } from "./examples/reveals";
import { ROLLING_NUMBER_EXAMPLE } from "./examples/rolling-number";
import { SAVED_TICKS_EXAMPLE } from "./examples/saved-ticks";
import { SCROLL_AREA_EXAMPLE } from "./examples/scroll-area";
import { SEARCH_FIELDS_EXAMPLE } from "./examples/search-fields";
import { SETTINGS_PAGE_EXAMPLE } from "./examples/settings-page";
import { SETTINGS_ROW_EXAMPLE } from "./examples/settings-row";
import { SETTINGS_SECTION_EXAMPLE } from "./examples/settings-section";
import { SHORTCUTS_EXAMPLE } from "./examples/shortcuts";
import { SKELETONS_EXAMPLE } from "./examples/skeletons";
import { SLIDER_EXAMPLE } from "./examples/slider";
import { SPINNERS_EXAMPLE } from "./examples/spinners";
import { SPLIT_BUTTONS_EXAMPLE } from "./examples/split-buttons";
import { SWATCHES_EXAMPLE } from "./examples/swatches";
import { SWITCHES_EXAMPLE } from "./examples/switches";
import { TABS_EXAMPLE } from "./examples/tabs";
import { TEXT_BUTTONS_EXAMPLE } from "./examples/text-buttons";
import { TEXT_FIELDS_EXAMPLE } from "./examples/text-fields";
import { TEXT_LINKS_EXAMPLE } from "./examples/text-links";
import { TIMES_EXAMPLE } from "./examples/times";
import { TOASTS_EXAMPLE } from "./examples/toasts";
import { TOOLTIPS_EXAMPLE } from "./examples/tooltips";
import { TYPOGRAPHY_EXAMPLE } from "./examples/typography";
import { ZOOM_IMAGES_EXAMPLE } from "./examples/zoom-images";

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
  BANNERS_EXAMPLE,
  BREADCRUMBS_EXAMPLE,
  BUTTONS_EXAMPLE,
  CALENDAR_EXAMPLE,
  CARDS_EXAMPLE,
  CARD_PRESSES_EXAMPLE,
  BLOCK_LISTS_EXAMPLE,
  COMPOSER_FRAMES_EXAMPLE,
  CHIPS_EXAMPLE,
  BAR_ITEMS_EXAMPLE,
  CHOICE_BAR_EXAMPLE,
  CHOICE_LIST_EXAMPLE,
  COLLECTION_PAGE_EXAMPLE,
  COMBOBOX_EXAMPLE,
  CONFIRM_DIALOGS_EXAMPLE,
  DATA_TABLE_EXAMPLE,
  DETAIL_PAGE_EXAMPLE,
  DIALOGS_EXAMPLE,
  DISCLOSURES_EXAMPLE,
  DRAWER_SWIPES_EXAMPLE,
  EMPTY_STATES_EXAMPLE,
  ERROR_STATES_EXAMPLE,
  FACTS_EXAMPLE,
  FILE_PICKERS_EXAMPLE,
  FILE_TEXT_EXAMPLE,
  FOLDING_BUTTONS_EXAMPLE,
  FORM_FIELD_EXAMPLE,
  FORM_SECTION_EXAMPLE,
  HOVER_CARDS_EXAMPLE,
  INLINE_EDITS_EXAMPLE,
  INLINE_REFS_EXAMPLE,
  SWATCHES_EXAMPLE,
  TEXT_BUTTONS_EXAMPLE,
  TEXT_FIELDS_EXAMPLE,
  TEXT_LINKS_EXAMPLE,
  LINE_BUTTONS_EXAMPLE,
  TOASTS_EXAMPLE,
  TOOLTIPS_EXAMPLE,
  TIMES_EXAMPLE,
  SHORTCUTS_EXAMPLE,
  CHECKBOXES_EXAMPLE,
  SWITCHES_EXAMPLE,
  TABS_EXAMPLE,
  LIST_ROW_EXAMPLE,
  LIST_MOTION_EXAMPLE,
  MENU_EXAMPLE,
  FORMAT_TOOLBAR_EXAMPLE,
  BLOCK_MENU_EXAMPLE,
  LINK_FIELD_EXAMPLE,
  NAV_ITEMS_EXAMPLE,
  NOTE_LINES_EXAMPLE,
  ONE_LINE_EXAMPLE,
  PAGINATION_EXAMPLE,
  PAGE_THUMBS_EXAMPLE,
  PICTURE_TILES_EXAMPLE,
  POPOVER_PANELS_EXAMPLE,
  PRESS_SHORTCUTS_EXAMPLE,
  PROGRESS_EXAMPLE,
  PROSE_EXAMPLE,
  PROVIDER_BUTTONS_EXAMPLE,
  ROLLING_NUMBER_EXAMPLE,
  PUBLIC_PAGE_EXAMPLE,
  SCROLL_AREA_EXAMPLE,
  SAVED_TICKS_EXAMPLE,
  SEARCH_FIELDS_EXAMPLE,
  SETTINGS_PAGE_EXAMPLE,
  SETTINGS_SECTION_EXAMPLE,
  SPINNERS_EXAMPLE,
  LOADING_INDICATORS_EXAMPLE,
  SPLIT_BUTTONS_EXAMPLE,
  SKELETONS_EXAMPLE,
  RESIZE_CORNERS_EXAMPLE,
  SLIDER_EXAMPLE,
  SETTINGS_ROW_EXAMPLE,
  AUTH_PAGE_EXAMPLE,
  GLYPH_SLOTS_EXAMPLE,
  CORNER_COUNTS_EXAMPLE,
  RESIZE_EDGES_EXAMPLE,
  REVEALS_EXAMPLE,
  ZOOM_IMAGES_EXAMPLE,
  MESSAGES_EXAMPLE,
  PANE_PINS_EXAMPLE,
  KEEP_FOCUS_EXAMPLE,
  PORTAL_FENCE_EXAMPLE,
  REMOTE_SURFACE_EXAMPLE,
  MARKDOWN_EXAMPLE,
  EDITABLE_DOCUMENT_EXAMPLE,
];
