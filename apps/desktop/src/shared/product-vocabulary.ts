import {
  PRODUCT_CONNECTION_ID,
  PRODUCT_CREDENTIAL_SOURCE,
  PRODUCT_EVENT,
  PRODUCT_SETTINGS_VIEW,
  PRODUCT_SUPERSET_ACT,
  type ProductConnectionId,
  type ProductCredentialSource,
  type ProductSettingsView,
  type ProductSupersetAct,
} from "@sidecar/analytics";
import { SIGN_IN_EDGE, type SignInEdge } from "@sidecar/credentials/interactive-sign-in";
import { CREDENTIAL_PROVIDER_ID, type CredentialProviderId } from "@sidecar/credentials/vocabulary";
import {
  SETTINGS_PAGE,
  type SettingsPage,
  VOICE_SOURCE,
  type VoiceSource,
} from "@sidecar/settings";

/**
 * How the desktop's own value sets are said in the counting vocabulary. Each
 * bridge is a total `Record`, which is the whole point: a new credential
 * provider, a third voice source, or a new settings page does not build until
 * the analytics vocabulary in `@sidecar/analytics` has answered for it, rather
 * than quietly arriving on the wire under a name nothing documents.
 */

export const CONNECTION_COUNTED_AS = {
  [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: PRODUCT_CONNECTION_ID.CONDUCTOR,
  [CREDENTIAL_PROVIDER_ID.LINEAR]: PRODUCT_CONNECTION_ID.LINEAR,
  [CREDENTIAL_PROVIDER_ID.OPENAI]: PRODUCT_CONNECTION_ID.OPENAI,
} satisfies Record<CredentialProviderId, ProductConnectionId>;

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

/**
 * How the edges of Superset's CLI sign-in are counted. Total over the edge
 * set, so the generic sign-in handler never composes an event name or value:
 * it hands the row an edge and the row's closure reads this table.
 */
export const SUPERSET_SIGN_IN_COUNTED_AS = {
  [SIGN_IN_EDGE.START]: PRODUCT_SUPERSET_ACT.SIGN_IN_START,
  [SIGN_IN_EDGE.COMPLETE]: PRODUCT_SUPERSET_ACT.SIGN_IN_COMPLETE,
  [SIGN_IN_EDGE.CANCEL]: PRODUCT_SUPERSET_ACT.SIGN_IN_CANCEL,
  [SIGN_IN_EDGE.DISCONNECT]: PRODUCT_SUPERSET_ACT.DISCONNECT,
} satisfies Record<SignInEdge, ProductSupersetAct>;

type TrackerSignInEvent =
  | typeof PRODUCT_EVENT.TRACKER_CONNECT
  | typeof PRODUCT_EVENT.TRACKER_DISCONNECT;

/**
 * How the edges of a tracker's consent sign-in are counted: only the grant
 * landing and the disconnect, because the consent page is the tracker's own
 * and a start or a cancel there is nothing Luke can see.
 */
export const TRACKER_SIGN_IN_COUNTED_AS = {
  [SIGN_IN_EDGE.START]: undefined,
  [SIGN_IN_EDGE.COMPLETE]: PRODUCT_EVENT.TRACKER_CONNECT,
  [SIGN_IN_EDGE.CANCEL]: undefined,
  [SIGN_IN_EDGE.DISCONNECT]: PRODUCT_EVENT.TRACKER_DISCONNECT,
} satisfies Record<SignInEdge, TrackerSignInEvent | undefined>;
