import {
  PRODUCT_CREDENTIAL_SOURCE,
  PRODUCT_SETTINGS_VIEW,
  type ProductCredentialSource,
  type ProductSettingsView,
} from "@sidecar/analytics";
import {
  SETTINGS_PAGE,
  type SettingsPage,
  VOICE_SOURCE,
  type VoiceSource,
} from "@sidecar/settings";

/**
 * How the desktop's own value sets are said in the counting vocabulary. Each
 * bridge is a total `Record`, which is the whole point: a third voice source
 * or a new settings page does not build until the analytics vocabulary in
 * `@sidecar/analytics` has answered for it, rather than quietly arriving on
 * the wire under a name nothing documents.
 */

export const VOICE_SOURCE_COUNTED_AS = {
  [VOICE_SOURCE.ACCOUNT]: PRODUCT_CREDENTIAL_SOURCE.ACCOUNT,
  [VOICE_SOURCE.KEY]: PRODUCT_CREDENTIAL_SOURCE.KEY,
} satisfies Record<VoiceSource, ProductCredentialSource>;

export const SETTINGS_VIEW_COUNTED_AS = {
  [SETTINGS_PAGE.ROOT]: PRODUCT_SETTINGS_VIEW.ROOT,
  [SETTINGS_PAGE.VOICE]: PRODUCT_SETTINGS_VIEW.VOICE,
  [SETTINGS_PAGE.APPEARANCE]: PRODUCT_SETTINGS_VIEW.APPEARANCE,
  [SETTINGS_PAGE.SHORTCUTS]: PRODUCT_SETTINGS_VIEW.SHORTCUTS,
  [SETTINGS_PAGE.CONNECTIONS]: PRODUCT_SETTINGS_VIEW.CONNECTIONS,
} satisfies Record<SettingsPage, ProductSettingsView>;
