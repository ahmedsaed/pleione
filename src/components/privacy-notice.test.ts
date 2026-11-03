// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platformMock = vi.hoisted(() => ({ platform: { privacyConsent: true } }));
vi.mock('../platform', () => platformMock);

import { StorageService } from '../services/storage-service';
import { needsPrivacyConsent, withPrivacyConsent } from './privacy-notice';

const dialog = () => document.querySelector('.confirmation-prompt:not(.hidden)');
const press = (action: 'confirm' | 'cancel') =>
  document.querySelector<HTMLElement>(`[data-confirm-action="${action}"]`)!.click();

describe('withPrivacyConsent', () => {
  let lines: string[];
  beforeEach(() => {
    localStorage.clear();
    platformMock.platform.privacyConsent = true;
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
  });
  afterEach(() => {
    document.querySelector<HTMLElement>('[data-confirm-action="cancel"]')?.click();
    vi.restoreAllMocks();
  });

  it('runs the action at once where the platform asks for no consent', () => {
    platformMock.platform.privacyConsent = false;
    const onAgree = vi.fn();
    withPrivacyConsent(onAgree);
    expect(onAgree).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
  });

  it('asks first, with Agree focused, and remembers an agreement', () => {
    const onAgree = vi.fn();
    expect(needsPrivacyConsent()).toBe(true);
    withPrivacyConsent(onAgree);
    expect(dialog()?.textContent).toContain('Your privacy');
    expect(dialog()?.querySelector('.focused')?.getAttribute('data-key')).toBe('confirm');
    expect(onAgree).not.toHaveBeenCalled();
    press('confirm');
    expect(onAgree).toHaveBeenCalledOnce();
    expect(StorageService.hasPrivacyConsent()).toBe(true);
    expect(needsPrivacyConsent()).toBe(false);
    expect(lines).toContainEqual(expect.stringMatching(/event=privacy\.consent outcome=agreed/));
    const again = vi.fn();
    withPrivacyConsent(again);
    expect(again).toHaveBeenCalledOnce();
  });

  it('keeps no answer on Not now, so the next try asks again', () => {
    const onAgree = vi.fn();
    const onDecline = vi.fn();
    withPrivacyConsent(onAgree, onDecline);
    press('cancel');
    expect(onAgree).not.toHaveBeenCalled();
    expect(onDecline).toHaveBeenCalledOnce();
    expect(StorageService.hasPrivacyConsent()).toBe(false);
    expect(lines).toContainEqual(expect.stringMatching(/event=privacy\.consent outcome=declined/));
    withPrivacyConsent(onAgree);
    expect(dialog()).not.toBeNull();
  });
});
