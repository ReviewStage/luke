/**
 * auth-client.ts -- the web pages' Better Auth client under the session cookie, with the admin plugin's client, and a maintainer's sign-in as a member begun and ended through it.
 *
 * The admin dashboard reads its session here, and starts a sign-in as a
 * member from an account's page; any web page, the app's and the
 * dashboard's refusal alike, ends it. Either answers the service's own
 * words where it refused, such as a member whose grant of support access
 * does not stand, and otherwise leaves the page: for the app as the member,
 * or for that member's page of the dashboard as the maintainer again.
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import { accountPageHref } from "@repo/panel/admin/routing";
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { PANEL_PATH } from "./app/web-address";

export const authClient = createAuthClient({ plugins: [adminClient()] });

/** What a refused step says where the service answered no words of its own. */
const REFUSED_WORDS = {
  IMPERSONATE: `Couldn't sign in as this account. Try again.`,
  STOP: `Couldn't return to your own ${PRODUCT_NAME} account. Try again.`,
} as const;

/** The service's own words for a refusal, or the step's where it gave none. */
function refusalWords(error: { message?: string | undefined }, fallback: string): string {
  return error.message !== undefined && error.message.length > 0 ? error.message : fallback;
}

/** Signs the maintainer in as the member for an hour and opens the app as them; why not, where refused. */
export async function impersonate(userId: string): Promise<string | undefined> {
  const { error } = await authClient.admin.impersonateUser({ userId });
  if (error) return refusalWords(error, REFUSED_WORDS.IMPERSONATE);
  window.location.assign(PANEL_PATH);
  return undefined;
}

/** Ends the sign-in as the member and opens their page of the dashboard as the maintainer; why not, where refused. */
export async function stopImpersonating(memberId: string): Promise<string | undefined> {
  const { error } = await authClient.admin.stopImpersonating();
  if (error) return refusalWords(error, REFUSED_WORDS.STOP);
  window.location.assign(accountPageHref(memberId));
  return undefined;
}
