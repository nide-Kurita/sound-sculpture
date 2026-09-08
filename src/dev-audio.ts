/**
 * 開発時のみ main から動的 import されるローカル音源カタログ。
 * `src/music` に置いたファイルが自動で選択肢になる。
 *
 * **`import.meta.glob` は使わない。**
 * 使うと本番ビルドで `src/music` の WAV（434MB・市販曲）が `dist/assets` へ出力され、
 * URL 直打ちでダウンロードできる状態で公開される（2026-09-08 に確認）。
 * `import.meta.env.DEV` で分岐しても glob は展開されてしまうので、
 * **モジュールグラフから外す**しかない。
 *
 * 代わりに、dev サーバーのプラグイン（`vite.config.ts` の `dev-music-manifest`）が
 * 返すファイル名一覧を実行時に取得する。音源自体は Vite が `/src/music/<name>` で配る。
 * 本番ではプラグインが動かず取得に失敗して空になる（Dev Audio は公開 UI に出ない）。
 *
 * **カタログは非同期。`loadDevAudioTracks()` を await してから他の関数を使うこと。**
 */

export type DevAudioTrack = {
  id: string;
  label: string;
  fileName: string;
  url: string;
};

const labelFromFileName = (fileName: string) => fileName.replace(/\.[^.]+$/u, "");

/** 読み込み済みカタログ。`loadDevAudioTracks()` が埋める */
export const DEV_AUDIO_TRACKS: DevAudioTrack[] = [];

let loaded: Promise<DevAudioTrack[]> | null = null;

/** マニフェストを取得してカタログを埋める。2回目以降は同じ Promise を返す */
export const loadDevAudioTracks = (): Promise<DevAudioTrack[]> => {
  if (loaded) return loaded;
  loaded = (async () => {
    if (!import.meta.env.DEV) return DEV_AUDIO_TRACKS;
    try {
      const res = await fetch("/__dev-music/manifest.json");
      if (!res.ok) return DEV_AUDIO_TRACKS;
      const files = (await res.json()) as string[];
      const tracks = files
        .map((fileName) => ({
          id: fileName,
          fileName,
          label: labelFromFileName(fileName),
          url: `/src/music/${encodeURIComponent(fileName)}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "ja"));
      DEV_AUDIO_TRACKS.length = 0;
      DEV_AUDIO_TRACKS.push(...tracks);
    } catch {
      // 本番・音源なしはここに来る。空のままでよい
    }
    return DEV_AUDIO_TRACKS;
  })();
  return loaded;
};

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
