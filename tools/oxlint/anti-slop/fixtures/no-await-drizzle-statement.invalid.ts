interface Statement {
  readonly from: (table: string) => Statement;
  readonly where: (clause: string) => Promise<ReadonlyArray<string>>;
}
declare const db: { readonly select: () => Statement };

export async function rows(): Promise<ReadonlyArray<string>> {
  return await db.select().from("plan").where("id = 1");
}

export function later(): Promise<number> {
  return db
    .select()
    .from("plan")
    .where("id = 1")
    .then((found) => found.length);
}
