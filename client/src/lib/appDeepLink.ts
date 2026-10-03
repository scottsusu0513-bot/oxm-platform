/** App OAuth callback 只接受 oxm://oauth/callback（Batch 3.12：完整比對 scheme／host／path）。 */
export function isAppOAuthCallbackUrl(url: URL): boolean {
  return url.protocol === "oxm:" && url.host === "oauth" && (url.pathname === "/callback" || url.pathname === "/callback/");
}
