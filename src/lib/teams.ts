// ─── Team / group ordering ────────────────────────────────────────────────────
// One shared ordering so the daily board and the settings screen agree:
//   1. Cyber security team first
//   2. every other named team, alphabetically
//   3. interns
//   4. people with no group at all
// Ranks are spaced so new rules can slot in without renumbering.

export const UNGROUPED_LABEL = 'ไม่มีกลุ่ม';

export function teamRank(name?: string | null): number {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return 900;                 // ungrouped — always last
  if (n.includes('intern')) return 800;
  if (n.includes('cyber')) return 0;  // cyber security on top
  return 100;
}

/** Sort group names by the shared ordering. */
export function sortTeamNames(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const d = teamRank(a) - teamRank(b);
    return d !== 0 ? d : a.localeCompare(b, 'th');
  });
}

/** Bucket a list of people into [teamName, members][] in display order. */
export function groupByTeam<T extends { user_group?: string | null }>(people: T[]): [string, T[]][] {
  const buckets = new Map<string, T[]>();
  for (const p of people) {
    const key = (p.user_group ?? '').trim() || UNGROUPED_LABEL;
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }
  return [...buckets.entries()].sort((a, b) => {
    // The synthetic "ungrouped" label must rank as ungrouped, not as a name.
    const ra = a[0] === UNGROUPED_LABEL ? 900 : teamRank(a[0]);
    const rb = b[0] === UNGROUPED_LABEL ? 900 : teamRank(b[0]);
    return ra !== rb ? ra - rb : a[0].localeCompare(b[0], 'th');
  });
}
