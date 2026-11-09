// Footer bottom-row layout decision, kept pure so it can be unit tested.
//
// The altitude legend sits in the footer's last row and the map
// attribution is a separate fixed element in the bottom-right corner (it
// has to outlive the footer's idle fade: a licence condition). The two
// share one line of screen, so once the credit grows (storms, lightning
// and an Explore provider can push it past 500px) and the viewport
// shrinks, they collide. `shouldStackAttribution` says when the credit
// should ride above the footer instead; hud.ts applies it as
// `<html data-attribution-stacked>` and style.css does the rest.

/** Side padding + the gap kept between the legend and the credit. */
export const FOOTER_ROW_SLACK_PX = 72;

export function shouldStackAttribution(legendWidthPx: number, attributionWidthPx: number, viewportWidthPx: number): boolean {
  if (!(attributionWidthPx > 0)) return false;
  return legendWidthPx + attributionWidthPx + FOOTER_ROW_SLACK_PX > viewportWidthPx;
}

/** Natural width of a flex row's children, ignoring any squeeze. */
export function rowContentWidth(children: Iterable<Element>, gapPx: number): number {
  let w = 0;
  let n = 0;
  for (const c of children) {
    w += c.getBoundingClientRect().width;
    n++;
  }
  return w + gapPx * Math.max(0, n - 1);
}
