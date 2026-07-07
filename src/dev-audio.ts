/** 開発時のみ main から動的 import されるローカル音源 */
export const DEV_AUDIO_URL = new URL("./s04.wav", import.meta.url).href;
