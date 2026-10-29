/**
 * spring-motion.ts -- the door to the Motion trial: springs that carry a gesture's speed, a card opening into its detail, and a notice flung away, all timed by the tokens.
 *
 * Motion is a heavy library, so it reaches only a bundle that imports this
 * door, never the barrel's callers.
 */

export * from "./expanding-cards.js";
export * from "./fling-stack.js";
export * from "./token-spring.js";
