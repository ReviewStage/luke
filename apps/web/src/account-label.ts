/**
 * The one line an account is named by: the provider's own name for it, or the
 * address when no name was set, so a nameless account still reads as somebody
 * rather than a blank cell.
 */
export function accountLabel(account: { name: string; email: string }): string {
  return account.name || account.email;
}
