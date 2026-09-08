export function callWith(render: (value: string) => string, value: string): string {
  return render(value);
}
