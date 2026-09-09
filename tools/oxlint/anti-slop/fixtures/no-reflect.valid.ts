export function callWith(render: (value: string) => string, value: string): string {
  return render(value);
}

/** The bans are `apply` and `get`; the rest of Reflect reads nothing typed. */
export function keysOf(row: Record<string, string>): readonly (string | symbol)[] {
  return Reflect.ownKeys(row);
}
