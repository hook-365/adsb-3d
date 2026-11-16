import bundled from './cifp-edition.json';
import navdataUrl from './navdata.json?url';
import indexUrl from './procedures-index.json?url';
import packUrl from './procedures.pack?url';

// Where the FAA CIFP data comes from: the copy built into the app, or a
// newer edition the container has built for itself (entrypoint.sh,
// ENABLE_DATA_REFRESH, scripts/refresh-cifp.py; the FAA publishes one
// every 28 days). The container leaves a manifest at /cifp/manifest.json;
// when it names an edition newer than the bundled one, all three files are
// read from /cifp/ instead. Anything else (no manifest, an older edition)
// means the bundled copy.
//
// Decided once per page load, and all three files always come from the
// same edition.

const MANIFEST_URL = '/cifp/manifest.json';

export interface CifpSource {
  indexUrl: string;
  packUrl: string;
  navdataUrl: string;
  /** True when the container's refreshed edition is in use. */
  refreshed: boolean;
}

const BUNDLED: CifpSource = { indexUrl, packUrl, navdataUrl, refreshed: false };

/** Pure: the refreshed edition's URLs when the manifest names a newer edition, else null. */
export function refreshedSource(manifest: unknown, bundledEffective: string): CifpSource | null {
  const m = manifest as { cycle?: unknown; effective?: unknown } | null;
  if (!m || typeof m !== 'object') return null;
  if (typeof m.cycle !== 'string' || !/^\d{4}$/.test(m.cycle)) return null;
  if (typeof m.effective !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.effective)) return null;
  // ISO dates compare as text.
  if (m.effective <= bundledEffective) return null;
  // The cycle in the URL keeps a browser from pairing one edition's index with another's pack.
  const q = `?c=${m.cycle}`;
  return {
    indexUrl: `/cifp/procedures-index.json${q}`,
    packUrl: `/cifp/procedures.pack${q}`,
    navdataUrl: `/cifp/navdata.json${q}`,
    refreshed: true,
  };
}

let source: Promise<CifpSource> | null = null;

export function cifpSource(): Promise<CifpSource> {
  source ??= Promise.resolve()
    .then(() => fetch(MANIFEST_URL, { cache: 'no-store' }))
    .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
    .then((manifest) => refreshedSource(manifest, bundled.effective) ?? BUNDLED)
    .catch(() => BUNDLED);
  return source;
}
