// voice-panel.ts — voice scanner panel view (unified single-feed view).
//
// One panel, no mode toggle. Layout (top → bottom inside .voice-body):
//
//   1. Live-activity strip — compact horizontal row of per-channel dots that
//      pulse from subscribeActivity with a ~1500 ms hold so brief squelch
//      bursts are visible. This is the "real-time" feel — activity shows up
//      here a few seconds before the clip lands in the list below.
//
//   2. Scanner controls — ▶/⏸ play button + single volume slider.
//
//   3. Jump-to-live badge — shown when the play queue is non-empty.
//
//   4. Call feed — scrolling list (newest-first). Auto-plays as calls arrive
//      when the scanner is running; click any row to replay. All Phase 4
//      scanner logic is preserved: queue, resumeAfterManual, skip-on-error.
//
//   5. Status line.
//
// The 📻 toggle chip and its .streaming indicator / channel dot work as before.
//
// Autoplay policy: first .play() is always from a user gesture (▶ or row
// click). Programmatic auto-advance inside `ended` is permitted by browsers.

import {
  type Call,
  audioUrlFor,
  subscribeCalls,
  subscribeActivity,
  subscribeConnection,
  getCalls,
} from '../feed/voice-calls';
import { t } from '../core/i18n';

// ─── Channel color palette ────────────────────────────────────────────────
// Stable hue from label string; avoids reds/oranges used by warning states.

function channelHue(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = (h * 31 + label.charCodeAt(i)) >>> 0;
  }
  // 180–340° — cyan → blue → purple → magenta.
  return 180 + (h % 160);
}

function channelColor(label: string): string {
  return `hsl(${channelHue(label)}, 70%, 68%)`;
}

// Compact label for the activity strip — drop the airport prefix so the five
// chips stay legible and distinct ("KCWA-TWR" → "TWR", "GUARD" → "GUARD").
// The full label + freq stay in the chip tooltip and the call list.
function shortLabel(label: string): string {
  const dash = label.lastIndexOf('-');
  return dash >= 0 ? label.slice(dash + 1) : label;
}

// ─── Time formatting ──────────────────────────────────────────────────────

