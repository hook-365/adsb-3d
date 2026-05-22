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

export type { PhotoInfo };
