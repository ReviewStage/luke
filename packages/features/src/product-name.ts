/**
 * product-name.ts -- the product's name, spelled here and nowhere else.
 *
 * Every string that says the name reads it from here, so a rename is this
 * constant (`anti-slop/no-product-name` refuses a spelling anywhere else). It
 * imports nothing, so any module may read it without closing a cycle.
 */

/** The product's own name, as its windows, its tools, its own messages, and a mention of it are named. */
export const PRODUCT_NAME = "Fullspin";