function relativeTime(ms: number): string {
  const sec = Math.round((Date.now() - ms) / 1000);
  if (sec < 5) return t('voice.time_now');
  if (sec < 60) return t('voice.time_seconds_ago', { n: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t('voice.time_minutes_ago', { n: min });
  const hr = Math.floor(min / 60);
  return t('voice.time_hours_ago', { n: hr });
}

function clockTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

// ─── Mount ────────────────────────────────────────────────────────────────

interface MountResult {
  destroy(): void;
}

export function mountVoicePanel(container: HTMLElement): MountResult {
  // ── DOM scaffold ─────────────────────────────────────────────────────────
  container.innerHTML = `
    <button class="voice-toggle" id="voice-toggle" aria-expanded="false"
            aria-controls="voice-body" title="${t('voice.scanner_title')}">
      <span class="voice-toggle-icon" aria-hidden="true">📻</span>
      <span class="voice-toggle-label" id="voice-toggle-label">${t('voice.toggle_label')}</span>
      <span class="voice-toggle-dot" id="voice-toggle-dot" aria-label="${t('voice.no_activity')}"></span>
    </button>
    <div class="voice-body" id="voice-body" hidden>

      <!-- 1. Live-activity strip -->
      <div class="voice-activity-strip" id="voice-activity-strip" aria-label="${t('voice.live_channel_activity')}"></div>

      <!-- 2. Scanner controls -->
      <div class="voice-controls">
        <button class="voice-play" id="voice-scan-play"
                aria-pressed="false" aria-label="${t('voice.start_scanner')}" title="${t('voice.start_scanner')}">▶</button>
        <input  type="range" class="voice-volume" id="voice-volume"
                min="0" max="100" value="75" aria-label="${t('voice.volume')}" />
      </div>

      <!-- 3. Jump-to-live badge -->
      <div class="voice-jump-live" id="voice-jump-live" hidden></div>

      <!-- 4. Call feed -->
      <ul class="voice-call-list" id="voice-call-list" aria-label="${t('voice.recent_calls')}"></ul>

      <!-- 5. Status -->
      <div class="voice-status" id="voice-status">${t('voice.status_connecting')}</div>

      <audio id="voice-audio" preload="none"></audio>
    </div>
  `;

  // ── Element refs ──────────────────────────────────────────────────────────
  const toggleBtn   = container.querySelector('#voice-toggle')       as HTMLButtonElement;
  const body        = container.querySelector('#voice-body')          as HTMLElement;
  const toggleDot   = container.querySelector('#voice-toggle-dot')    as HTMLElement;
  const toggleLabel = container.querySelector('#voice-toggle-label')  as HTMLElement;

  const activityStrip = container.querySelector('#voice-activity-strip') as HTMLElement;
  const scanPlayBtn   = container.querySelector('#voice-scan-play')   as HTMLButtonElement;
  const volumeSlider  = container.querySelector('#voice-volume')      as HTMLInputElement;
  const jumpLiveEl    = container.querySelector('#voice-jump-live')   as HTMLElement;
  const callListEl    = container.querySelector('#voice-call-list')   as HTMLUListElement;
  const statusEl      = container.querySelector('#voice-status')      as HTMLElement;

  const audio = container.querySelector('#voice-audio') as HTMLAudioElement;

  // ── State ─────────────────────────────────────────────────────────────────
  let wsConnected  = false;
  let audioPlaying = false;
  let destroyed    = false;

  // ── Volume ────────────────────────────────────────────────────────────────
  audio.volume = parseInt(volumeSlider.value, 10) / 100;

  volumeSlider.addEventListener('input', () => {
    audio.volume = parseInt(volumeSlider.value, 10) / 100;
  });

  // ── Panel expand/collapse ─────────────────────────────────────────────────
  toggleBtn.addEventListener('click', () => {
    const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    toggleBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    body.hidden = expanded;
  });

  // ── Streaming indicator ───────────────────────────────────────────────────
  function updateStreamingIndicator(): void {
    toggleBtn.classList.toggle('streaming', wsConnected && audioPlaying);
  }

  // ── Status helper ─────────────────────────────────────────────────────────
  function setStatus(text: string, cls: 'ok' | 'warn' | 'bad'): void {
    statusEl.textContent = text;
    statusEl.dataset['state'] = cls;
  }

  // ── Audio stop ────────────────────────────────────────────────────────────
  function stopAudio(): void {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audioPlaying = false;
    updateStreamingIndicator();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LIVE-ACTIVITY STRIP
  // ═══════════════════════════════════════════════════════════════════════

  // Per-channel hold: dot stays lit for HOLD_MS after the last active=true.
  const HOLD_MS = 1500;

  // Keyed by channel label.
  const stripDotEls  = new Map<string, HTMLElement>();
  const holdUntil    = new Map<string, number>();
  const holdTimers   = new Map<string, number>();

  function buildStripChip(label: string, freq: string): HTMLElement {
    const chip = document.createElement('div');
    chip.className = 'vsa-chip';
    chip.title = `${label}  ${freq}`;
    const dot = document.createElement('span');
    dot.className = 'vsa-dot';
    dot.style.setProperty('--ch-color', channelColor(label));
    const lbl = document.createElement('span');
    lbl.className = 'vsa-label';
    lbl.textContent = shortLabel(label);
    chip.appendChild(dot);
    chip.appendChild(lbl);
    activityStrip.appendChild(chip);
    return dot;
  }

  function applyActivity(channels: Record<string, { freq: string; active: boolean }>): void {
    // Lazy-build strip chips on first activity message.
    if (stripDotEls.size === 0) {
      for (const [label, state] of Object.entries(channels)) {
        const dot = buildStripChip(label, state.freq);
        stripDotEls.set(label, dot);
      }
    }

    let anyActive = false;

    for (const [label, state] of Object.entries(channels)) {
      const dot = stripDotEls.get(label);
      if (!dot) continue;

      if (state.active) {
        // Extend the hold window.
        holdUntil.set(label, Date.now() + HOLD_MS);
        // Cancel any pending clear timer — we're still active.
        const existing = holdTimers.get(label);
        if (existing !== undefined) {
          clearTimeout(existing);
          holdTimers.delete(label);
        }
      }

      const held = (holdUntil.get(label) ?? 0) > Date.now();
      const lit  = state.active || held;

      dot.classList.toggle('active', lit);

      if (lit) {
        anyActive = true;
        // Schedule a clear when the hold expires (only if not already active).
        if (!state.active && !holdTimers.has(label)) {
          const remaining = (holdUntil.get(label) ?? 0) - Date.now();
          const timer = window.setTimeout(() => {
            holdTimers.delete(label);
            holdUntil.delete(label);
            dot.classList.remove('active');
            // Re-evaluate anyActive for the toggle-chip dot.
            if (!playingId) {
              const anyStillLit = [...stripDotEls.values()].some((d) =>
                d.classList.contains('active'),
              );
              toggleDot.classList.toggle('active', anyStillLit);
              if (!anyStillLit) toggleDot.style.removeProperty('--dot-color');
              toggleDot.setAttribute(
                'aria-label',
                anyStillLit ? t('voice.channel_active') : t('voice.no_activity'),
              );
            }
          }, Math.max(0, remaining));
          holdTimers.set(label, timer);
        }
      }
    }

    // Drive the toggle-chip dot from activity only when nothing is playing.
    if (!playingId) {
      toggleDot.classList.toggle('active', anyActive);
      toggleDot.style.removeProperty('--dot-color');
      toggleDot.setAttribute('aria-label', anyActive ? t('voice.channel_active') : t('voice.no_activity'));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SCANNER (call feed + auto-play queue)
  // ═══════════════════════════════════════════════════════════════════════

  let scannerRunning    = false;
  let playQueue: string[] = [];
  let playingId: string | null = null;
  let resumeAfterManual = false;
  let relTimerHandle: number | null = null;

  function findCall(id: string): Call | undefined {
    return getCalls().find((c) => c.id === id);
  }

  function setScannerPlaying(playing: boolean): void {
    scanPlayBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    scanPlayBtn.textContent = playing ? '⏸' : '▶';
    scanPlayBtn.title = playing ? t('voice.pause_scanner') : t('voice.start_scanner');
  }

  // Highlight the currently-playing row; update the toggle-chip dot color.
  function highlightRow(id: string | null): void {
    for (const li of callListEl.querySelectorAll<HTMLLIElement>('li.playing')) {
      li.classList.remove('playing');
    }
    if (id) {
      const el = callListEl.querySelector<HTMLLIElement>(`li[data-id="${id}"]`);
      if (el) el.classList.add('playing');

      const call = findCall(id);
      if (call) {
        toggleDot.style.setProperty('--dot-color', channelColor(call.label));
        toggleDot.classList.add('active');
        toggleDot.setAttribute('aria-label', t('voice.playing_channel', { label: call.label }));
      }
    } else {
      toggleDot.style.removeProperty('--dot-color');
      // Leave dot active/inactive state to the activity strip logic.
    }
  }

  // Play a specific call. Returns a promise that resolves once audio starts.
  function playSingleCall(call: Call): Promise<void> {
    audio.muted = false;
    audio.src = audioUrlFor(call);
    playingId = call.id;
    highlightRow(call.id);
    setChipLabel(call);
    pingDot();
    setStatus(t('voice.status_playing', { label: call.label }), 'ok');
    return audio.play();
  }

  // Advance the play queue (called on `ended` or skip).
  function advanceQueue(): void {
    if (!scannerRunning) return;

    const nextId = playQueue.shift();
    if (!nextId) {
      playingId = null;
      highlightRow(null);
      setChipLabel(null);
      setStatus(t('voice.status_waiting'), 'warn');
      updateJumpLive();
      return;
    }

    const call = findCall(nextId);
    if (!call) {
      // Disappeared from rolling list — skip silently.
      advanceQueue();
      return;
    }

    playSingleCall(call).catch((err: unknown) => {
      console.warn('[voice-calls] auto-advance play failed', err);
      scannerRunning = false;
      audioPlaying = false;
      setScannerPlaying(false);
      updateStreamingIndicator();
      setStatus(t('voice.status_autoplay_blocked'), 'warn');
    });
  }

  // Jump-to-live badge.
  function updateJumpLive(): void {
    if (!scannerRunning) {
      jumpLiveEl.hidden = true;
      return;
    }
    const pending = playQueue.length;
    if (pending > 0) {
      jumpLiveEl.hidden = false;
      jumpLiveEl.textContent = t('voice.jump_to_live', { n: pending });
    } else {
      jumpLiveEl.hidden = true;
    }
  }

  jumpLiveEl.addEventListener('click', () => {
    playQueue = [];
    const calls = getCalls();
    if (calls.length === 0) return;
    const newest = calls[0];
    if (!newest) return;
    playingId = newest.id;
    playSingleCall(newest).catch(() => { /* handled by audio error listener */ });
    updateJumpLive();
  });

  // Start scanner: jump to newest call, then auto-advance from WS.
  // Collapsed-chip live indicator: show the playing call's channel + freq,
  // and a one-shot "ping" pulse when a transmission starts.
  function setChipLabel(call: Call | null): void {
    toggleLabel.textContent = call ? `${shortLabel(call.label)} ${call.freq}` : t('voice.toggle_label');
  }
  function pingDot(): void {
    toggleDot.classList.remove('ping');
    void toggleDot.offsetWidth; // reflow so the animation restarts each call
    toggleDot.classList.add('ping');
  }

  function startScanner(): void {
    scannerRunning = true;
    setScannerPlaying(true);
    toggleBtn.classList.add('listening');
    playQueue = [];
    updateJumpLive();

    // "Watch for the drop": arm the scanner but DON'T replay history — the
    // next call to arrive over the WebSocket is what plays. Existing calls
    // stay available via click-to-replay. To the user this reads as a live
    // stream: press play, then hear traffic as it happens.
    setStatus(t('voice.status_listening'), 'warn');

    // Prime the <audio> element inside this user gesture so the next
    // programmatic play() — fired later by a WS call event, outside any
    // gesture — isn't blocked by the browser autoplay policy. Plays the
    // newest call muted, then immediately stops: silent and invisible.
    const newest = getCalls()[0];
    if (newest) {
      audio.muted = true;
      audio.src = audioUrlFor(newest);
      audio.play()
        .then(() => {
          // Skip the rollback if a real call started during priming.
          if (playingId === null) {
            audio.pause();
            audio.currentTime = 0;
          }
          audio.muted = false;
        })
        .catch(() => {
          audio.muted = false;
        });
    }
  }

  function stopScanner(): void {
    scannerRunning = false;
    resumeAfterManual = false;
    playQueue = [];
    setScannerPlaying(false);
    stopAudio();
    playingId = null;
    highlightRow(null);
    toggleBtn.classList.remove('listening');
    setChipLabel(null);
    setStatus(t('voice.status_paused'), 'warn');
    updateJumpLive();
  }

  scanPlayBtn.addEventListener('click', () => {
    if (!scannerRunning) {
      startScanner();
    } else {
      stopScanner();
    }
  });

  // ── Call list rendering ───────────────────────────────────────────────────

  function buildCallRow(call: Call): HTMLLIElement {
    const li = document.createElement('li');
    li.dataset['id'] = call.id;
    const color = channelColor(call.label);
    li.innerHTML = `
      <span class="vc-time" title="${clockTime(call.startedAt)}">${relativeTime(call.startedAt)}</span>
      <span class="vc-ch" style="color:${color}">${call.label}</span>
      <span class="vc-freq">${call.freq}</span>
      <span class="vc-dur">${formatDuration(call.durationS)}</span>
    `;
    li.addEventListener('click', () => {
      resumeAfterManual = scannerRunning;
      audio.pause();
      playSingleCall(call).catch((err: unknown) => {
        console.warn('[voice-calls] row click play failed', err);
        setStatus(
          t('voice.status_play_failed', { error: err instanceof Error ? err.message : String(err) }),
          'bad',
        );
      });
    });
    return li;
  }

  function renderCallList(): void {
    const all = getCalls();
    callListEl.innerHTML = '';
    for (const call of all) {
      callListEl.appendChild(buildCallRow(call));
    }
  }

  function prependCallRow(call: Call): void {
    const li = buildCallRow(call);
    if (callListEl.firstChild) {
      callListEl.insertBefore(li, callListEl.firstChild);
    } else {
      callListEl.appendChild(li);
    }
    while (callListEl.children.length > 150) {
      callListEl.lastElementChild?.remove();
    }
  }

  function refreshRelTimes(): void {
    for (const span of callListEl.querySelectorAll<HTMLElement>('.vc-time')) {
      const li = span.closest('li') as HTMLLIElement | null;
      if (!li) continue;
      const id = li.dataset['id'];
      const call = id ? findCall(id) : undefined;
      if (call) span.textContent = relativeTime(call.startedAt);
    }
  }

  relTimerHandle = window.setInterval(refreshRelTimes, 30_000);

  // ── Audio events ──────────────────────────────────────────────────────────

  audio.addEventListener('playing', () => {
    // The muted prime in startScanner() also fires 'playing'; ignore it so
    // priming doesn't flash the "streaming" indicator for a frame.
    if (audio.muted) return;
    audioPlaying = true;
    updateStreamingIndicator();
  });

  audio.addEventListener('pause', () => {
    audioPlaying = false;
    updateStreamingIndicator();
  });

  audio.addEventListener('ended', () => {
    audioPlaying = false;
    updateStreamingIndicator();

    if (resumeAfterManual) {
      resumeAfterManual = false;
      if (scannerRunning) advanceQueue();
    } else if (scannerRunning) {
      advanceQueue();
    }
  });

  audio.addEventListener('error', () => {
    audioPlaying = false;
    updateStreamingIndicator();
    const err = audio.error;
    const code = err ? t('voice.error_code', { n: err.code }) : t('voice.error_unknown');
    console.warn('[voice-calls] <audio> error', code, err?.message);

    if (scannerRunning) {
      setStatus(t('voice.status_clip_error', { code }), 'warn');
      setTimeout(() => { if (scannerRunning) advanceQueue(); }, 800);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Subscriptions (voice-calls.ts singleton)
  // ═══════════════════════════════════════════════════════════════════════

  const unsubCalls = subscribeCalls((_allCalls, newCall) => {
    if (newCall) {
      prependCallRow(newCall);

      if (scannerRunning) {
        if (!playingId || audio.paused) {
          // A blocked autoplay rejects play()'s promise (a DOMException) — it
          // does NOT fire the <audio> error event, so it must be caught here
          // or the scanner silently fails on every subsequent call.
          playSingleCall(newCall).catch((err: unknown) => {
            console.warn('[voice-panel] autoplay blocked on new call', err);
            scannerRunning = false;
            audioPlaying = false;
            setScannerPlaying(false);
            updateStreamingIndicator();
            setStatus(t('voice.status_autoplay_blocked'), 'warn');
          });
        } else {
          playQueue.push(newCall.id);
          updateJumpLive();
        }
      }
    } else {
      renderCallList();
      if (wsConnected) {
        setStatus(t('voice.status_ready'), 'ok');
      }
    }
  });

  const unsubActivity = subscribeActivity((payload) => {
    applyActivity(payload as Record<string, { freq: string; active: boolean }>);
  });

  const unsubConnection = subscribeConnection((connected) => {
    wsConnected = connected;
    updateStreamingIndicator();
    if (connected) {
      setStatus(scannerRunning ? t('voice.status_playing_scanner') : t('voice.status_ready'), 'ok');
    } else {
      setStatus(t('voice.status_reconnecting'), 'warn');
    }
  });

  // ── Destroy ───────────────────────────────────────────────────────────────
  return {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      unsubCalls();
      unsubActivity();
      unsubConnection();
      // Clear all hold timers.
      for (const t of holdTimers.values()) clearTimeout(t);
      holdTimers.clear();
      if (relTimerHandle !== null) {
        clearInterval(relTimerHandle);
        relTimerHandle = null;
      }
      stopAudio();
      container.innerHTML = '';
    },
  };
}
