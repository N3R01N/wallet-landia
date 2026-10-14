/**
 * The castle shell's state, with no DOM: which tab is showing, whether the
 * bottom sheet is open, and which layout the window calls for. The DOM shell
 * (shell.ts) only draws what these functions return.
 */

export const TABS = ['castle', 'town', 'badges', 'guild'] as const;
export type TabId = (typeof TABS)[number];

export const TAB_LABEL: Record<TabId, string> = {
  castle: 'Castle',
  town: 'Town',
  badges: 'Badges',
  guild: 'Guild',
};

export interface SheetState {
  /** What the sheet shows, for the renderer to look up (e.g. `building:aave`). */
  id: string;
  title: string;
}

export interface ShellState {
  tab: TabId;
  sheet: SheetState | null;
}

/** Phones get bottom tabs and a bottom sheet; wider windows get a side rail and a docked sheet. */
export type LayoutMode = 'phone' | 'desktop';

/** At this width and up, the shell switches to the desktop layout. */
export const DESKTOP_MIN_WIDTH = 800;

export function initialShell(tab: TabId = 'castle'): ShellState {
  return { tab, sheet: null };
}

export function isTab(value: string): value is TabId {
  return (TABS as readonly string[]).includes(value);
}

/** Switching tabs closes the sheet: a sheet belongs to the tab it was opened from. */
export function selectTab(state: ShellState, tab: TabId): ShellState {
  if (state.tab === tab) return state;
  return { tab, sheet: null };
}

export function openSheet(state: ShellState, sheet: SheetState): ShellState {
  return { ...state, sheet };
}

export function closeSheet(state: ShellState): ShellState {
  if (state.sheet === null) return state;
  return { ...state, sheet: null };
}

export function layoutFor(width: number): LayoutMode {
  return width >= DESKTOP_MIN_WIDTH ? 'desktop' : 'phone';
}
