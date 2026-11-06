import { PRODUCT_NAME } from "@repo/features/product-name";
import { accountPageHref } from "@repo/panel/admin/routing";
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { PANEL_PATH } from "./app/web-address";

export const authClient = createAuthClient({ plugins: [adminClient()] });

const REFUSED_WORDS = {
  IMPERSONATE: `Couldn't sign in as this account. Try again.`,
  STOP: `Couldn't return to your own ${PRODUCT_NAME} account. Try again.`,
} as const;

function refusalWords(error: { message?: string | undefined }, fallback: string): string {
  return error.message !== undefined && error.message.length > 0 ? error.message : fallback;
}

export async function impersonate(userId: string): Promise<string | undefined> {
  const { error } = await authClient.admin.impersonateUser({ userId });
  if (error) return refusalWords(error, REFUSED_WORDS.IMPERSONATE);
  window.location.assign(PANEL_PATH);
  return undefined;
}

export async function stopImpersonating(memberId: string): Promise<string | undefined> {
  const { error } = await authClient.admin.stopImpersonating();
  if (error) return refusalWords(error, REFUSED_WORDS.STOP);
  window.location.assign(accountPageHref(memberId));
  return undefined;
}
