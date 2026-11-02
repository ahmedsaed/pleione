import { describe, expect, it } from 'vitest';
import { TIZEN_APP_ID, TIZEN_PACKAGE_ID, tizenConfigXml } from './tizen-config.mjs';

describe('tizenConfigXml', () => {
  it('keeps the permanent package id and derives the app id from it', () => {
    expect(TIZEN_PACKAGE_ID).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(TIZEN_APP_ID).toBe(`${TIZEN_PACKAGE_ID}.Pleione`);
    expect(tizenConfigXml('2.1.0')).toContain(`<tizen:application id="${TIZEN_APP_ID}" package="${TIZEN_PACKAGE_ID}"`);
  });

  it('carries the package.json version and the Samsung TV profile', () => {
    const xml = tizenConfigXml('2.1.0');
    expect(xml).toContain('version="2.1.0"');
    expect(xml).toContain('<tizen:profile name="tv-samsung"/>');
  });

  it('declares the privileges the app uses and leaves hardware keys to the app', () => {
    const xml = tizenConfigXml('2.1.0');
    expect(xml).toContain('http://tizen.org/privilege/internet');
    expect(xml).toContain('http://tizen.org/privilege/tv.inputdevice');
    expect(xml).toContain('hwkey-event="enable"');
  });

  it('rejects a version Tizen cannot read', () => {
    expect(() => tizenConfigXml('2.1.0-beta')).toThrow(/x\.y\.z/);
  });
});
