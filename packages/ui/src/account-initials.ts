export function accountLabel(account: { name: string; email: string }): string {
  const name = account.name.trim();
  return name || account.email;
}
