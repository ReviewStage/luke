/**
 * compat.ts -- the compatibility door: twins of shared controls that still
 * take a class of their own, for the callers written before the controls
 * were shared.
 *
 * Each twin draws the barrel control's own markup and stylesheet, and adds
 * the caller's class beside it. New code imports the barrel, never this
 * door: a caller moves off it when its screen is migrated, and the door is
 * deleted when the last one has.
 */

export { ChipFrame as CompatChip } from "./components/chip/chip-frame.js";
export {
  SkeletonFrame as CompatSkeleton,
  SkeletonRegionFrame as CompatSkeletonRegion,
} from "./components/skeleton/skeleton-frame.js";
export {
  SwitchButtonFrame as CompatSwitchButton,
  SwitchMarkFrame as CompatSwitchMark,
} from "./components/switch/switch-frame.js";
