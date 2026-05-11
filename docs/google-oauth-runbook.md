# Google OAuth runbook

Bazunia uses Convex HTTP actions for Google OAuth.

## Why this stays in Convex

Convex can handle this flow through HTTP actions, so Bazunia does not need a separate auth service just to enable Google login. External tools such as Clerk, Auth0, or Supabase Auth can make auth dashboards nicer, but they still require provider configuration and additional frontend/backend integration. For this app, keeping Google OAuth in Convex preserves the existing Convex session model and avoids adding a second user/session source.

The only missing production input is a Google OAuth client of type `Web application`.

## Production values

- Frontend: `https://bazunia-production.up.railway.app`
- Convex callback: `https://notable-salmon-371.eu-west-1.convex.site/api/auth/google/callback`
- Convex deployment: `notable-salmon-371`

## Google Cloud setup

1. Open Google Cloud Console.
2. Go to `APIs & Services` -> `Credentials`.
3. Create an OAuth client ID.
4. Choose `Web application`.
5. Add this authorized redirect URI:

```text
https://notable-salmon-371.eu-west-1.convex.site/api/auth/google/callback
```

6. Download the `client_secret_*.json` file.

Do not use a `Desktop app` / `installed` client. It has `http://localhost` redirects and will not work with the Convex `.convex.site` callback.

## Configure Convex

From the repo root:

```bash
npm run configure:google-oauth -- ~/Downloads/client_secret_....json
```

The script validates the JSON, checks the callback URL, and sets the required Convex env vars.

## Verify

```bash
npm run check:google-oauth
```

Expected successful output after credentials are configured:

```text
OK  frontend responds (https://bazunia-production.up.railway.app)
OK  frontend runtime points at Convex prod
OK  frontend includes Google OAuth redirect code
OK  frontend consumes OAuth callback tokens
OK  Convex accepts frontend redirect origin
OK  Google OAuth credentials configured in Convex
OK  Convex blocks untrusted redirect origins
```
