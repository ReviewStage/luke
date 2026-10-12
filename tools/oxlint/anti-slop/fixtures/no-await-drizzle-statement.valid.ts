interface Statement {
  readonly from: (table: string) => Statement;
  readonly where: (clause: string) => Promise<ReadonlyArray<string>>;
}
declare const db: { readonly select: () => Statement };
declare const authDatabase: { readonly select: () => Statement };
declare const run: (statement: Promise<ReadonlyArray<string>>) => Promise<ReadonlyArray<string>>;

export async function viaRunner(): Promise<ReadonlyArray<string>> {
  return await run(db.select().from("plan").where("id = 1"));
}

export async function betterAuth(): Promise<ReadonlyArray<string>> {
  return await authDatabase.select().from("user").where("id = 1");
}
