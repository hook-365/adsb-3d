// Lazy aircraft photo lookup via the public planespotters.net API.
// Cached per page session; failures cache as null so we don't retry on
// every selection. CORS is open on api.planespotters.net so we can call
// it directly from the browser.

interface PhotoInfo {
  thumbUrl: string;
  largeUrl: string;
  link: string;
  photographer: string;
}

interface PlanespottersResponse {
  photos?: Array<{
    thumbnail?: { src?: string };
    thumbnail_large?: { src?: string };
    link?: string;
    photographer?: string;
  }>;
}

const cache = new Map<string, PhotoInfo | null>();
const inflight = new Map<string, Promise<PhotoInfo | null>>();

function readPhoto(json: PlanespottersResponse): PhotoInfo | null {
  const first = json.photos?.[0];
  if (!first) return null;
  const thumbUrl = first.thumbnail_large?.src ?? first.thumbnail?.src;
  if (!thumbUrl) return null;
  return {
    thumbUrl,
    largeUrl: first.thumbnail_large?.src ?? thumbUrl,
    link: first.link ?? '',
    photographer: first.photographer ?? ''
  };
}

export async function fetchPhoto(hex: string, registration: string | null): Promise<PhotoInfo | null> {
  const key = hex.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<PhotoInfo | null> => {
    try {
      const byHex = await fetch(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(key)}`);
      if (byHex.ok) {
        const photo = readPhoto((await byHex.json()) as PlanespottersResponse);
        if (photo) return photo;
      }
      // Fall back to registration if hex lookup didn't find anything.
      if (registration) {
        const byReg = await fetch(
          `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(registration)}`
        );
        if (byReg.ok) {
          const photo = readPhoto((await byReg.json()) as PlanespottersResponse);
          if (photo) return photo;
        }
      }
      return null;
    } catch {
      return null;
    }
  })();

  inflight.set(key, promise);
  const result = await promise;
  cache.set(key, result);
  inflight.delete(key);
  return result;
}

/**
 * Rewrite a planespotters CDN photo URL to the same-origin nginx proxy
 * (`/photos/...` → t.plnspttrs.net, see nginx.conf). DOM `<img>` consumers
 * don't need this, but anything drawing the photo into a canvas that feeds
 * a WebGL texture does — a cross-origin image taints the canvas and the
 * texture upload throws. Returns null for hosts the proxy doesn't cover.
 */
export function sameOriginPhotoUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 't.plnspttrs.net') return null;
    return `/photos${u.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Photo-for-a-canvas loader shared by the XR billboard and the desktop
 * HUD card (stereo panel): tracks one hex at a time, fetches + decodes
 * its photo through the same-origin proxy, and calls `onLoad` when a
 * drawable image is ready. Every await is guarded against the tracked
 * hex moving on, so a late arrival can never clobber a newer aircraft's
 * (absent or different) photo. A hex change drops the old image
 * immediately — a stale picture is worse than none.
 */
export class CanvasPhoto {
  private hex: string | null = null;
  private img: HTMLImageElement | null = null;
  private creditStr = '';

  constructor(private readonly onLoad: () => void) {}

  /** Ready-to-draw image for the tracked hex, or null while loading/absent. */
  get image(): HTMLImageElement | null {
    return this.img;
  }

  /** Attribution line ("© photographer"), empty when unknown. */
  get credit(): string {
    return this.creditStr;
  }

  track(hex: string, registration: string | null): void {
    if (hex === this.hex) return;
    this.hex = hex;
    this.img = null;
    this.creditStr = '';
    void this.load(hex, registration);
  }

  private async load(hex: string, registration: string | null): Promise<void> {
    const info = await fetchPhoto(hex, registration);
    if (this.hex !== hex || !info) return;
    const url = sameOriginPhotoUrl(info.thumbUrl);
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      if (this.hex !== hex) return;
      this.img = img;
      this.creditStr = info.photographer ? `© ${info.photographer}` : '';
      this.onLoad();
    };
    // onerror deliberately unhandled: no photo box is the fallback state.
    img.src = url;
  }
}

export type { PhotoInfo };
