/**
 * chip.tsx -- the window's chip, which is `@luke/ui`'s shared `Chip`.
 *
 * The window's callers still hand it a class of their own for their screen's
 * layout, so they reach it through the compatibility door's `CompatChip`,
 * the same control with a class beside its own; each moves onto the barrel's
 * `Chip` when its screen is migrated.
 */

export { CHIP_LOOK, type ChipLook } from "@luke/ui";
export { CompatChip as Chip } from "@luke/ui/compat";
