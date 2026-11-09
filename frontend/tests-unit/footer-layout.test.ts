import { describe, expect, it } from 'vitest';
import { FOOTER_ROW_SLACK_PX, rowContentWidth, shouldStackAttribution } from '../src/ui/footer-layout';

describe('footer attribution stacking', () => {
  it('stacks only when the legend row and the credit cannot share the viewport width', () => {
    // 640px legend + 510px credit (storms + lightning + Explore) + slack: no fit at 900, fit at 1400.
    expect(shouldStackAttribution(640, 510, 900)).toBe(true);
    expect(shouldStackAttribution(640, 510, 1400)).toBe(false);
    expect(shouldStackAttribution(640, 510, 640 + 510 + FOOTER_ROW_SLACK_PX)).toBe(false); // exactly fits
    expect(shouldStackAttribution(640, 510, 640 + 510 + FOOTER_ROW_SLACK_PX - 1)).toBe(true);
  });

  it('never stacks for an empty credit', () => {
    expect(shouldStackAttribution(2000, 0, 300)).toBe(false);
    expect(shouldStackAttribution(2000, NaN, 300)).toBe(false);
  });

  it('sums children widths plus the gaps between them', () => {
    const child = (width: number): Element => ({ getBoundingClientRect: () => ({ width }) }) as unknown as Element;
    expect(rowContentWidth([child(20), child(280), child(300)], 8)).toBe(616);
    expect(rowContentWidth([child(280)], 8)).toBe(280);
    expect(rowContentWidth([], 8)).toBe(0);
  });
});
