interface Update {
  readonly set: (values: { readonly name: string }) => Update;
  readonly where: (clause: string) => Update;
}
declare const db: { readonly update: (table: string) => Update };

export const touchAll = (): Update => db.update("users").set({ name: "x" });
