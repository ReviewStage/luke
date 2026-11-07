-- The first-party clients no build seeds any more: the iOS app's, deleted with the app, and the Mac's before its id became "desktop". Each still skips consent, so a sign-in under it would mint tokens with no one asked. Their consents and tokens cascade with them.
DELETE FROM "oauth_client" WHERE "client_id" IN ('luke-mobile', 'luke-desktop');
