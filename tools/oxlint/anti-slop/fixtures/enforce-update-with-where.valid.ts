interface Update {
  readonly set: (values: { readonly name: string }) => Update;
  readonly where: (clause: string) => Update;
}
declare const db: { readonly update: (table: string) => Update };
declare const counter: { readonly update: (by: number) => void };

export const touch = (): Update => db.update("users").set({ name: "x" }).where("id = 1");
export const bump = (): void => counter.update(1);
