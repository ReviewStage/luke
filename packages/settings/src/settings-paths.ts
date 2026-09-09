/**
 * Where a setting is changed by hand, said once.
 *
 * These phrases are read out: a guide entry's `manual` path and the facts
 * Luke states about the same surface both quote them, and each file kept its
 * own copy of the ones it needed until they were collected here. A path that
 * named the panel one way in a setting and another in a fact would have Luke
 * give two directions to one row.
 */

/** Where the switches live, said once so every entry words it the same way. */
export const SETTINGS_TAB = "the panel's Settings tab";

export const VOICE_PAGE = `${SETTINGS_TAB}, on its Voice page`;
/** Where the hosted account and OpenAI key choices both live. */
export const VOICE_SOURCE_SECTION = `${VOICE_PAGE}, in the Provider section after Permissions`;
export const APPEARANCE_PAGE = `${SETTINGS_TAB}, on its Appearance page`;
export const SHORTCUTS_PAGE = `${SETTINGS_TAB}, on its Keyboard shortcuts page`;
export const CONNECTIONS_PAGE = `${SETTINGS_TAB}, on its Connections page`;
/** Where the Updates section stands, for the fact about it. */
export const FRONT_PAGE = `${SETTINGS_TAB}, on its front page`;
/** Where the signed-in identity and the two ways out of it live. */
export const ACCOUNT_SECTION = `the Account section, at the foot of ${SETTINGS_TAB}'s front page`;
export const CONDUCTOR_ROW_PATH = `the Conductor row under Providers, in ${CONNECTIONS_PAGE} — drawn once Conductor is connected`;

/**
 * The word both Conductor agent entries use for no choice at all. It is a
 * member of their choices on purpose: saying it is how a spoken ask returns a
 * half to Conductor's own default.
 */
export const CONDUCTOR_DEFAULT_CHOICE = "Conductor's default";
export const ASK_EACH_TIME_CHOICE = "ask each time";
