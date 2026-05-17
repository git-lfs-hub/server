# GitHub OAuth app — {{orgName}}

Create an OAuth app at [https://github.com/settings/applications/new] (or your organization’s **Settings → Developer settings → OAuth Apps**).

- **Application name**: for example:
  ```
  {{orgName}} LFS Server
  ```
- **Homepage URL:** (matching `GITHUB_APP_HOME` in the generated `wrangler.jsonc`)
  ```
  https://lfs-server.{{cloudflareAccountSlug}}.workers.dev
  ```
- **Application description**: for example:
  ```
  Enable automatic LFS Server login from `gh`, `git-credential-manager` etc.
  ```
- **Authorization callback URL:**
  ```
  https://lfs-server.{{cloudflareAccountSlug}}.workers.dev/login/oauth/callback
  ```

**Generate a new client secret**. After GitHub shows the client credentials, store them with Wrangler (**you won't see them again**):

```sh
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

Access requires active membership in the configured GitHub org (`GITHUB_ORGS` in `wrangler.jsonc`). `GITHUB_USERS` further restricts access to specific GitHub logins.
