// ─── Thai public holidays ─────────────────────────────────────────────────────
// SOURCE OF TRUTH: the server, which syncs thailandformats.com once a day
// (`GET /api/holidays`). A hand-maintained list can never keep up with lunar
// dates and cabinet-declared substitution days, so the API always wins.
//
// The static table below is only an OFFLINE FALLBACK for the very first paint
// before the sync lands (and if the network is unavailable). Server data is
// applied per YEAR: any year the server knows about completely replaces the
// fallback for that year, so stale/incorrect fallback dates can never leak
// through alongside correct ones.
//
// Last known-good server data is cached in localStorage so a reload is instant
// and correct even while offline.

import { useSyncExternalStore } from 'react';

type HolidayMap = Record<string, string>;

/** Offline fallback only — see the note above. */
const FALLBACK_HOLIDAYS: HolidayMap = {
  // 2025 (historical; the upstream API no longer serves this year)
  '2025-01-01': 'วันขึ้นปีใหม่',
  '2025-04-06': 'วันจักรี',
  '2025-04-13': 'วันสงกรานต์',
  '2025-04-14': 'วันสงกรานต์',
  '2025-04-15': 'วันสงกรานต์',
  '2025-05-01': 'วันแรงงานแห่งชาติ',
  '2025-05-04': 'วันฉัตรมงคล',
  '2025-06-03': 'วันเฉลิมพระชนมพรรษา ราชินี',
  '2025-07-28': 'วันเฉลิมพระชนมพรรษา ร.10',
  '2025-08-12': 'วันแม่แห่งชาติ',
  '2025-10-13': 'วันคล้ายวันสวรรคต ร.9',
  '2025-10-23': 'วันปิยมหาราช',
  '2025-12-05': 'วันพ่อแห่งชาติ',
  '2025-12-10': 'วันรัฐธรรมนูญ',
  '2025-12-31': 'วันสิ้นปี',
};

const CACHE_KEY = 'opsone_holidays_v1';

function yearOf(date: string): string {
  return date.slice(0, 4);
}

/** Server data replaces the fallback for every year it covers. */
function mergeByYear(fallback: HolidayMap, server: HolidayMap): HolidayMap {
  const serverYears = new Set(Object.keys(server).map(yearOf));
  const merged: HolidayMap = {};
  for (const [date, name] of Object.entries(fallback)) {
    if (!serverYears.has(yearOf(date))) merged[date] = name;
  }
  return { ...merged, ...server };
}

function readCache(): HolidayMap {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as HolidayMap) : {};
  } catch {
    return {};
  }
}

let serverMap: HolidayMap = readCache();
let holidayMap: HolidayMap = mergeByYear(FALLBACK_HOLIDAYS, serverMap);

// ── Reactivity: components re-render when a sync lands ────────────────────────
let version = 0;
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function getSnapshot(): number {
  return version;
}

/** Call inside a component to re-render when holiday data updates. */
export function useHolidays(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Fetch the authoritative holiday map from our server. Safe to call repeatedly. */
export async function syncHolidaysFromServer(): Promise<void> {
  try {
    const res = await fetch('/api/holidays');
    if (!res.ok) return;
    const json = await res.json();
    const data = json?.data;
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return;

    serverMap = data as HolidayMap;
    holidayMap = mergeByYear(FALLBACK_HOLIDAYS, serverMap);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(serverMap)); } catch { /* quota/private mode */ }

    version += 1;
    listeners.forEach(l => l());
  } catch {
    /* offline — keep cached/fallback data */
  }
}

// ── Query helpers (synchronous, safe to call during render) ───────────────────

/** Holiday name for an ISO date (YYYY-MM-DD), or null if it is a normal day. */
export function isHoliday(date: string): string | null {
  return holidayMap[date] ?? null;
}

/** True for Saturday/Sunday. */
export function isWeekend(date: string): boolean {
  const w = new Date(`${date}T12:00`).getDay();
  return w === 0 || w === 6;
}

/** True when nobody is expected to work — weekend or public holiday. */
export function isNonWorkingDay(date: string): boolean {
  return isWeekend(date) || isHoliday(date) !== null;
}

/** Current full map (mostly for debugging/exports). */
export function allHolidays(): HolidayMap {
  return { ...holidayMap };
}
