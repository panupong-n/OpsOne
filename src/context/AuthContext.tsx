import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
    type TencyberUser,
    type AuthSession,
    loadSession,
    saveSession,
    clearSession,
    fetchUserInfo,
    exchangeCodeForToken,
    endTencyberSession,
} from '../lib/auth';

// ─── Context Types ────────────────────────────────────────────────────────────

interface AuthContextType {
    user: TencyberUser | null;
    accessToken: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    /** Call this from the /auth/callback page after extracting code+state from URL */
    handleCallback: (code: string, state: string) => Promise<void>;
    logout: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<TencyberUser | null>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // ── On mount: restore session, then RE-VALIDATE against TENCYBER ─────────
    // The cached session holds the role captured at login. Roles change (e.g.
    // re-tiering SUPER_ADMIN → STAFF/INTERN), so we must never trust the cache:
    // we re-fetch userinfo on every load and write the FRESH role back.
    useEffect(() => {
        const session = loadSession();
        if (!session) { setIsLoading(false); return; }

        // Restore optimistically so the UI is not blank while we re-validate.
        setUser(session.user);
        setAccessToken(session.accessToken);

        (async () => {
            try {
                const fresh = await fetchUserInfo(session.accessToken);
                saveSession({ ...session, user: fresh });
                setUser(fresh);
                // Sync the platform DB with the CURRENT role (not the cached one).
                fetch('/api/users/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sub:         fresh.sub,
                        email:       fresh.email,
                        name:        fresh.name,
                        given_name:  fresh.given_name,
                        family_name: fresh.family_name,
                        role:        fresh.role,
                        tenant_id:   fresh.tenant_id,
                    }),
                }).catch(() => { /* non-critical */ });
            } catch (err) {
                // Token rejected (revoked/expired) → drop the session and force a
                // fresh login. Transient network errors keep the cached session.
                const msg = err instanceof Error ? err.message : '';
                if (msg.includes('401') || msg.includes('403')) {
                    clearSession();
                    setUser(null);
                    setAccessToken(null);
                }
            } finally {
                setIsLoading(false);
            }
        })();
    }, []);

    // ── Session keep-alive for display accounts ──────────────────────────────
    useEffect(() => {
        if (!user) return;
        const DISPLAY_USERS = ['Watcharapol'];
        if (!DISPLAY_USERS.some(n => user.name?.includes(n))) return;
        const id = setInterval(() => {
            const session = loadSession();
            if (session) {
                session.expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000;
                saveSession(session);
            }
        }, 5 * 60 * 1000); // every 5 minutes
        return () => clearInterval(id);
    }, [user]);

    // ── Handle OAuth callback ─────────────────────────────────────────────────
    const handleCallback = useCallback(async (code: string, state: string) => {
        setIsLoading(true);
        try {
            const tokens = await exchangeCodeForToken(code, state);
            const userInfo = await fetchUserInfo(tokens.access_token);

            const session: AuthSession = {
                user: userInfo,
                accessToken: tokens.access_token,
                idToken: tokens.id_token,           // store for end_session id_token_hint
                expiresAt: Date.now() + (tokens.expires_in || 28800) * 1000,
            };

            saveSession(session);
            setUser(userInfo);
            setAccessToken(tokens.access_token);

            // Register / update user record in platform database (fire-and-forget)
            fetch('/api/users/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sub:         userInfo.sub,
                    email:       userInfo.email,
                    name:        userInfo.name,
                    given_name:  userInfo.given_name,
                    family_name: userInfo.family_name,
                    role:        userInfo.role,
                    tenant_id:   userInfo.tenant_id,
                }),
            }).catch(() => { /* non-critical */ });
        } catch (err) {
            console.error('[AuthContext] Callback error:', err);
            clearSession();
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, []);

    // ── Logout ────────────────────────────────────────────────────────────────
    const logout = useCallback(async () => {
        // Load idToken BEFORE clearing session (needed for id_token_hint)
        const session = loadSession();
        const idToken = session?.idToken;

        // Clear OpsOne local state immediately
        setUser(null);
        setAccessToken(null);

        // Redirect to TENCYBER endsession — this clears TENCYBER cookie + redirects to /login
        // (also revokes access_token internally before redirecting)
        await endTencyberSession(idToken);
    }, []);

    return (
        <AuthContext.Provider
            value={{
                user,
                accessToken,
                isAuthenticated: !!user,
                isLoading,
                handleCallback,
                logout,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
}
