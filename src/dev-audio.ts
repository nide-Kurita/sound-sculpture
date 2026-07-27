/**
 * 開発時のみ main から動的 import されるローカル音源カタログ。
 * `src/music` に置いたファイルが自動で選択肢になる。
 */

const musicModules = import.meta.glob<string>("./music/*.{mp3,m4a,wav,ogg,flac}", {
  eager: true,
  query: "?url",
  import: "default",
});

export type DevAudioTrack = {
  id: string;
  label: string;
  fileName: string;
  url: string;
};

const fileNameFromModulePath = (path: string) => {
  const base = path.split("/").pop() ?? path;
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
};

const labelFromFileName = (fileName: string) =>
  fileName.replace(/\.[^.]+$/u, "");

export const DEV_AUDIO_TRACKS: DevAudioTrack[] = Object.entries(musicModules)
  .map(([path, url]) => {
    const fileName = fileNameFromModulePath(path);
    return {
      id: fileName,
      fileName,
      label: labelFromFileName(fileName),
      url,
    };
  })
  .sort((a, b) => a.label.localeCompare(b.label, "ja"));

export const DEV_AUDIO_STORAGE_KEY = "sound-sculpture:dev-audio-track";

export const getDevAudioTrackById = (id: string | null | undefined) =>
  DEV_AUDIO_TRACKS.find((track) => track.id === id) ?? null;

export const readStoredDevAudioTrackId = (): string | null => {
  try {
    return window.localStorage.getItem(DEV_AUDIO_STORAGE_KEY);
  } catch {
    return null;
  }
};

export const writeStoredDevAudioTrackId = (id: string) => {
  try {
    window.localStorage.setItem(DEV_AUDIO_STORAGE_KEY, id);
  } catch {
    // ignore
  }
};

/** 保存済み → s04.wav → 先頭の順で既定トラックを決める */
export const resolveInitialDevAudioTrack = (): DevAudioTrack | null => {
  if (DEV_AUDIO_TRACKS.length === 0) {
    return null;
  }
  const stored = getDevAudioTrackById(readStoredDevAudioTrackId());
  if (stored) {
    return stored;
  }
  return (
    DEV_AUDIO_TRACKS.find((track) => track.fileName === "s04.wav") ??
    DEV_AUDIO_TRACKS[0]
  );
};
