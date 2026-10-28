/**
 * pull-request-glyph.ts -- the glyph a pull request is drawn with for where it stands, as GitHub draws it.
 *
 * One table for every mark of a pull request: its own mark wherever the
 * panel names it, and a task's status where a pull request is what its
 * agents left (`TaskAgentsMark`). An open one GitHub holds in its merge
 * queue wears the merge's glyph, said queued.
 */

import { PULL_REQUEST_STATE } from "@luke/features/agent-wire";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "../icons/icons.js";

/** What a mark is drawn for beyond where a pull request stands: an open one in the merge queue. */
export const PULL_REQUEST_MARK_QUEUED = "queued";

/** The glyph a pull request is drawn with for where it stands; a queued one wears the merge's. */
export const PULL_REQUEST_GLYPH = {
  [PULL_REQUEST_STATE.OPEN]: GitPullRequestIcon,
  [PULL_REQUEST_STATE.DRAFT]: GitPullRequestDraftIcon,
  [PULL_REQUEST_STATE.MERGED]: GitMergeIcon,
  [PULL_REQUEST_STATE.CLOSED]: GitPullRequestClosedIcon,
  [PULL_REQUEST_MARK_QUEUED]: GitMergeIcon,
} as const;
