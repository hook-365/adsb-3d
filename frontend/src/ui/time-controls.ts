import {
  getTimeContext,
  setHeatmap,
  setHistorical,
  setLive,
  setPlaying,
  setRate,
  setCursor,
  subscribeTime,
  windowEndingNow,
  type PlaybackRate,
} from '../core/time-context';
import { t, type StringKey } from '../core/i18n';

// Time-controls strip pinned above the footer. In live mode it collapses
// to a single Live/Historical toggle. Selecting Historical expands the
// strip to show preset window chips, a scrubber, play/pause, and a
// playback rate selector.
//
// Mounted once at boot. All state lives in core/time-context; this file
// is purely UI + URL-write.

const PRESETS: ReadonlyArray<{ labelKey: StringKey; hours: number }> = [
  { labelKey: 'time.preset_last_1h', hours: 1 },
  { labelKey: 'time.preset_last_24h', hours: 24 },
  { labelKey: 'time.preset_last_7d', hours: 24 * 7 },
];
const RATES: ReadonlyArray<PlaybackRate> = [1, 4, 16, 60];

export function mountTimeControls(): void {
  const root = document.getElementById('time-controls') as HTMLElement;
  const modeLive = document.getElementById('tc-mode-live') as HTMLButtonElement;
  const modeHist = document.getElementById('tc-mode-hist') as HTMLButtonElement;
  const expanded = document.getElementById('tc-expanded') as HTMLElement;
  const presetsEl = document.getElementById('tc-presets') as HTMLElement;
  const scrubber = document.getElementById('tc-scrubber') as HTMLInputElement;
  const cursorLabel = document.getElementById('tc-cursor') as HTMLElement;
  const rangeLabel = document.getElementById('tc-range') as HTMLElement;
  const playBtn = document.getElementById('tc-play') as HTMLButtonElement;
  const ratesEl = document.getElementById('tc-rates') as HTMLElement;
  const heatmapToggle = document.getElementById('tc-heatmap') as HTMLInputElement;

  // Build preset buttons once.
  for (const p of PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tc-preset';
    btn.textContent = t(p.labelKey);
    btn.addEventListener('click', () => {
      setHistorical(windowEndingNow(p.hours));
    });
    presetsEl.appendChild(btn);
  }

  // Rate chips.
  for (const r of RATES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tc-rate';
    btn.textContent = `${r}×`;
    btn.dataset.rate = String(r);
    btn.addEventListener('click', () => setRate(r));
    ratesEl.appendChild(btn);
  }

  modeLive.addEventListener('click', () => setLive());
  modeHist.addEventListener('click', () => {
    if (getTimeContext().mode === 'historical') return;
    // Default to last 24h when switching from live with no prior window.
    setHistorical(windowEndingNow(24));
  });

  playBtn.addEventListener('click', () => {
    setPlaying(!getTimeContext().playing);
  });

  heatmapToggle.addEventListener('change', () => {
    setHeatmap(heatmapToggle.checked);
  });

  // Scrubber emits input events while dragging; map [0..1000] → [start..end].
  scrubber.addEventListener('input', () => {
    const ctx = getTimeContext();
    if (!ctx.window) return;
    const t = Number(scrubber.value) / 1000;
    setCursor(ctx.window.startMs + t * (ctx.window.endMs - ctx.window.startMs));
  });

  function render(): void {
    const ctx = getTimeContext();
    root.dataset.mode = ctx.mode;
    modeLive.classList.toggle('active', ctx.mode === 'live');
    modeHist.classList.toggle('active', ctx.mode === 'historical');
    expanded.hidden = ctx.mode !== 'historical';

    if (ctx.mode === 'historical' && ctx.window && ctx.cursorMs !== null) {
      const span = ctx.window.endMs - ctx.window.startMs;
      const v = ((ctx.cursorMs - ctx.window.startMs) / span) * 1000;
      // Avoid fighting the user mid-drag — scrubber.matches(':active') is
      // true while the thumb is held. Browser-level: skip writing back to
      // the same DOM node we're listening to.
      if (!scrubber.matches(':active')) scrubber.value = String(Math.round(v));

      cursorLabel.textContent = formatCursor(ctx.cursorMs);
      rangeLabel.textContent = `${formatRangeBound(ctx.window.startMs)} → ${formatRangeBound(ctx.window.endMs)}`;
      playBtn.textContent = ctx.playing ? '❚❚' : '▶';
      playBtn.setAttribute('aria-label', ctx.playing ? t('time.pause') : t('time.play'));

      for (const child of ratesEl.children) {
        const btn = child as HTMLButtonElement;
        btn.classList.toggle('active', Number(btn.dataset.rate) === ctx.rate);
      }

      if (heatmapToggle.checked !== ctx.heatmap) {
        heatmapToggle.checked = ctx.heatmap;
      }
    }
  }

  subscribeTime(render);
  render();
}

function formatCursor(ms: number): string {
  const d = new Date(ms);
  // Local time + Z marker so the user sees both their wall-clock and the
  // UTC reference. HH:MM:SS UTC is what controllers think in.
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}Z`;
}

function formatRangeBound(ms: number): string {
  const d = new Date(ms);
  const now = Date.now();
  const ageHours = (now - ms) / 3600_000;
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (ageHours < 24) {
    // Today: show clock time only.
    return formatCursor(ms);
  }
  return date;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
