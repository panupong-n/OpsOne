// ==========================================
// TENCYBER OAuth 2.0 + OIDC Helper (System B)
// Public Client PKCE flow — RFC 7636
// ==========================================

import { generateCodeVerifier, generateCodeChallenge } from './pkce';

const TENCYBER_URL = import.meta.env.VITE_TENCYBER_URL || 'https://dashboard.tenfw.com';
const CLIENT_ID = import.meta.env.VITE_TENCYBER_CLIENT_ID || '';
const REDIRECT_URI = import.meta.env.VITE_TENCYBER_REDIRECT_URI || `${window.location.origin}/callback`;

export const TENCYBER = {
    authorizeUrl: `${TENCYBER_URL}/api/oauth/authorize`,       // Direct — browser redirect
    endSessionUrl: `${TENCYBER_URL}/api/oauth/endsession`,      // OIDC RP-Initiated Logout
    tokenUrl: `/api/proxy/oauth/token`,                    // Proxied → avoids CORS
    userinfoUrl: `/api/proxy/oauth/userinfo`,                  // Proxied → avoids CORS
    revokeUrl: `/api/proxy/oauth/revoke`,                   // Proxied → avoids CORS (RFC 7009)
};

// ─── Auth flow ────────────────────────────────────────────────────────────────

/** Redirect browser to TENCYBER login (PKCE).
 *  @param forceLogin - adds prompt=login to force re-auth even with existing TENCYBER session
 */
export async function redirectToTencyberLogin({ forceLogin = false } = {}) {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = crypto.randomUUID();

    sessionStorage.setItem('pkce_verifier', verifier);
    sessionStorage.setItem('oauth_state', state);

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: 'openid email profile',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
    });

    if (forceLogin) params.set('prompt', 'login');

    window.location.href = `${TENCYBER.authorizeUrl}?${params.toString()}`;
}

/** End TENCYBER SSO session (OIDC RP-Initiated Logout).
 *  Redirects to TENCYBER endsession endpoint which clears the browser session cookie,
 *  then sends the user back to our /login page.
 */
export async function endTencyberSession(idToken?: string | null) {
    // Best-effort token revocation before ending session
    const session = loadSession();
    if (session?.accessToken) {
        try {
            await fetch(TENCYBER.revokeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    token: session.accessToken,
                    client_id: CLIENT_ID,
                }).toString(),
            });
        } catch {
            // Best effort — don't block logout if revocation fails
        }
    }

    // Clear OpsOne local session
    clearSession();

    // Redirect to TENCYBER endsession which destroys the TENCYBER cookie
    const params = new URLSearchParams({
        post_logout_redirect_uri: `${window.location.origin}/login`,
        state: crypto.randomUUID(),
    });

    // id_token_hint helps TENCYBER verify which session to end
    if (idToken) params.set('id_token_hint', idToken);

    window.location.href = `${TENCYBER.endSessionUrl}?${params.toString()}`;
}

/** Exchange authorization code for tokens (PKCE — no client_secret needed). */
export async function exchangeCodeForToken(code: string, returnedState: string): Promise<TencyberTokenSet> {
    const savedState = sessionStorage.getItem('oauth_state');
    const codeVerifier = sessionStorage.getItem('pkce_verifier');

    if (!savedState || savedState !== returnedState) {
        throw new Error('OAuth state mismatch — possible CSRF attack.');
    }
    if (!codeVerifier) {
        throw new Error('Missing pkce_verifier in sessionStorage.');
    }

    sessionStorage.removeItem('oauth_state');
    sessionStorage.removeItem('pkce_verifier');

    const res = await fetch(TENCYBER.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            client_id: CLIENT_ID,
            code_verifier: codeVerifier,
        }).toString(),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, string>;
        throw new Error(err?.error_description || `Token exchange failed: ${res.status}`);
    }

    return res.json() as Promise<TencyberTokenSet>;
}

/** Fetch user info from TENCYBER using access_token. */
export async function fetchUserInfo(accessToken: string): Promise<TencyberUser> {
    const res = await fetch(TENCYBER.userinfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch user info: ${res.status}`);
    return res.json() as Promise<TencyberUser>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

// Canonical roles issued by TENCYBER. Legacy names (TENANT_ADMIN, SUPERVISOR,
// ANALYST, VIEWER, 'admin') are no longer sent or accepted — see lib/permissions.ts.
export type TencyberRole = 'SUPER_ADMIN' | 'STAFF' | 'INTERN';

export interface TencyberUser {
    sub: string;
    email: string;
    given_name: string;
    family_name: string;
    name: string;
    role: TencyberRole;
    tenant_id: string | null;
}

export interface TencyberTokenSet {
    access_token: string;
    id_token?: string;   // OIDC id_token — used for id_token_hint on logout
    token_type: string;
    expires_in: number;
}

// ─── Session persistence ──────────────────────────────────────────────────────
// ⚠️  SECURITY: tokens in sessionStorage (never localStorage)
//    sessionStorage clears when the tab/window is closed

const SESSION_KEY = 'tencyber_session';

// ── Force-logout lever ────────────────────────────────────────────────────────
// Bump this number and redeploy to invalidate EVERY existing browser session,
// forcing all users through a fresh TENCYBER login. Use after a role re-tier or
// any change where cached identity/role data must not survive.
//   v2 — 2026-07-24: TENCYBER re-tier to SUPER_ADMIN / STAFF / INTERN
const SESSION_VERSION = 2;

export interface AuthSession {
    user: TencyberUser;
    accessToken: string;
    idToken?: string;      // Store id_token for end_session id_token_hint
    expiresAt: number;      // Unix timestamp ms
    v?: number;            // session schema/force-logout version
}

export function saveSession(session: AuthSession) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, v: SESSION_VERSION }));
}

export function loadSession(): AuthSession | null {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const session: AuthSession = JSON.parse(raw);

        // Session minted before the current version → discard, force re-login.
        if (session.v !== SESSION_VERSION) {
            clearSession();
            return null;
        }

        // Auto-extend for display/kiosk accounts (prevent session expiry)
        const DISPLAY_USERS = ['Watcharapol'];
        if (session.user?.name && DISPLAY_USERS.some(n => session.user.name.includes(n))) {
            session.expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000;
            saveSession(session);
            return session;
        }

        if (session.expiresAt && Date.now() > session.expiresAt) {
            clearSession();
            return null;
        }
        return session;
    } catch {
        return null;
    }
}

export function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
}
