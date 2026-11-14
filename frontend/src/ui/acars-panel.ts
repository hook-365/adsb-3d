import {
  getRecentAcars,
  subscribeRecentAcars,
} from '../aircraft/acars-store';
import { subscribeHealth } from '../core/health';
import { fetchAcarsHistory, type AcarsMessage } from '../feed/acars';
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
// History mode swaps the live store for the acars-service archive (30 days):
// a time range, the same search box and label filter (applied server-side
// there), and paged "load older" results. Archive rows stay local to this
// panel, so old messages never badge aircraft or fire map pings.
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
  /** ACARS API base of the active feed, or null when it has none. */
  getApiBase: () => string | null;
}

const HISTORY_PAGE = 200;
const HISTORY_DEBOUNCE_MS = 300;
const HOUR_MS = 3_600_000;

/**
 * The window a history range selection covers, epoch ms, or null when a
 * custom range is incomplete or inverted. `range` is a number of hours
 * back from now, or 'custom' with two datetime-local values (local time).
 */
export function historyWindow(
  range: string,
  nowMs: number,
  customFrom = '',
  customTo = ''
): { startMs: number; endMs: number } | null {
  if (range !== 'custom') {
    const hours = Number(range);
    if (!Number.isFinite(hours) || hours <= 0) return null;
    return { startMs: nowMs - hours * HOUR_MS, endMs: nowMs };
  }
  const startMs = Date.parse(customFrom);
  if (Number.isNaN(startMs)) return null;
  // An empty "to" means "up to now".
  const endMs = customTo ? Date.parse(customTo) : nowMs;
  if (Number.isNaN(endMs) || startMs >= endMs) return null;
  return { startMs, endMs };
}

