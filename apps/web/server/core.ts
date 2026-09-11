/**
 * The one re-export surface server code reaches the workspace packages through.
 *
 * The action table and the session package both name the action vocabulary: the
 * table's is the whole of it and the session package's is the advertised
 * subset of the same strings, proven identical where the table declares it. A
 * star export from two doors carries neither, so the whole one is named here.
 */
export * from "@sidecar/actions";
/** @public No file imports the type by name, but without this door the two star exports collide on it. */
export { ACTION_KIND, type ActionKind } from "@sidecar/actions";
export * from "@sidecar/analytics";
export * from "@sidecar/brain";
export * from "@sidecar/brain/store-shapes";
export * from "@sidecar/hosted";
export * from "@sidecar/runtime/vocabulary";
export * from "@sidecar/session";
export * from "@sidecar/session/ui-messages";
export * from "@sidecar/wire";
