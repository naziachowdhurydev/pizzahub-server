# Google sign-in setup (Better Auth)

The code is already wired. Only the Google Cloud credentials are missing.

## 1. Create the Google OAuth client

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Choose **Create credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Add this **Authorized redirect URI** for local development:

   ```text
   http://localhost:5000/api/auth/callback/google
   ```

   Use the API domain in production, for example:

   ```text
   https://api.yourdomain.com/api/auth/callback/google
   ```

   The callback is built from `BETTER_AUTH_URL`, so those two values must agree.

## 2. Credentials are set in `src/lib/auth.ts`

The Google client ID and secret are configured directly in
`PizzaHub-Server/src/lib/auth.ts`. They are not read from `.env` and must never
be added to the client app.

Because the secret lives in source code, do not commit a shared version of that
file containing real credentials. Use a private deployment or a secret manager
in production.

## 3. Restart the server

The provider is registered at startup from `src/lib/auth.ts`.

```bash
cd PizzaHub-Server
npm run dev
```

## 4. Verify

```bash
curl http://localhost:5000/api/users/auth-providers
```

Expected when configured:

```json
{"success":true,"data":{"google":true}}
```

Then open `http://localhost:3000/login` or `/register` and use the Google button.
A successful sign-in lands on the role-appropriate dashboard.

## Troubleshooting

- **redirect_uri_mismatch** — the Authorized redirect URI in Google Cloud does not exactly match `BETTER_AUTH_URL + /api/auth/callback/google`.
- **invalid_client** — check the values in `src/lib/auth.ts` and restart the server.
- **access_blocked / 403** — the Google Cloud OAuth consent screen or test-user settings are blocking the account.
