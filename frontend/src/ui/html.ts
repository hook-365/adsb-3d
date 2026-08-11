/**
 * Escape a string for interpolation into innerHTML markup — element text
 * and double-quoted attribute values alike. Anything that reached us from
 * a remote source (feeder JSON, adsb.im route names, ACARS payloads,
 * voice-service call metadata) must pass through here before it is
 * embedded in an HTML template string.
 */
export function escapeHtml(s: string): string {
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
