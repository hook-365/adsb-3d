// Release update check. The container (entrypoint.sh) asks GitHub once a
// day for the latest release and writes /update.json next to config.js;
// this module polls that same-origin file and exposes the result through
// the usual subscribe-pattern singleton. Browsers never talk to GitHub.
//
// Nothing here is persisted: a reload re-reads the file, and a deployment
// with ENABLE_UPDATE_CHECK=false renders no file (404) and no flag, so the
// fetch is skipped outright.

export interface UpdateInfo {
  /** Version this page is running (window.APP_VERSION, may carry +build). */
  current: string;
  /** Latest release, X.Y.Z. */
  latest: string;
  /** Release page for `latest`. */
  url: string;
  /** True when `latest` is strictly newer than the base of `current`. */
  newer: boolean;
}

interface UpdateJson {
  current?: unknown;
  latest?: unknown;
  url?: unknown;
}

declare global {
  interface Window {
    UPDATE_CHECK_CONFIG?: { enabled?: boolean };
  }
}

const UPDATE_URL = '/update.json';
const POLL_INTERVAL_MS = 60 * 60 * 1000;
const RELEASES_URL = 'https://github.com/hook-365/adsb-3d/releases';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

let info: UpdateInfo | null = null;
const listeners = new Set<(info: UpdateInfo | null) => void>();

/** "1.2.3+abc" / "v1.2.3-rc1" -> "1.2.3"; null if it does not look like a version. */
export function baseVersion(v: string): string | null {
  const base = v.trim().replace(/^v/, '').replace(/[+-].*$/, '');
  return SEMVER.test(base) ? base : null;
}

/** True when `latest` is strictly newer than `current` (build metadata ignored). */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = baseVersion(latest);
  const b = baseVersion(current);
  if (!a || !b) return false;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

/** Shape-check one /update.json payload against the page's own version. */
export function parseUpdateJson(raw: unknown, pageVersion: string | undefined): UpdateInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as UpdateJson;
  if (typeof j.latest !== 'string' || !baseVersion(j.latest)) return null;
  const current =
    pageVersion ?? (typeof j.current === 'string' ? j.current : '');
  if (!baseVersion(current)) return null;
  const url =
    typeof j.url === 'string' && j.url.startsWith('https://github.com/hook-365/adsb-3d/')
      ? j.url
      : RELEASES_URL;
  return { current, latest: baseVersion(j.latest)!, url, newer: isNewerVersion(j.latest, current) };
}

export function getUpdateInfo(): UpdateInfo | null {
  return info;
}

export function subscribeUpdateInfo(fn: (info: UpdateInfo | null) => void): () => void {
  listeners.add(fn);
  fn(info);
  return () => {
    listeners.delete(fn);
  };
}

function publish(next: UpdateInfo | null): void {
  if (
    next === info ||
    (next && info && next.latest === info.latest && next.newer === info.newer && next.url === info.url)
  ) {
    return;
  }
  info = next;
  for (const fn of listeners) fn(info);
}

async function pollOnce(): Promise<void> {
  try {
    const res = await fetch(UPDATE_URL, { cache: 'no-store' });
    if (!res.ok) return; // 404 until the first daily check completes
    publish(parseUpdateJson(await res.json(), window.APP_VERSION));
  } catch {
    // Offline / transient: keep whatever we last knew.
  }
}

/** Boot hook (main.ts). No-op when the deployment disabled the check. */
export function startUpdateCheck(): void {
  if (window.UPDATE_CHECK_CONFIG?.enabled === false) return;
  void pollOnce();
  window.setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
}
