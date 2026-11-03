// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { PlayerPipelineOptions } from './player-pipeline';

vi.mock('../services/idb-cache', () => ({
  getCachedStreamMime: vi.fn(),
  setCachedStreamMime: vi.fn(),
}));

// The Samsung build: native playback, and no Luna DRM service.
vi.mock('../platform', async () => ({ platform: (await import('../platform/tizen')).tizen }));

function callbacks(): PlayerPipelineOptions {
  return {
    playbackLabel: token => `load=${String(token)}`,
    mediaState: () => '',
    isCatchup: () => false,
    onError: vi.fn(),
    onAudioTracksUpdated: vi.fn(),
    onSubtitleTracksUpdated: vi.fn(),
    onManifest: vi.fn(),
  };
}

const PLAYREADY_MPD = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"/>
      <Representation id="v1" width="1920" height="1080" codecs="avc1.640028"/>
    </AdaptationSet>
  </Period>
</MPD>`;

function fakeShaka() {
  const configure = vi.fn(() => true);
  const load = vi.fn().mockResolvedValue(undefined);
  class Player {
    static isBrowserSupported(): boolean { return true; }
    addEventListener(): void {}
    attach(): Promise<void> { return Promise.resolve(); }
    configure = configure;
    destroy(): Promise<void> { return Promise.resolve(); }
    getAudioTracks(): [] { return []; }
    getDrmInfo(): { keySystem: string } { return { keySystem: 'com.microsoft.playready' }; }
    getNetworkingEngine(): { registerRequestFilter: () => void } {
      return { registerRequestFilter: () => {} };
    }
    getTextTracks(): [] { return []; }
    getVariantTracks(): [] { return []; }
    load = load;
    selectAudioTrack(): void {}
    selectTextTrack(): void {}
  }
  vi.stubGlobal('__shaka', {
    Player,
    net: { NetworkingEngine: { RequestType: { LICENSE: 2 } } },
    polyfill: { installAll: vi.fn() },
    util: { Error: { Severity: { CRITICAL: 2 } } },
  });
  return { configure, load };
}

describe('PlayerPipeline on Tizen', () => {
  it('plays PlayReady DASH through Shaka with the TV\'s EME, not a Luna DRM service', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(PLAYREADY_MPD)));
    const bridge = vi.fn();
    Object.defineProperty(window, 'PalmServiceBridge', { configurable: true, value: bridge });
    const { configure, load } = fakeShaka();
    const { PlayerPipeline } = await import('./player-pipeline');
    const pipeline = new PlayerPipeline(callbacks());
    const video = document.createElement('video');
    vi.spyOn(video, 'play').mockResolvedValue();
    vi.spyOn(video, 'load').mockImplementation(() => {});
    pipeline.setVideoElement(video);

    pipeline.load('http://host/a.mpd', {
      'inputstream.adaptive.license_type': 'com.microsoft.playready',
      'inputstream.adaptive.license_key': 'http://host/license',
    });

    await vi.waitFor(() => expect(load).toHaveBeenCalledWith('http://host/a.mpd'));
    expect(configure).toHaveBeenCalledWith({
      streaming: { bufferingGoal: 30 },
      drm: {
        preferredKeySystems: ['com.microsoft.playready'],
        servers: { 'com.microsoft.playready': 'http://host/license' },
      },
    });
    expect(bridge).not.toHaveBeenCalled();
    expect(video.querySelector('source')).toBeNull();
    await vi.waitFor(() => expect(pipeline.drmLabel()).toBe('PlayReady'));
  });
});
