export const TAB_IDS = [
  "broadcast",
  "media",
  "monitor",
  "cameras",
  "talk",
  "music",
  "endpoints",
  "zones",
  "pa-group",
  "history",
] as const;

export type Tab = (typeof TAB_IDS)[number];

/** Tabs that render the right-hand context rail. */
export const CONTEXT_TABS: ReadonlySet<Tab> = new Set([
  "broadcast",
  "talk",
  "monitor",
  "music",
]);

export const hasContextRail = (tab: Tab) => CONTEXT_TABS.has(tab);
