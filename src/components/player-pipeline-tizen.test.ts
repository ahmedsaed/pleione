// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { PlatformMedia } from '../platform/types';
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
    onMediaChanged: vi.fn(),
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

function fakePlatformMedia(): PlatformMedia {
  return Object.assign(document.createElement('video'), { start: vi.fn(), release: vi.fn() });
}

describe('PlayerPipeline on Tizen: raw MPEG-TS', () => {
  async function setup() {
    localStorage.clear();
    const { tizen } = await import('../platform/tizen');
    const media = fakePlatformMedia();
    const playPlatform = vi.spyOn(tizen.media, 'createPlatformMedia').mockReturnValue(media);
    const { PlayerPipeline } = await import('./player-pipeline');
    const options = callbacks();
    const pipeline = new PlayerPipeline(options);
    const video = document.createElement('video');
    vi.spyOn(video, 'play').mockResolvedValue();
    vi.spyOn(video, 'load').mockImplementation(() => {});
    pipeline.setVideoElement(video);
    return { pipeline, video, playPlatform, media, options };
  }

  // What Tizen 9's <video> does with raw TS: it loads, knows the frame size,
  // and decodes nothing.
  function loadsWithoutFrames(video: HTMLVideoElement): void {
    Object.defineProperty(video, 'readyState', { configurable: true, get: () => 4 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
  }

  it('hands a TS stream the TV loads but never decodes to the TV\'s own player, and remembers it', async () => {
    vi.useFakeTimers();
    try {
      const { pipeline, video, playPlatform } = await setup();
      const lines: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')); });

      pipeline.load('http://host/live/1.ts', null);
      expect(video.querySelector('source')?.type).toBe('video/mp2t');
      loadsWithoutFrames(video);
      await vi.advanceTimersByTimeAsync(6000);

      expect(playPlatform).toHaveBeenCalledWith(video, 'http://host/live/1.ts');
      expect(lines).toContainEqual(expect.stringMatching(/event=playback\.native_ts\.checked .*result=broken/));
      expect(lines).toContainEqual(expect.stringMatching(/event=playback\.path\.platform .*reason=detected/));

      playPlatform.mockClear();
      pipeline.load('http://host/live/2.ts', null);
      expect(playPlatform).toHaveBeenCalledWith(video, 'http://host/live/2.ts');
      expect(lines).toContainEqual(expect.stringMatching(/event=playback\.path\.platform .*reason=remembered/));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps TS on the native element when it plays there', async () => {
    vi.useFakeTimers();
    try {
      const { pipeline, video, playPlatform } = await setup();
      pipeline.load('http://host/live/1.ts', null);
      loadsWithoutFrames(video);
      Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 2 });
      await vi.advanceTimersByTimeAsync(6000);

      expect(playPlatform).not.toHaveBeenCalled();
      pipeline.load('http://host/live/2.ts', null);
      expect(video.querySelector('source')?.src).toBe('http://host/live/2.ts');
      await vi.advanceTimersByTimeAsync(6000);
      expect(playPlatform).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // Tizen 5.5 with a stream that takes seconds to start: the frame size
  // arrives at readyState 2 well before the first frame.
  it('waits out a TS stream still buffering before it plays', async () => {
    vi.useFakeTimers();
    try {
      const { pipeline, video, playPlatform } = await setup();
      pipeline.load('http://host/live/1.ts', null);
      loadsWithoutFrames(video);
      Object.defineProperty(video, 'readyState', { configurable: true, get: () => 2 });
      await vi.advanceTimersByTimeAsync(6000);
      expect(playPlatform).not.toHaveBeenCalled();

      Object.defineProperty(video, 'readyState', { configurable: true, get: () => 4 });
      Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 1 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(playPlatform).not.toHaveBeenCalled();
      expect(localStorage.getItem('iptv_native_ts_check')).toBe(JSON.stringify('ok'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a verdict the earlier check stored, so the TV checks again', async () => {
    const { pipeline, video, playPlatform } = await setup();
    localStorage.setItem('iptv_native_ts_playback', JSON.stringify('broken'));
    pipeline.load('http://host/live/1.ts', null);

    expect(playPlatform).not.toHaveBeenCalled();
    expect(video.querySelector('source')?.type).toBe('video/mp2t');
    expect(localStorage.getItem('iptv_native_ts_playback')).toBeNull();
  });

  it('reaches no verdict while the first TS stream is paused', async () => {
    vi.useFakeTimers();
    try {
      const { pipeline, video, playPlatform } = await setup();
      pipeline.load('http://host/live/1.ts', null);
      loadsWithoutFrames(video);
      Object.defineProperty(video, 'paused', { configurable: true, get: () => true });
      await vi.advanceTimersByTimeAsync(10000);

      expect(playPlatform).not.toHaveBeenCalled();
      expect(localStorage.getItem('iptv_native_ts_check')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases the TV\'s player when the next stream loads', async () => {
    localStorage.setItem('iptv_native_ts_check', JSON.stringify('broken'));
    const { tizen } = await import('../platform/tizen');
    const media = fakePlatformMedia();
    vi.spyOn(tizen.media, 'createPlatformMedia').mockReturnValue(media);
    const { PlayerPipeline } = await import('./player-pipeline');
    const options = callbacks();
    const pipeline = new PlayerPipeline(options);
    const video = document.createElement('video');
    vi.spyOn(video, 'play').mockResolvedValue();
    vi.spyOn(video, 'load').mockImplementation(() => {});
    pipeline.setVideoElement(video);

    pipeline.load('http://host/live/1.ts', null);
    // Player hears of the TV's player before it opens the stream.
    expect(options.onMediaChanged).toHaveBeenLastCalledWith(media);
    expect(media.start).toHaveBeenCalledTimes(1);
    pipeline.load('http://host/a.m3u8', null);

    expect(media.release).toHaveBeenCalledTimes(1);
    expect(options.onMediaChanged).toHaveBeenLastCalledWith(null);
    expect(video.querySelector('source')?.type).toBe('application/vnd.apple.mpegurl');
  });
});

describe('PlayerPipeline on Tizen 8 and later', () => {
  async function setup(prefers: boolean) {
    localStorage.clear();
    const { tizen } = await import('../platform/tizen');
    const media = fakePlatformMedia();
    const create = vi.spyOn(tizen.media, 'createPlatformMedia').mockReturnValue(media);
    vi.spyOn(tizen.media, 'prefersPlatformMedia').mockReturnValue(prefers);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('#EXTM3U\n'))));
    const { PlayerPipeline } = await import('./player-pipeline');
    const pipeline = new PlayerPipeline(callbacks());
    const video = document.createElement('video');
    vi.spyOn(video, 'play').mockResolvedValue();
    vi.spyOn(video, 'load').mockImplementation(() => {});
    pipeline.setVideoElement(video);
    return { pipeline, video, create };
  }

  it('plays HLS, raw TS and single-file movies through the TV\'s own player, for their tracks', async () => {
    const { pipeline, video, create } = await setup(true);
    pipeline.load('http://host/live/1.m3u8', null);
    expect(create).toHaveBeenLastCalledWith(video, 'http://host/live/1.m3u8');
    pipeline.load('http://host/live/1.ts', null);
    expect(create).toHaveBeenLastCalledWith(video, 'http://host/live/1.ts');
    pipeline.load('http://host/movie/1.mkv', null, { direct: true });
    expect(create).toHaveBeenLastCalledWith(video, 'http://host/movie/1.mkv');
    expect(create).toHaveBeenCalledTimes(3);
    expect(video.querySelector('source')).toBeNull();
  });

  it('keeps DASH off the TV\'s own player', async () => {
    const { pipeline, create } = await setup(true);
    pipeline.load('http://host/a.mpd', null);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 0));
    expect(create).not.toHaveBeenCalled();
  });

  it('leaves an older TV on its own <video>, which switches tracks there', async () => {
    const { pipeline, video, create } = await setup(false);
    pipeline.load('http://host/live/1.m3u8', null);
    pipeline.load('http://host/movie/1.mkv', null, { direct: true });
    expect(create).not.toHaveBeenCalled();
    expect(video.querySelector('source')?.src).toBe('http://host/movie/1.mkv');
  });
});
