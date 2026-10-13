interface Deletion {
  readonly returning: () => string;
  readonly where: (clause: string) => Deletion;
}
declare const db: { readonly delete: (table: string) => Deletion };
declare const cache: { readonly delete: (key: string) => boolean };

export const remove = (): Deletion => db.delete("users").where("id = 1");
export const removeReturning = (): string => db.delete("users").where("id = 1").returning();
export const evict = (): boolean => cache.delete("key");
