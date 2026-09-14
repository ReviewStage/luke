/**
 * What remains of the hosted brain contract the desktop's brain once spoke
 * to this service over (`/api/brain/v2/*`, deleted with the Mac-side brain,
 * LUKE-206): the output ceiling a brain turn is asked for, which the hosted
 * brain host's defaults still read. Everything else the contract fixed — the
 * operations, the prompt envelope, the tool catalog admission, the input
 * allowlist, and the capabilities a desktop read before sending — went with
 * the relay that enforced it.
 */

/** What the service fixes for one inference. */
export const HOSTED_BRAIN_OPTION_BOUNDS = {
  MAXIMUM_OUTPUT_TOKENS: 16_000,
} as const;
