// ─── Feature flags ────────────────────────────────────────────────────────────
// Central on/off switches for modules that can be taken out of service without
// removing their code. Flip a flag back to `true` to restore the module — no
// other edits required.

export const FEATURES = {
  /**
   * Support Tickets (Zammad).
   * Disabled 2026-07-24: the upstream Zammad server is switched off, so the
   * page and its dashboard widgets would only render errors/zeros.
   * Re-enable by setting this to true once Zammad is back online.
   */
  supportTickets: false,
} as const;
