import type { AircraftStore } from '../aircraft/store';

// Show/hide plumbing for the right-hand aircraft list. Two controls with
// one state (mirrors the detail panel's minimize-to-pill grammar):
//   - open panel → a minimize (–) button in the panel header collapses it;
//   - collapsed → a floating chip (live aircraft-count badge) restores it.
// The chip hides while the panel is open — it used to render as a
// morphing hamburger/✕ that crowded the settings cluster and read as
// "close the app" (feedback: make the two sidebars consistent).
//
// Defaults to collapsed on small viewports so phones don't open with the
// list dominating the screen.

const MOBILE_BREAKPOINT_PX = 768;

// Module-level handle so main.ts's mobile auto-collapse goes through the
// same state transition as the buttons (keeping the chip's visibility and
// aria state in sync) instead of poking classList directly.
let setExpandedFn: ((expanded: boolean) => void) | null = null;

/** Collapse/expand the aircraft list. No-op before attachPanelToggle. */
export function setAircraftListExpanded(expanded: boolean): void {
  setExpandedFn?.(expanded);
}

export function attachPanelToggle(store: AircraftStore): void {
  const panel = document.getElementById('aircraft-panel') as HTMLElement;
  const toggle = document.getElementById('panel-toggle') as HTMLButtonElement;
  const badge = document.getElementById('panel-toggle-count') as HTMLElement;
  const minimize = document.getElementById('panel-minimize') as HTMLButtonElement;

  function setExpanded(expanded: boolean): void {
    panel.classList.toggle('collapsed', !expanded);
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    // The chip is purely the restore control; the in-header minimize
    // covers the open state.
    toggle.hidden = expanded;
  }
  setExpandedFn = setExpanded;

  // Initial state — collapsed on phones, open on tablets/desktop.
  setExpanded(window.innerWidth >= MOBILE_BREAKPOINT_PX);

  toggle.addEventListener('click', () => setExpanded(true));
  minimize.addEventListener('click', () => setExpanded(false));

  // Keep the badge in sync with the live aircraft count, so the user knows
  // how many planes are currently in range without opening the panel.
  store.subscribe((snapshot) => {
    badge.textContent = `${snapshot.size}`;
  });
}
