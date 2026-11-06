declare module "virtual:site/changelog-releases" {
  const releases: readonly import("./changelog-releases").Release[];
  export default releases;
}

declare module "virtual:site/privacy-policy" {
  const policy: import("./site-markdown").Policy;
  export default policy;
}
