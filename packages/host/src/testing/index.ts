/**
 * The scaffolding the host's own tests compose it with, behind its own door
 * so nothing that ships can reach it: the whole brain composition with only
 * the model synthetic, and `testKernelLayer`, every seam
 * `hostAssemblyLayer`/`hostStandingLayer` need over a fixture state root.
 */
export { answerOf, brainHarness, heldModel } from "./brain-harness.js";
export { type TestKernelOptions, testKernelLayer } from "./test-kernel.js";
