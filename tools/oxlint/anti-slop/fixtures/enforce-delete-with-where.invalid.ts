interface Deletion {
  readonly returning: () => string;
  readonly where: (clause: string) => Deletion;
}
declare const db: { readonly delete: (table: string) => Deletion };

export const purge = (): Deletion => db.delete("users");
export const purgeReturning = (): string => db.delete("users").returning();
