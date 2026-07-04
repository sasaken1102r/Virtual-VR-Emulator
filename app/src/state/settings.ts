import { create } from 'zustand';
import i18n, { detectSystemLanguage } from '../i18n';
import { isTauri, invokeSafe } from '../lib/tauri';
import { DEFAULT_KEYBINDS, type KeybindActionId } from '../settings/keybindDefs';

/** 操作感度の設定 */
export type GeneralSettings = {
  /** マウス感度 (度/px) */
  mouseSensitivity: number;
  /** 歩行速度 (m/s) */
  walkSpeed: number;
  /** 高速移動速度 (m/s) */
  runSpeed: number;
};

/** 操作感度のデフォルト値 */
export const DEFAULT_GENERAL: GeneralSettings = {
  mouseSensitivity: 0.15,
  walkSpeed: 1.5,
  runSpeed: 3.0,
};

/** プロファイル単位の上書き(差分のみ保持) */
export type KeybindOverrides = Partial<Record<KeybindActionId, string>>;

/** キーバインド全体: 共通 + プロファイル別の差分上書き */
export type KeybindSettings = {
  common: Record<KeybindActionId, string>;
  profiles: Record<string, KeybindOverrides>;
};

type SettingsState = {
  keybinds: KeybindSettings;
  general: GeneralSettings;
  /** 表示言語 ('system' | 'ja' | 'en' | 'zh' | 'ko') */
  language: string;
  setCommonKeybind: (id: KeybindActionId, code: string) => void;
  setProfileKeybind: (profile: string, id: KeybindActionId, code: string) => void;
  clearProfileKeybind: (profile: string, id: KeybindActionId) => void;
  resetKeybinds: () => void;
  setGeneral: (general: Partial<GeneralSettings>) => void;
  setLanguage: (language: string) => void;
};

/**
 * 言語設定をi18nへ反映する。
 * @param {string} language - 言語ID ('system'はOS設定から推定)
 */
const applyLanguage = (language: string): void => {
  void i18n.changeLanguage(language === 'system' ? detectSystemLanguage() : language);
};

/** localStorageフォールバック用のキー */
const STORAGE_KEY = 'vvre-settings';

let saveTimer: number | undefined;

/**
 * 現在の設定を保存する(短時間の連続変更をまとめるため400msデバウンス)。
 * Tauri環境ではファイル、ブラウザではlocalStorageに保存する。
 */
const persist = (): void => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const { keybinds, general, language } = useSettingsStore.getState();
    const data = { keybinds, general, language };
    if (isTauri()) {
      invokeSafe('save_settings', { settings: data }).catch((e) => console.error('設定保存失敗:', e));
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  }, 400);
};

/** アプリ設定のストア */
export const useSettingsStore = create<SettingsState>((set) => ({
  keybinds: { common: { ...DEFAULT_KEYBINDS }, profiles: {} },
  general: { ...DEFAULT_GENERAL },
  language: 'system',
  setCommonKeybind: (id, code) => {
    set((state) => ({
      keybinds: { ...state.keybinds, common: { ...state.keybinds.common, [id]: code } },
    }));
    persist();
  },
  setProfileKeybind: (profile, id, code) => {
    set((state) => ({
      keybinds: {
        ...state.keybinds,
        profiles: {
          ...state.keybinds.profiles,
          [profile]: { ...state.keybinds.profiles[profile], [id]: code },
        },
      },
    }));
    persist();
  },
  clearProfileKeybind: (profile, id) => {
    set((state) => {
      const overrides = { ...state.keybinds.profiles[profile] };
      delete overrides[id];
      return {
        keybinds: {
          ...state.keybinds,
          profiles: { ...state.keybinds.profiles, [profile]: overrides },
        },
      };
    });
    persist();
  },
  resetKeybinds: () => {
    set((state) => ({
      keybinds: { ...state.keybinds, common: { ...DEFAULT_KEYBINDS }, profiles: {} },
    }));
    persist();
  },
  setGeneral: (general) => {
    set((state) => ({ general: { ...state.general, ...general } }));
    persist();
  },
  setLanguage: (language) => {
    set(() => ({ language }));
    applyLanguage(language);
    persist();
  },
}));

/**
 * 指定プロファイルで実際に有効なキーバインドを解決する。
 * 優先順位: プロファイル上書き > 共通 > デフォルト
 * @param {KeybindSettings} keybinds - キーバインド設定
 * @param {string} profile - デバイスプロファイル名
 * @returns {Record<KeybindActionId, string>} 解決済みバインド
 */
export const mergeKeybinds = (
  keybinds: KeybindSettings,
  profile: string,
): Record<KeybindActionId, string> => ({
  ...DEFAULT_KEYBINDS,
  ...keybinds.common,
  ...(keybinds.profiles[profile] ?? {}),
});

/**
 * 保存データから既知のアクションIDだけを抽出する(旧形式やゴミの混入対策)。
 * @param {unknown} src - 保存されていたオブジェクト
 * @returns {KeybindOverrides} 既知IDのみのバインド
 */
const pickKnown = (src: unknown): KeybindOverrides => {
  const result: KeybindOverrides = {};
  if (src && typeof src === 'object') {
    for (const [key, value] of Object.entries(src)) {
      if (key in DEFAULT_KEYBINDS && typeof value === 'string') {
        result[key as KeybindActionId] = value;
      }
    }
  }
  return result;
};

/**
 * 保存済み設定を読み込んでストアへ反映する(アプリ起動時に1回呼ぶ)。
 * 保存データに無いキーはデフォルト値で補完する。
 * @returns {Promise<void>} 読み込み完了
 */
export const loadSettings = async (): Promise<void> => {
  try {
    let data: unknown;
    if (isTauri()) {
      data = await invokeSafe('load_settings');
    } else {
      const raw = localStorage.getItem(STORAGE_KEY);
      data = raw ? JSON.parse(raw) : null;
    }

    if (data && typeof data === 'object') {
      const saved = data as {
        keybinds?: { common?: unknown; profiles?: Record<string, unknown> };
        general?: Partial<GeneralSettings>;
        language?: string;
      };

      const profiles: Record<string, KeybindOverrides> = {};
      if (saved.keybinds?.profiles && typeof saved.keybinds.profiles === 'object') {
        for (const [profile, overrides] of Object.entries(saved.keybinds.profiles)) {
          profiles[profile] = pickKnown(overrides);
        }
      }

      useSettingsStore.setState({
        keybinds: {
          common: { ...DEFAULT_KEYBINDS, ...pickKnown(saved.keybinds?.common) },
          profiles,
        },
        general: { ...DEFAULT_GENERAL, ...saved.general },
        language: saved.language ?? 'system',
      });
      applyLanguage(saved.language ?? 'system');
    }
  } catch (e) {
    console.error('設定読み込み失敗:', e);
  }
};
