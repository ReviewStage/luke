import { PRODUCT_NAME } from "@repo/features/product-name";
import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";

export const COMMIT_AUTHOR = {
  DEVELOPER_WITH_APP: "developer-with-app",
  DEVELOPER: "developer",
  APP_WITH_DEVELOPER: "app-with-developer",
  APP: "app",
} as const;

export type CommitAuthor = (typeof COMMIT_AUTHOR)[keyof typeof COMMIT_AUTHOR];

export const COMMIT_AUTHOR_LIST: readonly CommitAuthor[] = Object.values(COMMIT_AUTHOR);

export const COMMIT_AUTHOR_DEFAULT = COMMIT_AUTHOR.DEVELOPER_WITH_APP;

export const COMMIT_AUTHOR_LABEL = {
  [COMMIT_AUTHOR.DEVELOPER_WITH_APP]: `You, ${PRODUCT_NAME} co-author`,
  [COMMIT_AUTHOR.DEVELOPER]: "You",
  [COMMIT_AUTHOR.APP_WITH_DEVELOPER]: `${PRODUCT_NAME}, you co-author`,
  [COMMIT_AUTHOR.APP]: PRODUCT_NAME,
} as const satisfies Record<CommitAuthor, string>;

export const COMMIT_AUTHOR_DETAIL = {
  [COMMIT_AUTHOR.DEVELOPER_WITH_APP]: `Your GitHub account authors, ${PRODUCT_NAME} credited as co-author`,
  [COMMIT_AUTHOR.DEVELOPER]: "Your GitHub account authors, no co-author",
  [COMMIT_AUTHOR.APP_WITH_DEVELOPER]: `The ${PRODUCT_NAME} bot authors, you credited as co-author`,
  [COMMIT_AUTHOR.APP]: `The ${PRODUCT_NAME} bot authors, no co-author`,
} as const satisfies Record<CommitAuthor, string>;

export function appAuthors(choice: CommitAuthor): boolean {
  return choice === COMMIT_AUTHOR.APP || choice === COMMIT_AUTHOR.APP_WITH_DEVELOPER;
}

export function coAuthorCredited(choice: CommitAuthor): boolean {
  return choice === COMMIT_AUTHOR.DEVELOPER_WITH_APP || choice === COMMIT_AUTHOR.APP_WITH_DEVELOPER;
}

const readsCommitAuthor = Schema.is(Schema.Literals(COMMIT_AUTHOR_LIST));

export function isCommitAuthor(value: UnparsedWireValue): value is CommitAuthor {
  return readsCommitAuthor(value);
}
