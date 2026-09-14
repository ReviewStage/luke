/**
 * The scaffolding the host's own tests compose it with, behind its own door
 * so nothing that ships can reach it: `testKernelLayer`, every seam
 * `hostAssemblyLayer`/`hostStandingLayer` need over a fixture state root.
 */
export { type TestKernelOptions, testKernelLayer } from "./test-kernel.js";
