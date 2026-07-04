import { invoke } from '@tauri-apps/api/core';

/**
 * Tauri環境で動いているかどうか(ブラウザで開いた時のガード)。
 * @returns {boolean} Tauriならtrue
 */
export const isTauri = (): boolean =>
  '__TAURI_INTERNALS__' in window;

/**
 * Tauriコマンドを安全に呼び出す。ブラウザ実行時はエラーにする。
 * @param {string} command - コマンド名
 * @param {Record<string, unknown>} [args] - 引数
 * @returns {Promise<T>} コマンドの戻り値
 */
export const invokeSafe = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  if (!isTauri()) {
    throw new Error('Tauriアプリ内でのみ使用できます');
  }
  return invoke<T>(command, args);
};
