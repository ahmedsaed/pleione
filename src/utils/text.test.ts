import { describe, it, expect, vi } from 'vitest';
import { cutMiddle, truncate } from './text';

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('Alpha', 40)).toBe('Alpha');
    expect(truncate('', 5)).toBe('');
  });

  it('leaves a string exactly at the cap untouched (no ellipsis)', () => {
    expect(truncate('12345', 5)).toBe('12345');
  });

  it('truncates and appends an ellipsis when over the cap', () => {
    expect(truncate('123456', 5)).toBe('12345…');
  });

  it('counts by code point so astral characters are kept whole, not split', () => {
    // '😀' is a surrogate pair (.length 2); code-point truncation never cuts it
    // in half. Same mechanism applies to CJK Extension-B ideographs.
    expect(truncate('a😀b', 2)).toBe('a😀…');
    expect(truncate('😀😀', 2)).toBe('😀😀');
  });
});

describe('cutMiddle', () => {
  const within = (max: number) => (text: string) => Array.from(text).length <= max;

  it('never measures the whole name, which the caller found too long', () => {
    const fits = vi.fn(within(24));
    cutMiddle('EN | Alpha Studio Movies Collection 2024', fits);
    expect(fits).not.toHaveBeenCalledWith('EN | Alpha Studio Movies Collection 2024');
  });

  it('keeps the start and the end, cutting the middle', () => {
    expect(cutMiddle('EN | Alpha Studio Movies Collection 2024', within(24))).toBe('EN | Alpha Studio… 2024');
  });

  it('keeps the last word, and the one before a very short one', () => {
    expect(cutMiddle('EN | Bravo Network Series - Kids & Family', within(26))).toBe('EN | Bravo Network… Family');
    expect(cutMiddle('EN | Bravo Network Series Collection - S 2', within(26))).toBe('EN | Bravo Network Se… S 2');
  });

  it('drops a separator left dangling before the cut', () => {
    expect(cutMiddle('EN | Bravo Network 2023', within(10))).toBe('EN… 2023');
  });

  it('keeps only the end when no start fits, and leaves a single word alone', () => {
    expect(cutMiddle('Alpha Bravo Charlie 2024', within(6))).toBe('… 2024');
    expect(cutMiddle('Supercalifragilistic', within(5))).toBe('Supercalifragilistic');
  });

  it('cuts at underscores, hyphens, dots and bars too, keeping the year', () => {
    expect(cutMiddle('VOD EN_ALPHA_STUDIO_MOVIES_ACTION_COLLECTION_2024', within(26)))
      .toBe('VOD EN_ALPHA_STUDIO… 2024');
    expect(cutMiddle('EN | Alpha-Studio-Movies-Action-2024', within(20))).toBe('EN | Alpha-Stu… 2024');
    expect(cutMiddle('EN | Alpha.Studio.Movies.Action.2024', within(20))).toBe('EN | Alpha.Stu… 2024');
  });

  it('leaves the name for the line clamp when even its end does not fit', () => {
    const name = 'EN | AlphaStudioMoviesActionCollectionBravo2024';
    expect(cutMiddle(name, within(20))).toBe(name);
  });
});
