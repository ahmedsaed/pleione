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

function fakeShaka(variants: { active: boolean; height: number }[] = []) {
  const configure = vi.fn(() => true);
  const load = vi.fn().mockResolvedValue(undefined);
  const listeners: Record<string, ((event: Event) => void)[]> = {};
  const emit = (type: string) => (listeners[type] ?? []).forEach(l => l(new Event(type)));
  class Player {
    static isBrowserSupported(): boolean { return true; }
    addEventListener(type: string, listener: (event: Event) => void): void {
      (listeners[type] ??= []).push(listener);
    }
    attach(): Promise<void> { return Promise.resolve(); }
    configure = configure;
    destroy(): Promise<void> { return Promise.resolve(); }
    getAudioTracks(): [] { return []; }
    getDrmInfo(): { keySystem: string } { return { keySystem: 'com.microsoft.playready' }; }
    getNetworkingEngine(): { registerRequestFilter: () => void } {
      return { registerRequestFilter: () => {} };
    }
    getTextTracks(): [] { return []; }
    getVariantTracks() {
      return variants.map(v => ({ ...v, audioCodec: null, channelsCount: null, frameRate: null, hdr: null, videoCodec: null }));
    }
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
  return { configure, load, emit };
}

describe('PlayerPipeline on Tizen', () => {
  it('plays PlayReady DASH through Shaka with the TV\'s EME, not a Luna DRM service', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(PLAYREADY_MPD))));
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

  it('steps a stream down a variant after the TV fails to decode the one playing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(PLAYREADY_MPD))));
    const { configure, load, emit } = fakeShaka([
      { active: true, height: 860 }, { active: false, height: 572 }, { active: false, height: 428 },
    ]);
    const { PlayerPipeline } = await import('./player-pipeline');
    const pipeline = new PlayerPipeline(callbacks());
    const video = document.createElement('video');
    vi.spyOn(video, 'play').mockResolvedValue();
    vi.spyOn(video, 'load').mockImplementation(() => {});
    pipeline.setVideoElement(video);
    const extras = { 'inputstream.adaptive.license_type': 'com.microsoft.playready' };
    const lines: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')); });

    pipeline.load('http://host/a.mpd', extras);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    emit('adaptation');
    pipeline.noteDecodeError();
    pipeline.load('http://host/a.mpd', extras);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    expect(configure).toHaveBeenLastCalledWith(expect.objectContaining({ restrictions: { maxHeight: 572 } }));
    expect(lines).toContainEqual(expect.stringMatching(
      /event=playback\.dash\.variant\.capped .*failedHeight=860 maxHeight=572/));
  });

  it('leaves a stream uncapped when the failing variant is already the shortest', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(PLAYREADY_MPD))));
    const { configure, load, emit } = fakeShaka([{ active: true, height: 428 }, { active: false, height: 860 }]);
    const { PlayerPipeline } = await import('./player-pipeline');
    const pipeline = new PlayerPipeline(callbacks());
    const video = document.createElement('video');
    vi.spyOn(video, 'play').mockResolvedValue();
    vi.spyOn(video, 'load').mockImplementation(() => {});
    pipeline.setVideoElement(video);

    pipeline.load('http://host/b.mpd', null);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    emit('adaptation');
    pipeline.noteDecodeError();
    pipeline.load('http://host/b.mpd', null);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    expect(configure).toHaveBeenLastCalledWith(expect.not.objectContaining({ restrictions: expect.anything() }));
  });
});
