import {
  PRODUCT_SETTINGS_VIEW,
  PRODUCT_VOICE_SESSION_SOURCE,
  type ProductSettingsView,
  type ProductVoiceSessionSource,
} from "@sidecar/analytics";
import { SETTINGS_PAGE, type SettingsPage, VOICE_SOURCE, type VoiceSource } from "./schema.js";

/**
 * How this package's own value sets are said in the counting vocabulary. The
 * analytics package cannot import this one — the edge would close a loop — so
 * each bridge lives here as a total `Record`, which is the whole point: a
 * third voice source or a new settings page does not build until the
 * analytics vocabulary has answered for it, rather than quietly arriving on
 * the wire under a name nothing documents.
 */

export const VOICE_SOURCE_COUNTED_AS = {
  [VOICE_SOURCE.ACCOUNT]: PRODUCT_VOICE_SESSION_SOURCE.HOSTED,
  [VOICE_SOURCE.KEY]: PRODUCT_VOICE_SESSION_SOURCE.KEYED,
} satisfies Record<VoiceSource, ProductVoiceSessionSource>;

export const SETTINGS_VIEW_COUNTED_AS = {
  [SETTINGS_PAGE.ROOT]: PRODUCT_SETTINGS_VIEW.ROOT,
  [SETTINGS_PAGE.VOICE]: PRODUCT_SETTINGS_VIEW.VOICE,
  [SETTINGS_PAGE.APPEARANCE]: PRODUCT_SETTINGS_VIEW.APPEARANCE,
  [SETTINGS_PAGE.SHORTCUTS]: PRODUCT_SETTINGS_VIEW.SHORTCUTS,
  [SETTINGS_PAGE.CONNECTIONS]: PRODUCT_SETTINGS_VIEW.CONNECTIONS,
} satisfies Record<SettingsPage, ProductSettingsView>;
