# Website quota login (2026-10-20)

## Owner decision

The owner asked why quota monitoring cannot sign in like Codex and requested implementation, then explicitly chose long-term login and allowed AGENTS.md to change. This increment enables user-driven app-owned website sign-in for Cursor and MiMo. Existing-browser profiles, external client authentication files, user passwords and page text are never collected. No UI styles were authorized or changed. GitHub remains paused.

## Result and limits

- Codex retains official CLI browser authorization.
- Cursor and MiMo add a default website sign-in option. The user confirms the experimental website-quota route, then signs in at a fixed own-site page in a fresh memory-only Electron session. A manual Cookie alternative remains available and stays memory-only.
- Only the existing own-site quota Cookie whitelist is accepted. Cookies must apply to the fixed quota URL, have an approved domain, be secure and not expired; ambiguous identities are rejected. Remote pages receive no preload, Node.js or application IPC. HTTPS navigation is restricted to fixed provider/identity hosts; local schemes, downloads, permissions and arbitrary popups are blocked. No scripts are injected into real websites, and no request body, password, page text or third-party identity Cookie is collected.
- The necessary selected session fields are encrypted with Windows safeStorage/DPAPI in an account-bound envelope, one app-owned file per connection under `provider-quotas/website-secrets`. Encryption must be available; no plaintext fallback. Writes publish an encrypted temporary file atomically. No secret appears in renderer state, connection JSON, diagnostics, exports or clipboard.
- The temporary login session is cleared after completion, cancellation, timeout or failure and is never reused. The encrypted credential, rather than the full browser profile, persists. Known Cookie expiry is retained; an otherwise server-expired session is detected by authorization failure. This is lasting login until the provider expires/revokes the session, not a promise of permanent authorization or automatic token renewal.
- Restart restores local encrypted fields without network. Successful explicit login reads quota once; later provider refreshes remain explicit. Authentication failure removes saved credentials and retains prior quota. Removal deletes the local encrypted credential, not other clients or the global website login. Closing/removing during a pending login prevents late account creation; failed storage does not publish a connection.
- Manual API keys, access tokens, Cookies and Google project context retain their existing memory-only contract.

## Why a universal OAuth button is unavailable

Provider authentication and quota access are separate contracts. No official universal quota OAuth exists across the ten adapters. These sources were checked on 2026-10-20:

- [WorkBuddy third-party apps](https://open.workbuddy.cn/en/docs/third-party-app): registration/review and server-side client secret/token exchange. No server deployment or embedded client_secret is introduced.
- [Claude authentication and credential use](https://code.claude.com/docs/en/legal-and-compliance): third-party apps cannot collect Claude.ai subscription credentials/session tokens; official client sign-in and passive statusline quota stay separate.
- [Gemini CLI terms](https://geminicli.com/docs/resources/tos-privacy/): third-party direct reuse of CLI OAuth is restricted. This increment does not copy its OAuth client identity or create a third-party Google login. Existing experimental explicit-token quota routes are unchanged; there was no live query.
- [Cursor SDK](https://cursor.com/docs/sdk/typescript): official SDK browser login can mint a user API key, but the documented account/read interfaces reviewed here do not establish a personal remaining-subscription-quota endpoint for that key. We do not claim SDK login provides the existing website quota. [Cursor sign-in domains](https://cursor.com/help/troubleshooting/sign-in-domains) inform the bounded identity-host list. Website-session quota remains optional, experimental and potentially partial.
- [Electron session](https://www.electronjs.org/docs/latest/api/session), [Cookies](https://www.electronjs.org/docs/latest/api/cookies), [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) define the temporary session/OS encryption contract. Windows DPAPI protects the stored data against other Windows users; it is not isolation from malicious applications running as the same Windows user.

## Acceptance

Synthetic tests and isolated Electron fixtures must verify successful login, actual Windows encryption, restart without network, optional manual entry, cancellation, sender guards, expiry, removal and unchanged statistics. Do not start a real website login or query an account during maintenance verification. Synthetic website pages do not prove actual CAPTCHA/SSO compatibility or a real account read; both remain explicit owner acceptance.
