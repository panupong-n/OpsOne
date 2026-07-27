// Single source of truth for person avatars across the whole app, so the same
// person always gets the same colour on every page.

const AVATAR_COLORS = [
    '#2563EB', // blue
    '#0EA5E9', // sky
    '#0891B2', // cyan
    '#1D4ED8', // indigo-blue
    '#6366F1', // indigo
    '#3B82F6', // light blue
    '#0D9488', // teal
    '#7C3AED', // violet (rare slot, kept subtle)
];

/** Deterministic colour for a stable key (user id / email / name). */
export function avatarColor(key: string): string {
    let h = 0;
    for (let i = 0; i < (key?.length ?? 0); i++) h = key.charCodeAt(i) + ((h << 5) - h);
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/** 1–2 letter initials from a display name. */
export function initials(name: string): string {
    if (!name?.trim()) return '?';
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
        ? (parts[0][0] + parts[1][0]).toUpperCase()
        : name.slice(0, 2).toUpperCase();
}
