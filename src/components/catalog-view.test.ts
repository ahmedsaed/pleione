// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { railEdgeGutters } from './catalog-view';

afterEach(() => {
  delete document.documentElement.dataset.interfaceSize;
});

describe('railEdgeGutters', () => {
  it('keeps a revealed tile on the track padding when the padding is the wider', () => {
    expect(railEdgeGutters({ paddingLeft: '80px', paddingRight: '20px' })).toEqual({ lead: 80, trail: 20 });
  });

  it('scales the minimum gutter with the Interface size, so a scaled 12px padding is the keyline', () => {
    document.documentElement.dataset.interfaceSize = '90';
    const { lead } = railEdgeGutters({ paddingLeft: '10.8px', paddingRight: '18px' });
    expect(lead).toBeCloseTo(10.8);
  });
});
