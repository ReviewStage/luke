// Better Auth owns its generated schema; Luke-owned tables can join this
// aggregate from their own schema modules without being overwritten by it.
export * from "./auth-schema.js";
export * from "./favorite-schema.js";
export * from "./usage-schema.js";
export * from "./vault-schema.js";
