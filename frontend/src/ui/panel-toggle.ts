import type { AircraftStore } from '../aircraft/store';

// Toggle button for the right-hand aircraft list. Defaults to collapsed
// on small viewports so phones don't open with the list dominating the
// screen. The badge on the closed-state button shows live aircraft count
// so the panel still feels useful even when hidden.

const MOBILE_BREAKPOINT_PX = 768;

export function attachPanelToggle(store: AircraftStore): void {
  const panel = document.getElementById('aircraft-panel') as HTMLElement;
  const toggle = document.getElementById('panel-toggle') as HTMLButtonElement;
  const badge = document.getElementById('panel-toggle-count') as HTMLElement;

  function setExpanded(expanded: boolean): void {
    panel.classList.toggle('collapsed', !expanded);
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  // Initial state — collapsed on phones, open on tablets/desktop.
  setExpanded(window.innerWidth >= MOBILE_BREAKPOINT_PX);

  toggle.addEventListener('click', () => {
    const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
    setExpanded(!isExpanded);
  });

  // Keep the badge in sync with the live aircraft count, so the user knows
  // how many planes are currently in range without opening the panel.
  store.subscribe((snapshot) => {
    badge.textContent = `${snapshot.size}`;
  });
}
