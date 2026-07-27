// ─── Intern read-only guard ───────────────────────────────────────────────────
// Interns may read every page but may only write their OWN calendar entries.
// Rather than gating hundreds of individual buttons (easy to miss one), this
// installs a single choke point over `fetch` that blocks mutating API calls for
// non-admin roles, with a narrow allowlist for the things interns legitimately do.
//
// ⚠️ This is a CLIENT-SIDE guard: it prevents accidental/UI-driven writes and
// keeps the app honest, but it is NOT a security boundary. The task/attendance
// endpoints on the server currently have no authentication at all, so a
// determined user could still call them directly. Real enforcement requires
// server-side auth on those routes (see notes in the handover).

import { isAdmin } from './permissions';

// Paths an intern is still allowed to POST/DELETE to.
const INTERN_WRITE_ALLOWLIST: readonly string[] = [
  '/api/task-visits',   // logging their own site visits
  '/api/attendance',    // recording their own leave
  '/api/exam',          // taking a training exam
  '/api/proxy',         // OAuth token/userinfo proxy (login)
  '/api/users/register',// user upsert performed right after login
];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sessionRole(): string | null {
  try {
    const raw = sessionStorage.getItem('tencyber_session');
    if (!raw) return null;
    return JSON.parse(raw)?.user?.role ?? null;
  } catch {
    return null;
  }
}

function pathOf(input: RequestInfo | URL): string {
  try {
    if (typeof input === 'string') return input.startsWith('http') ? new URL(input).pathname : input;
    if (input instanceof URL) return input.pathname;
    return new URL((input as Request).url, window.location.origin).pathname;
  } catch {
    return '';
  }
}

/** Install the guard once, at app start. */
export function installReadOnlyGuard(onBlocked?: (msg: string) => void): void {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? (input as Request)?.method ?? 'GET').toUpperCase();
    const path = pathOf(input);
    const role = sessionRole();

    // No session (login page, public exam page) → never interfere.
    // Admins (SUPER_ADMIN / STAFF) → unrestricted.
    const restricted =
      role !== null &&
      !isAdmin(role) &&
      !SAFE_METHODS.has(method) &&
      path.startsWith('/api/') &&
      !INTERN_WRITE_ALLOWLIST.some(p => path.startsWith(p));

    if (restricted) {
      const msg = 'บัญชีของคุณเป็นสิทธิ์อ่านอย่างเดียว (Intern) — ไม่สามารถแก้ไขข้อมูลส่วนนี้ได้';
      onBlocked?.(msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return nativeFetch(input as RequestInfo, init);
  };
}
