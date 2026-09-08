import {
  getRecentAcars,
  subscribeRecentAcars,
} from '../aircraft/acars-store';
import { subscribeHealth } from '../core/health';
import type { AcarsMessage } from '../feed/acars';
import { t } from '../core/i18n';
import { escapeHtml } from './html';

// Docked ACARS panel. Same show/hide grammar as the aircraft list and the
// detail card: a floating restore button (the round 📡 button in the
// top-right cluster, #acars-toggle) opens it and hides while it's open; the
// "–" in the panel header collapses it back to that button.
//
// Renders the most-recent N messages from the global store with search +
// label filter. Click a row to select that aircraft (when we can resolve the
// row to a hex).
//
// Two independent bits decide visibility:
//   - wantOpen  — the user's choice, persisted in localStorage;
//   - available — health.acars !== null (live mode with ACARS configured).
// The panel (and its toggle button) show only when available; historical
// playback and feeds without ACARS hide both without forgetting that the
// user had it open.

export interface AcarsPanelHandle {
  open(): void;
  close(): void;
  toggle(): void;
  /**
   * Selection-driven hide: while an aircraft is selected its detail card
   * owns the left column (and already lists that plane's ACARS), so the
   * docked panel steps aside to its button. This is separate from the
   * user's open/closed preference — deselecting restores whatever that was.
   */
  suppress(on: boolean): void;
  destroy(): void;
}

export interface AcarsPanelOptions {
  /** Called when a row is clicked. hex may be null (we couldn't resolve flight/reg → hex). */
  onSelectAircraft: (hex: string | null) => void;
  /**
   * Resolve a message's flight/reg to an aircraft hex if known, so
   * row-click can jump to the detail panel even when the message has
   * no `icao` of its own. Returns null when no match.
   */
  resolveHex: (msg: AcarsMessage) => string | null;
}

const ROW_LIMIT = 200;
const STORAGE_KEY = 'adsb3d:acarsPanelOpen';
// Phones: the panel would cover the whole scope, so never restore it open.
const MOBILE_MAX_PX = 600;
// Badge stops counting up past this so it stays one/two digits like the
// aircraft-list count chip.
const BADGE_CAP = 99;

export function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStoredOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
  } catch {
    /* private mode / quota — the panel just won't remember */
  }
}

