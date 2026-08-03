import {
  getRecentAcars,
  subscribeRecentAcars,
} from '../aircraft/acars-store';
import type { AcarsMessage } from '../feed/acars';
import { t } from '../core/i18n';

// Full-page ACARS browser modal. Triggered by clicking the HUD ACARS
// chip; renders the most-recent N messages from the global store with
// search + label filter. Click a row to select that aircraft (when we
// can resolve the row to a hex) and dismiss the modal.

export interface AcarsBrowserHandle {
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
}

export interface AcarsBrowserOptions {
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function fmtAge(timeIso: string): string {
  const ms = Date.now() - Date.parse(timeIso);
  if (Number.isNaN(ms) || ms < 0) return '';
  const s = Math.max(0, ms / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

export function mountAcarsBrowser(options: AcarsBrowserOptions): AcarsBrowserHandle {
  const root = document.getElementById('acars-browser') as HTMLElement;
  const backdrop = document.getElementById('acars-backdrop') as HTMLElement;
  const closeBtn = document.getElementById('acars-browser-close') as HTMLButtonElement;
  const countsEl = document.getElementById('acars-browser-counts') as HTMLElement;
  const searchInput = document.getElementById('acars-browser-search') as HTMLInputElement;
  const labelSelect = document.getElementById('acars-browser-label') as HTMLSelectElement;
  const rowsEl = document.getElementById('acars-browser-rows') as HTMLElement;

  let isOpen = false;
  let query = '';
  let labelFilter = '';
  // Cached label set so the dropdown only repopulates when new labels show up.
  const seenLabels = new Set<string>();

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
    const hex = options.resolveHex(m);
    const dataHex = hex ? ` data-hex="${escapeHtml(hex)}"` : '';
    const cls = hex ? 'acars-row clickable' : 'acars-row';
    return `<li class="${cls}"${dataHex}>` +
      `<div class="acars-row-head">${label}<span class="acars-row-ident">${escapeHtml(ident)}${subIdent}</span>${age}</div>` +
      `<div class="acars-row-text">${text}</div>` +
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

  rowsEl.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.acars-row.clickable');
    if (!row) return;
    const hex = row.dataset.hex;
    if (!hex) return;
    options.onSelectAircraft(hex);
    close();
  });

  searchInput.addEventListener('input', () => {
    query = searchInput.value.trim();
    render();
  });

  labelSelect.addEventListener('change', () => {
    labelFilter = labelSelect.value;
    render();
  });

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    root.hidden = false;
    render();
    // Focus the search box so the user can type immediately.
    setTimeout(() => searchInput.focus(), 0);
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    root.hidden = true;
  }

  function toggle(): void {
    if (isOpen) close();
    else open();
  }

  backdrop.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) close();
  });

  // Live-update while open.
  const unsubRecent = subscribeRecentAcars(() => {
    if (isOpen) render();
  });

  // Tick every second so age strings stay current while the modal is open.
  const ageTimer = setInterval(() => {
    if (isOpen) render();
  }, 1000);

  function destroy(): void {
    clearInterval(ageTimer);
    unsubRecent();
  }

  return { open, close, toggle, destroy };
}