/** `Date` as a datetime-local input value (local time, minute precision). */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Absolute local stamp for an archive row: time, plus the date when it isn't today. */
export function fmtStamp(timeIso: string, now: Date = new Date()): string {
  const d = new Date(timeIso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
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
  const liveBtn = document.getElementById('acars-mode-live') as HTMLButtonElement;
  const historyBtn = document.getElementById('acars-mode-history') as HTMLButtonElement;
  const historyEl = document.getElementById('acars-history') as HTMLElement;
  const rangeSelect = document.getElementById('acars-history-range') as HTMLSelectElement;
  const customEl = document.getElementById('acars-history-custom') as HTMLElement;
  const fromInput = document.getElementById('acars-history-from') as HTMLInputElement;
  const toInput = document.getElementById('acars-history-to') as HTMLInputElement;
  const chatterBtn = document.getElementById('acars-chatter') as HTMLButtonElement;

  let wantOpen = false;
  let available = false;
  let suppressed = false;
  let isOpen = false;
  let query = '';
  let labelFilter = '';
  // Only crew/dispatch free text (the service's chatter flag). Applies to
  // both modes: a local filter live, a query parameter in history.
  let chatterOnly = false;
  // Cached label set so the dropdown only repopulates when new labels show up.
  const seenLabels = new Set<string>();

  // History mode state. `historySeq` invalidates in-flight requests whenever
  // the query changes, so a slow page can't land on top of a newer search.
  let historyMode = false;
  let historyRows: AcarsMessage[] = [];
  let historyNextBefore: string | null = null;
  let historyState: 'idle' | 'loading' | 'error' | 'invalid' = 'idle';
  let historyWindowMs: { startMs: number; endMs: number } | null = null;
  let historySeq = 0;
  /** API base the shown archive rows came from. */
  let historyApiBase: string | null = null;
  let historyAborter: AbortController | null = null;
  let historyDebounce: ReturnType<typeof setTimeout> | null = null;

  // ── Placement ─────────────────────────────────────────────────────────
  // Docked under the HUD card, whose height varies with feed name, locale,
  // and the chip's own state text. Measure rather than hard-code.
  function place(): void {
    if (!isOpen) return;
    const r = hud.getBoundingClientRect();
    // Docked chrome butts straight against the HUD; glass keeps a gap.
    const gap = document.documentElement.dataset.panelStyle === 'docked' ? 0 : 8;
    root.style.top = `${Math.round(r.bottom + gap)}px`;
  }
  const hudObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
  hudObserver?.observe(hud);
  window.addEventListener('resize', place);

  // ── Filtering ─────────────────────────────────────────────────────────
  function passes(m: AcarsMessage): boolean {
    if (chatterOnly && !m.chatter) return false;
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
    const age = `<span class="acars-row-age">${escapeHtml(historyMode ? fmtStamp(m.time) : fmtAge(m.time))}</span>`;
    const text = m.text
      ? escapeHtml(m.text).replace(/\n/g, ' ↵ ')
      : `<span class="acars-row-empty">${escapeHtml(t('acars.no_text'))}</span>`;
    const decoded = m.decoded
      ? `<div class="acars-row-decoded" data-kind="${escapeHtml(m.decoded.kind)}">${escapeHtml(m.decoded.summary)}</div>`
      : '';
    const hex = options.resolveHex(m);
    const dataHex = hex ? ` data-hex="${escapeHtml(hex)}"` : '';
    const cls = `acars-row${hex ? ' clickable' : ''}${m.chatter ? ' chatter' : ''}`;
    return `<li class="${cls}"${dataHex}>` +
      `<div class="acars-row-head">${label}<span class="acars-row-ident">${escapeHtml(ident)}${subIdent}</span>${age}</div>` +
      `${decoded}<div class="acars-row-text">${text}</div>` +
      `</li>`;
  }

  function emptyRow(message: string): string {
    return `<li class="acars-row acars-empty">${escapeHtml(message)}</li>`;
  }

  function renderHistory(): void {
    refreshLabelOptions(historyRows);
    countsEl.textContent = `${historyRows.length}${historyNextBefore ? '+' : ''}`;
    const loading = historyState === 'loading';
    let html = historyRows.map(renderRow).join('');
    if (historyState === 'invalid') {
      html = emptyRow(t('acars.range_invalid'));
    } else if (historyState === 'error') {
      html += `<li class="acars-row acars-more"><button type="button" data-history="retry">` +
        `${escapeHtml(t('acars.load_failed'))} ${escapeHtml(t('acars.retry'))}</button></li>`;
    } else if (historyRows.length === 0) {
      html = emptyRow(loading ? t('acars.loading') : t('acars.history_empty'));
    } else if (historyNextBefore || loading) {
      html += `<li class="acars-row acars-more"><button type="button" data-history="more"${loading ? ' disabled' : ''}>` +
        `${escapeHtml(loading ? t('acars.loading') : t('acars.load_more'))}</button></li>`;
    }
    rowsEl.innerHTML = html;
  }

  // Fetch one archive page. `reset` starts the query over (new range, search
  // or label); otherwise it appends the next older page to what's shown.
  async function loadHistory(reset: boolean): Promise<void> {
    const apiBase = options.getApiBase();
    if (!apiBase) return;
    historyApiBase = apiBase;
    if (reset) {
      historyWindowMs = historyWindow(rangeSelect.value, Date.now(), fromInput.value, toInput.value);
      historyRows = [];
      historyNextBefore = null;
      rowsEl.scrollTop = 0;
    }
    historyAborter?.abort();
    const seq = ++historySeq;
    if (!historyWindowMs) {
      historyState = 'invalid';
      renderHistory();
      return;
    }
    const aborter = new AbortController();
    historyAborter = aborter;
    historyState = 'loading';
    renderHistory();
    try {
      const page = await fetchAcarsHistory(
        apiBase,
        {
          ...historyWindowMs,
          q: query,
          label: labelFilter,
          chatter: chatterOnly,
          before: reset ? null : historyNextBefore,
          limit: HISTORY_PAGE,
        },
        aborter.signal
      );
      if (seq !== historySeq) return;
      historyRows = historyRows.concat(page.messages);
      historyNextBefore = page.nextBefore;
      historyState = 'idle';
    } catch (err) {
      if (seq !== historySeq) return;
      console.warn('[acars] history load failed', err);
      historyState = 'error';
    }
    if (historyMode && isOpen) renderHistory();
  }

  function queueHistoryReload(): void {
    if (historyDebounce) clearTimeout(historyDebounce);
    historyDebounce = setTimeout(() => {
      historyDebounce = null;
      void loadHistory(true);
    }, HISTORY_DEBOUNCE_MS);
  }

  function setHistoryMode(on: boolean): void {
    if (on === historyMode) return;
    historyMode = on;
    liveBtn.classList.toggle('active', !on);
    historyBtn.classList.toggle('active', on);
    liveBtn.setAttribute('aria-pressed', on ? 'false' : 'true');
    historyBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    historyEl.hidden = !on;
    if (on) {
      void loadHistory(true);
    } else {
      historyAborter?.abort();
      historySeq++;
      historyRows = [];
      historyNextBefore = null;
      render();
    }
  }

  function render(): void {
    if (!isOpen) return;
    if (historyMode) {
      renderHistory();
      return;
    }
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
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-history]')?.dataset.history;
    if (action) {
      // Retry repeats the failed request: the first page if nothing loaded.
      void loadHistory(action === 'retry' && historyRows.length === 0);
      return;
    }
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.acars-row.clickable');
    if (!rowEl) return;
    const hex = rowEl.dataset.hex;
    if (!hex) return;
    options.onSelectAircraft(hex);
  });

  searchInput.addEventListener('input', () => {
    query = searchInput.value.trim();
    if (historyMode) queueHistoryReload();
    else render();
  });

  labelSelect.addEventListener('change', () => {
    labelFilter = labelSelect.value;
    if (historyMode) void loadHistory(true);
    else render();
  });

  chatterBtn.addEventListener('click', () => {
    chatterOnly = !chatterOnly;
    chatterBtn.classList.toggle('active', chatterOnly);
    chatterBtn.setAttribute('aria-pressed', chatterOnly ? 'true' : 'false');
    if (historyMode) void loadHistory(true);
    else render();
  });

  liveBtn.addEventListener('click', () => setHistoryMode(false));
  historyBtn.addEventListener('click', () => setHistoryMode(true));

  rangeSelect.addEventListener('change', () => {
    const custom = rangeSelect.value === 'custom';
    customEl.hidden = !custom;
    // Seed an empty custom range with the last 24 h so the pickers open
    // near "now" instead of on a blank date.
    if (custom && !fromInput.value) {
      const now = new Date();
      fromInput.value = toLocalInputValue(new Date(now.getTime() - 24 * HOUR_MS));
      toInput.value = toLocalInputValue(now);
    }
    void loadHistory(true);
  });
  fromInput.addEventListener('change', () => void loadHistory(true));
  toInput.addEventListener('change', () => void loadHistory(true));

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
    const next = h.acars !== null;
    // ACARS went away (feed switch, historical playback): the archive rows
    // belong to the feed that just left, so fall back to live.
    // Same for an in-place switch between two feeds that both have ACARS.
    if ((available && !next) || (historyMode && options.getApiBase() !== historyApiBase)) {
      setHistoryMode(false);
    }
    available = next;
    apply();
  });

  // Live-update while open; keep the badge current even when closed.
  const unsubRecent = subscribeRecentAcars(() => {
    if (isOpen && !historyMode) render();
    refreshBadge();
  });

  // Tick every second so age strings stay current while the panel is open.
  // Archive rows carry absolute stamps and must keep their scroll position.
  const ageTimer = setInterval(() => {
    if (isOpen && !historyMode) render();
  }, 1000);

  // Restore the persisted state (desktop only — see MOBILE_MAX_PX).
  if (readStoredOpen() && window.innerWidth > MOBILE_MAX_PX) {
    wantOpen = true;
  }
  apply();

  function destroy(): void {
    clearInterval(ageTimer);
    if (historyDebounce) clearTimeout(historyDebounce);
    historyAborter?.abort();
    unsubRecent();
    unsubHealth();
    hudObserver?.disconnect();
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKeydown);
  }

  return { open, close, toggle, suppress, destroy };
}