function fmtAge(timeIso: string): string {
  const ms = Date.now() - Date.parse(timeIso);
  if (Number.isNaN(ms) || ms < 0) return '';
  const s = Math.max(0, ms / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

export function mountAcarsPanel(options: AcarsPanelOptions): AcarsPanelHandle {
  const root = document.getElementById('acars-panel') as HTMLElement;
  const hud = document.getElementById('hud') as HTMLElement;
  const toggleBtn = document.getElementById('acars-toggle') as HTMLButtonElement;
  const toggleCount = document.getElementById('acars-toggle-count') as HTMLElement;
  const minimizeBtn = document.getElementById('acars-panel-minimize') as HTMLButtonElement;
  const countsEl = document.getElementById('acars-panel-counts') as HTMLElement;
  const searchInput = document.getElementById('acars-panel-search') as HTMLInputElement;
  const labelSelect = document.getElementById('acars-panel-label') as HTMLSelectElement;
  const rowsEl = document.getElementById('acars-panel-rows') as HTMLElement;

  let wantOpen = false;
  let available = false;
  let suppressed = false;
  let isOpen = false;
  let query = '';
  let labelFilter = '';
  // Cached label set so the dropdown only repopulates when new labels show up.
  const seenLabels = new Set<string>();

  // ── Placement ─────────────────────────────────────────────────────────
  // Docked under the HUD card, whose height varies with feed name, locale,
  // and the chip's own state text. Measure rather than hard-code.
  function place(): void {
    if (!isOpen) return;
    const r = hud.getBoundingClientRect();
    root.style.top = `${Math.round(r.bottom + 8)}px`;
  }
  const hudObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
  hudObserver?.observe(hud);
  window.addEventListener('resize', place);

  // ── Filtering ─────────────────────────────────────────────────────────
  function passes(m: AcarsMessage): boolean {
    if (labelFilter && (m.label ?? '') !== labelFilter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    if (m.text && m.text.toLowerCase().includes(q)) return true;
    if (m.flight && m.flight.toLowerCase().includes(q)) return true;
    if (m.reg && m.reg.toLowerCase().includes(q)) return true;
    if (m.label && m.label.toLowerCase().includes(q)) return true;
    if (m.icao && m.icao.toLowerCase().includes(q)) return true;
    return false;
  }

  function refreshLabelOptions(messages: readonly AcarsMessage[]): void {
    let added = false;
    for (const m of messages) {
      if (!m.label) continue;
      if (!seenLabels.has(m.label)) {
        seenLabels.add(m.label);
        added = true;
      }
    }
    if (!added) return;
    const sorted = Array.from(seenLabels).sort();
    const current = labelSelect.value;
    // Rebuild options preserving current selection if still present.
    labelSelect.innerHTML = `<option value="">${escapeHtml(t('acars.all_labels'))}</option>`;
    for (const label of sorted) {
      const opt = document.createElement('option');
      opt.value = label;
      opt.textContent = label;
      if (label === current) opt.selected = true;
      labelSelect.appendChild(opt);
    }
  }

  function renderRow(m: AcarsMessage): string {
    const ident = m.flight || m.reg || (m.icao ? m.icao.toUpperCase() : '—');
    const subIdent = m.flight && m.reg ? ` <span class="acars-row-sub">${escapeHtml(m.reg)}</span>` : '';
    const label = m.label ? `<span class="acars-row-label">${escapeHtml(m.label)}</span>` : '';
    const age = `<span class="acars-row-age">${fmtAge(m.time)}</span>`;
    const text = m.text
      ? escapeHtml(m.text).replace(/\n/g, ' ↵ ')
      : `<span class="acars-row-empty">${escapeHtml(t('acars.no_text'))}</span>`;
    const decoded = m.decoded
      ? `<div class="acars-row-decoded" data-kind="${escapeHtml(m.decoded.kind)}">${escapeHtml(m.decoded.summary)}</div>`
      : '';
    const hex = options.resolveHex(m);
    const dataHex = hex ? ` data-hex="${escapeHtml(hex)}"` : '';
    const cls = hex ? 'acars-row clickable' : 'acars-row';
    return `<li class="${cls}"${dataHex}>` +
      `<div class="acars-row-head">${label}<span class="acars-row-ident">${escapeHtml(ident)}${subIdent}</span>${age}</div>` +
      `${decoded}<div class="acars-row-text">${text}</div>` +
      `</li>`;
  }

  function render(): void {
    if (!isOpen) return;
    const all = getRecentAcars();
    refreshLabelOptions(all);
    const visible: AcarsMessage[] = [];
    for (const m of all) {
      if (passes(m)) visible.push(m);
      if (visible.length >= ROW_LIMIT) break;
    }
    countsEl.textContent = `${visible.length} / ${all.length}`;
    rowsEl.innerHTML = visible.length === 0
      ? `<li class="acars-row acars-empty">${escapeHtml(t('acars.no_messages_match'))}</li>`
      : visible.map(renderRow).join('');
  }

  // Live message-count badge on the restore button (mirrors the aircraft
  // list's count chip). Hidden when zero or while the panel is open.
  function refreshBadge(): void {
    const n = getRecentAcars().length;
    toggleCount.textContent = n > BADGE_CAP ? `${BADGE_CAP}+` : `${n}`;
    toggleCount.hidden = n === 0 || isOpen;
  }

  rowsEl.addEventListener('click', (e) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.acars-row.clickable');
    if (!rowEl) return;
    const hex = rowEl.dataset.hex;
    if (!hex) return;
    options.onSelectAircraft(hex);
  });

  searchInput.addEventListener('input', () => {
    query = searchInput.value.trim();
    render();
  });

  labelSelect.addEventListener('change', () => {
    labelFilter = labelSelect.value;
    render();
  });

  // ── Open / close ──────────────────────────────────────────────────────
  function apply(): void {
    const next = wantOpen && available && !suppressed;
    if (next !== isOpen) {
      isOpen = next;
      root.hidden = !isOpen;
      if (isOpen) {
        place();
        render();
      }
    }
    // Restore button: visible only when ACARS is available and the panel is
    // closed — exactly the plane-list toggle's rule.
    toggleBtn.hidden = !available || isOpen;
    toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    refreshBadge();
  }

  function open(): void {
    wantOpen = true;
    suppressed = false;
    writeStoredOpen(true);
    apply();
    // Focus the search box so the user can type immediately.
    if (isOpen) setTimeout(() => searchInput.focus(), 0);
  }

  function close(): void {
    const wasOpen = isOpen;
    wantOpen = false;
    writeStoredOpen(false);
    apply();
    // Keyboard/screen-reader users land back on the restore button.
    if (wasOpen && root.contains(document.activeElement)) toggleBtn.focus();
  }

  function toggle(): void {
    // Key off actual visibility, not the stored preference: while suppressed
    // by a selection the panel is hidden but wantOpen is still true, and a
    // click there should reveal it (open() clears the suppression).
    if (isOpen) close();
    else open();
  }

  function suppress(on: boolean): void {
    if (on === suppressed) return;
    suppressed = on;
    apply();
  }

  toggleBtn.addEventListener('click', toggle);
  minimizeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);
  function onKeydown(e: KeyboardEvent): void {
    if (isOpen && e.key === 'Escape') close();
  }

  // Availability follows the same signal that shows/hides the HUD chip.
  const unsubHealth = subscribeHealth((h) => {
    available = h.acars !== null;
    apply();
  });

  // Live-update while open; keep the badge current even when closed.
  const unsubRecent = subscribeRecentAcars(() => {
    if (isOpen) render();
    refreshBadge();
  });

  // Tick every second so age strings stay current while the panel is open.
  const ageTimer = setInterval(() => {
    if (isOpen) render();
  }, 1000);

  // Restore the persisted state (desktop only — see MOBILE_MAX_PX).
  if (readStoredOpen() && window.innerWidth > MOBILE_MAX_PX) {
    wantOpen = true;
  }
  apply();

  function destroy(): void {
    clearInterval(ageTimer);
    unsubRecent();
    unsubHealth();
    hudObserver?.disconnect();
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKeydown);
  }

  return { open, close, toggle, suppress, destroy };
}
