/**
 * index.ts -- the client half of our sync engine: the pool of rows every read
 * draws from, the writes drawn over it, the collection only sync writes that
 * holds each kind's rows, and the door a row write's method is served
 * through. It names no entity kind; each is declared by its client. The
 * barrel is one door per module rather than a second list to forget a name
 * in.
 */
export * from "./door.js";
export * from "./entity-pool.js";
export * from "./synced-collection.js";
