import type { AccountTokens } from "./account-client";

/** Ensures credentials rejected before sign-in completes do not outlive the failed attempt. */
export async function withIssuedAccountTokens<T>(options: {
  issue: () => Promise<AccountTokens>;
  use: (tokens: AccountTokens) => Promise<T>;
  revoke: (refreshToken: string) => Promise<void>;
  onRevokeFailure?: (error: unknown) => void;
}): Promise<T> {
  const tokens = await options.issue();
  try {
    return await options.use(tokens);
  } catch (error) {
    await options.revoke(tokens.refreshToken).catch((revokeError) => {
      options.onRevokeFailure?.(revokeError);
    });
    throw error;
  }
}
