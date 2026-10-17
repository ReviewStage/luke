/**
 * node.ts -- the credentials' Node-only door: the loopback consent, which binds a `node:http` listener, kept out of the main barrel so it loads in a browser.
 *
 * A Node process that composes the host hands this to it as the sign-in seam.
 */
export { loopbackConsent } from "./loopback-consent.js";
