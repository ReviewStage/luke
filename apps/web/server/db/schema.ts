// Better Auth owns its generated schema; Luke-owned tables can join this
// aggregate from their own schema modules without being overwritten by it.
export * from "./auth-schema.js";
export * from "./devices-schema.js";
export * from "./favorite-schema.js";
export * from "./preferences-schema.js";
export * from "./roster-schema.js";
export * from "./storage-schema.js";
export * from "./usage-schema.js";
export * from "./vault-schema.js";
export * from "./voice-schema.js";
export * from "./workspace-schema.js";
