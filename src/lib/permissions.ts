// ─── OpsOne role & permission model ───────────────────────────────────────────
// Single source of truth for "who can do what". TENCYBER issues canonical roles
// only (SUPER_ADMIN / STAFF / INTERN) — legacy names (TENANT_ADMIN, SUPERVISOR,
// 'admin', ANALYST, VIEWER) are no longer accepted.
//
// Policy:
//   SUPER_ADMIN — full access
//   STAFF       — full access (permanent employees do everything an admin does)
//   INTERN      — read-only everywhere, EXCEPT "งาน & ปฏิทิน" where they may
//                 add/remove their OWN calendar entries. They may not assign
//                 work, manage products/sites, or touch anyone else's records.
//
// ⚠️ FAIL-CLOSED: any unrecognised/missing role is treated as INTERN (least
// privilege). A role is never promoted to admin by default.

export type Role = 'SUPER_ADMIN' | 'STAFF' | 'INTERN';

const ADMIN_ROLES: readonly string[] = ['SUPER_ADMIN', 'STAFF'];

/** Normalise any incoming role string to a canonical Role. Unknown → INTERN. */
export function normalizeRole(raw?: string | null): Role {
  return raw === 'SUPER_ADMIN' || raw === 'STAFF' ? raw : 'INTERN';
}

/** Full access: manage products/sites, assign work, edit assets/tickets/projects,
 *  HR intake, survey & training administration. */
export function isAdmin(raw?: string | null): boolean {
  return !!raw && ADMIN_ROLES.includes(raw);
}

/** Interns (and anything unrecognised) — read-only except their own calendar. */
export function isIntern(raw?: string | null): boolean {
  return !isAdmin(raw);
}

/** May this role create/edit/delete general records (assets, tickets, projects,
 *  maintenance, product assignments)? Interns may not. */
export function canWrite(raw?: string | null): boolean {
  return isAdmin(raw);
}

/** Everyone — including interns — may log their own work in the calendar. */
export function canLogOwnWork(_raw?: string | null): boolean {
  return true;
}

/** May this user modify a record owned by `ownerId`?
 *  Admins: anyone's. Interns: only their own. */
export function canModifyRecord(
  raw: string | null | undefined,
  ownerId: string | null | undefined,
  myId: string | null | undefined,
): boolean {
  if (isAdmin(raw)) return true;
  return !!ownerId && !!myId && ownerId === myId;
}

/** Human-readable label for the role badge. */
export function roleLabel(raw?: string | null): string {
  switch (normalizeRole(raw)) {
    case 'SUPER_ADMIN': return 'Super Admin';
    case 'STAFF':       return 'Staff';
    default:            return 'Intern';
  }
}
