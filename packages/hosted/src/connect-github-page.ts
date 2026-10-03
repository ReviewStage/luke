/**
 * connect-github-page.ts -- where the Connect GitHub page answers, and how the Mac names the account it expects there.
 *
 * The page is a web page, not an API: a desktop opens it in the browser,
 * where the developer's Luke session links GitHub with the `repo` scope. It
 * imports nothing, so the page's own bundle carries this and nothing else of
 * the hosted wire.
 */

export const CONNECT_GITHUB_PAGE = {
  PATH: "/connect-github.html",
  /** The Luke account id the Mac is signed in as; the page links only for that account. */
  ACCOUNT_QUERY: "account",
} as const;

/** The page on the service at `baseUrl`, naming the account the Mac is signed in as where it knows one. */
export function connectGitHubPageAddress(baseUrl: string, accountId: string | undefined): string {
  const address = new URL(CONNECT_GITHUB_PAGE.PATH, baseUrl);
  if (accountId) address.searchParams.set(CONNECT_GITHUB_PAGE.ACCOUNT_QUERY, accountId);
  return address.href;
}
