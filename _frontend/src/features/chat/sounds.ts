/**
 * Session finish sound playback utility.
 * Loads and plays success/error sounds on turn completion.
 */

type SoundType = "success" | "error";

interface AudioCache {
  success: HTMLAudioElement | null;
  error: HTMLAudioElement | null;
}

const audioCache: AudioCache = {
  success: null,
  error: null,
};

const SOUND_URLS: Record<SoundType, string> = {
  success: "/sounds/success.ogg",
  error: "/sounds/error.ogg",
};

/** Load a sound into the cache (lazy, idempotent). */
function loadSound(type: SoundType): HTMLAudioElement {
  const cached = audioCache[type];
  if (cached) return cached;

  const audio = new Audio(SOUND_URLS[type]);
  audio.preload = "auto";
  audio.volume = 0.5; // Moderate volume, not jarring
  audioCache[type] = audio;
  return audio;
}

/** Play a finish sound. Fails silently on autoplay block or missing file. */
export function playFinishSound(success: boolean): void {
  const type: SoundType = success ? "success" : "error";
  const audio = loadSound(type);

  // Clone to allow overlapping plays (e.g., rapid turn completions)
  const instance = audio.cloneNode() as HTMLAudioElement;
  instance.volume = audio.volume;

  const playPromise = instance.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      // Autoplay blocked or file not found — fail silently per spec
    });
  }
}

/** Preload both sounds (call after first user interaction to unlock audio). */
export function preloadFinishSounds(): void {
  loadSound("success");
  loadSound("error");
}

/** Set volume for future playbacks (0.0 to 1.0). */
export function setFinishSoundVolume(volume: number): void {
  const clamped = Math.max(0, Math.min(1, volume));
  if (audioCache.success) audioCache.success.volume = clamped;
  if (audioCache.error) audioCache.error.volume = clamped;
}
