/**
 * The one calendar integration's identity, named apart from the credential
 * registry: Google Calendar connects by signing in rather than by a pasted
 * key, holds several accounts at once, and is offered only in a build that
 * carries an OAuth client — none of which the per-provider key machinery
 * models. The id is what the mark registry and the settings block share.
 */
export const GOOGLE_CALENDAR_ID = "google-calendar";

export const GOOGLE_CALENDAR_NAME = "Google Calendar";
