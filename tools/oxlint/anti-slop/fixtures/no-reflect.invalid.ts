export function callWith(render: (value: string) => string, value: string): string {
  return Reflect.apply(render, undefined, [value]);
}
