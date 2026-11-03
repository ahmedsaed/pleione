import { describe, expect, it } from 'vitest';
import { TIZEN_APP_ID, TIZEN_LAN_SERVICE_ID, TIZEN_PACKAGE_ID, tizenConfigXml } from './tizen-config.mjs';

describe('tizenConfigXml', () => {
  it('keeps the permanent package id and derives the app id from it', () => {
    expect(TIZEN_PACKAGE_ID).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(TIZEN_APP_ID).toBe(`${TIZEN_PACKAGE_ID}.PleioneIPTV`);
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

  it('declares the LAN service the app launches, and the privilege to launch it', () => {
    const xml = tizenConfigXml('2.1.0');
    expect(TIZEN_LAN_SERVICE_ID).toBe(`${TIZEN_PACKAGE_ID}.PleioneLan`);
    expect(xml).toContain(`<tizen:service id="${TIZEN_LAN_SERVICE_ID}"`);
    expect(xml).toContain('<tizen:content src="service/tizen.js"/>');
    expect(xml).toContain('http://tizen.org/privilege/application.launch');
  });

  it('declares every screen size, which Seller Office pre-testing requires', () => {
    expect(tizenConfigXml('2.1.0')).toContain('<feature name="http://tizen.org/feature/screen.size.all"/>');
    expect(tizenConfigXml('2.1.0', { service: false }))
      .toContain('<feature name="http://tizen.org/feature/screen.size.all"/>');
  });

  it('leaves the LAN service and its privilege out of the store package', () => {
    const xml = tizenConfigXml('2.1.0', { service: false });
    expect(xml).not.toContain('<tizen:service');
    expect(xml).not.toContain('http://tizen.org/feature/web.service');
    expect(xml).not.toContain('http://tizen.org/privilege/application.launch');
    expect(xml).toContain('http://tizen.org/privilege/internet');
    expect(xml).toContain(`<tizen:application id="${TIZEN_APP_ID}" package="${TIZEN_PACKAGE_ID}"`);
  });

  it('rejects a version Tizen cannot read', () => {
    expect(() => tizenConfigXml('2.1.0-beta')).toThrow(/x\.y\.z/);
  });
});
