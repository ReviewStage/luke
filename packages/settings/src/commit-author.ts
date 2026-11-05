/**
 * commit-author.ts -- who authors an agent's commits and opens its pull request, and whether the other is credited as co-author.
 *
 * The developer or our GitHub App's bot authors; the other may be named in
 * a `Co-authored-by` trailer on each commit, or not at all. The choice is
 * read as an agent's first session starts and kept for the agent's life
 * (`packages/service/src/agents/coder-host/checkout.ts`). An agent an
 * automation started is the bot's whatever the choice, and one on its
 * starter's own token is theirs, since the App does not reach its
 * repository.
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";

export const COMMIT_AUTHOR = {
  /** The developer authors, the bot credited as co-author: how every agent wrote before the choice. */
  DEVELOPER_WITH_APP: "developer-with-app",
  /** The developer authors, with no co-author. */
  DEVELOPER: "developer",
  /** The bot authors, the developer credited as co-author. */
  APP_WITH_DEVELOPER: "app-with-developer",
  /** The bot authors, with no co-author. */
  APP: "app",
} as const;

export type CommitAuthor = (typeof COMMIT_AUTHOR)[keyof typeof COMMIT_AUTHOR];

export const COMMIT_AUTHOR_LIST: readonly CommitAuthor[] = Object.values(COMMIT_AUTHOR);

/** The choice an account that never chose reads as. */
export const COMMIT_AUTHOR_DEFAULT = COMMIT_AUTHOR.DEVELOPER_WITH_APP;

/** How each choice reads on its control. */
export const COMMIT_AUTHOR_LABEL = {
  [COMMIT_AUTHOR.DEVELOPER_WITH_APP]: `You, ${PRODUCT_NAME} co-author`,
  [COMMIT_AUTHOR.DEVELOPER]: "You",
  [COMMIT_AUTHOR.APP_WITH_DEVELOPER]: `${PRODUCT_NAME}, you co-author`,
  [COMMIT_AUTHOR.APP]: PRODUCT_NAME,
} as const satisfies Record<CommitAuthor, string>;

/** What the row says under its name for each choice. */
export const COMMIT_AUTHOR_DETAIL = {
  [COMMIT_AUTHOR.DEVELOPER_WITH_APP]: `Your GitHub account authors, ${PRODUCT_NAME} credited as co-author`,
  [COMMIT_AUTHOR.DEVELOPER]: "Your GitHub account authors, no co-author",
  [COMMIT_AUTHOR.APP_WITH_DEVELOPER]: `The ${PRODUCT_NAME} bot authors, you credited as co-author`,
  [COMMIT_AUTHOR.APP]: `The ${PRODUCT_NAME} bot authors, no co-author`,
} as const satisfies Record<CommitAuthor, string>;

/** Whether the choice has the bot author, so the developer's account is never asked to. */
export function appAuthors(choice: CommitAuthor): boolean {
  return choice === COMMIT_AUTHOR.APP || choice === COMMIT_AUTHOR.APP_WITH_DEVELOPER;
}

/** Whether the choice credits whoever does not author in a trailer. */
export function coAuthorCredited(choice: CommitAuthor): boolean {
  return choice === COMMIT_AUTHOR.DEVELOPER_WITH_APP || choice === COMMIT_AUTHOR.APP_WITH_DEVELOPER;
}

const readsCommitAuthor = Schema.is(Schema.Literals(COMMIT_AUTHOR_LIST));

/** Guards a choice arriving from storage or IPC. */
export function isCommitAuthor(value: UnparsedWireValue): value is CommitAuthor {
  return readsCommitAuthor(value);
}
