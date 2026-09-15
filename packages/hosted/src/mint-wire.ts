/**
 * What the two legacy mint endpoints answer: one ephemeral Realtime
 * credential and the allowance it was spent against. The installed desktops
 * of earlier releases are the last readers, through `/api/voice/mint` and
 * `/api/voice/introduction-mint`; the phone and the watch moved onto the
 * hosted exchange (LUKE-216, LUKE-224) and the context fields their own mint
 * answered went with LUKE-219. Nothing in this repository reads such an
 * answer back any more, so what is left is the one address the service writes
 * into the answer it mints.
 */

/**
 * The build-pinned WebSocket base URL for OpenAI Realtime. The full endpoint
 * appends ?model=<model>. No current client opens the WebSocket, but the
 * field is part of the answer the installed desktops' mint records, so it
 * stays with that mint.
 */
export const HOSTED_WS_BASE_URL = "wss://api.openai.com/v1/realtime";
