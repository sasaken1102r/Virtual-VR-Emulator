import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../i18n';
import {
  actionAvailableForLayout,
  actionLabel,
  formatKeyCode,
  KEYBIND_DEFS,
  PROFILE_LAYOUTS,
  DEFAULT_KEYBINDS,
  type KeybindActionId,
} from '../settings/keybindDefs';
import { DEFAULT_GENERAL, mergeKeybinds, useSettingsStore } from '../state/settings';
import './settingsView.css';

/** 設定カテゴリ(サイドバー項目。将来ここに追加していく) */
const CATEGORIES = [
  { id: 'general', labelKey: 'settings.categoryGeneral' },
  { id: 'keybinds', labelKey: 'settings.categoryKeybinds' },
] as const;

type CategoryId = (typeof CATEGORIES)[number]['id'];

/** キーバインドの編集対象(共通 or デバイスプロファイル。プロファイル名は製品名なので翻訳しない) */
const BIND_TARGETS = [
  { id: 'common', label: null },
  { id: 'quest3', label: 'Meta Quest 3' },
  { id: 'quest2', label: 'Meta Quest 2' },
  { id: 'pico4', label: 'PICO 4' },
  { id: 'index', label: 'Valve Index' },
  { id: 'vive', label: 'HTC Vive' },
] as const;

type Props = {
  onClose: () => void;
};

/**
 * 設定画面(全画面オーバーレイ+カテゴリサイドバー)。
 * @param {Props} props - 閉じるコールバック
 * @returns {JSX.Element} 設定画面要素
 */
export const SettingsView = ({ onClose }: Props) => {
  const { t } = useTranslation();
  const [category, setCategory] = useState<CategoryId>('general');
  const [bindTarget, setBindTarget] = useState<string>('common');
  const [listeningFor, setListeningFor] = useState<KeybindActionId | null>(null);
  const keybinds = useSettingsStore((state) => state.keybinds);
  const general = useSettingsStore((state) => state.general);
  const language = useSettingsStore((state) => state.language);
  const setCommonKeybind = useSettingsStore((state) => state.setCommonKeybind);
  const setProfileKeybind = useSettingsStore((state) => state.setProfileKeybind);
  const clearProfileKeybind = useSettingsStore((state) => state.clearProfileKeybind);
  const resetKeybinds = useSettingsStore((state) => state.resetKeybinds);
  const setGeneral = useSettingsStore((state) => state.setGeneral);
  const setLanguage = useSettingsStore((state) => state.setLanguage);

  const isCommon = bindTarget === 'common';
  const layout = isCommon ? undefined : PROFILE_LAYOUTS[bindTarget];
  /** 共通ビューでの解決値(デフォルト補完済み) */
  const commonResolved = { ...DEFAULT_KEYBINDS, ...keybinds.common };
  /** 現在の編集対象での解決値(重複チェック用) */
  const targetResolved = isCommon ? commonResolved : mergeKeybinds(keybinds, bindTarget);

  // キー割当待ち: 次のキーorマウスボタン押下を捕まえて割り当てる(Escでキャンセル)
  useEffect(() => {
    if (!listeningFor) {
      return;
    }

    /**
     * 割当を確定する。
     * @param {string} code - キーコード or マウス疑似コード
     */
    const assign = (code: string): void => {
      if (isCommon) {
        setCommonKeybind(listeningFor, code);
      } else {
        setProfileKeybind(bindTarget, listeningFor, code);
      }
      setListeningFor(null);
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') {
        assign(e.code);
      } else {
        setListeningFor(null);
      }
    };
    const onMouseDown = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      assign(`Mouse${e.button}`);
    };
    const onContextMenu = (e: Event): void => e.preventDefault();

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [listeningFor, isCommon, bindTarget, setCommonKeybind, setProfileKeybind]);

  /**
   * 同じキーが割り当てられている他のアクション名を返す(重複警告用)。
   * @param {KeybindActionId} id - 対象アクション
   * @returns {string | undefined} 重複相手のラベル
   */
  const duplicateOf = (id: KeybindActionId): string | undefined => {
    const dup = KEYBIND_DEFS.find(
      (def) =>
        def.id !== id &&
        targetResolved[def.id] === targetResolved[id] &&
        (!layout || actionAvailableForLayout(def.id, layout)),
    );
    return dup ? t(`keybinds.actions.${dup.id}`) : undefined;
  };

  /** グループ順を保ったままアクションをグループ分けする */
  const groups = KEYBIND_DEFS.reduce<{ name: string; defs: typeof KEYBIND_DEFS }[]>((acc, def) => {
    const last = acc[acc.length - 1];
    if (last && last.name === def.group) {
      last.defs.push(def);
    } else {
      acc.push({ name: def.group, defs: [def] });
    }
    return acc;
  }, []);

  /** 現在の編集対象プロファイルの上書き件数 */
  const overrideCount = isCommon ? 0 : Object.keys(keybinds.profiles[bindTarget] ?? {}).length;

  /**
   * このデバイスの上書きを全て解除して共通に戻す。
   */
  const clearAllOverrides = (): void => {
    for (const id of Object.keys(keybinds.profiles[bindTarget] ?? {}) as KeybindActionId[]) {
      clearProfileKeybind(bindTarget, id);
    }
  };

  return (
    <div className="settings-overlay">
      <div className="settings-window">
        <header className="settings-header">
          <h2>{t('settings.title')}</h2>
          <button type="button" onClick={onClose}>
            {t('settings.close')}
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-sidebar">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`settings-nav-button ${category === cat.id ? 'active' : ''}`}
                onClick={() => setCategory(cat.id)}
              >
                {t(cat.labelKey)}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {category === 'keybinds' && (
              <>
                <div className="bind-target-row">
                  <label>
                    {t('settings.bindTarget')}{' '}
                    <select
                      value={bindTarget}
                      onChange={(e) => {
                        setBindTarget(e.target.value);
                        setListeningFor(null);
                      }}
                    >
                      {BIND_TARGETS.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.label ?? t('settings.commonTarget')}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!isCommon && (
                    <span className="settings-note-inline">
                      {t('settings.overrideCount', { count: overrideCount })}
                    </span>
                  )}
                </div>

                <p className="settings-note">{t('settings.note')}</p>

                {groups.map((group) => (
                  <section key={group.name} className="keybind-group">
                    <h3>{t(`keybinds.groups.${group.name}`)}</h3>
                    {group.defs
                      .filter((def) => !layout || actionAvailableForLayout(def.id, layout))
                      .map((def) => {
                        const override = isCommon
                          ? undefined
                          : keybinds.profiles[bindTarget]?.[def.id];
                        const value = override ?? commonResolved[def.id];
                        const inherited = !isCommon && override === undefined;
                        return (
                          <div key={def.id} className="keybind-row">
                            <span className="keybind-label">{actionLabel(def, layout)}</span>
                            <span className="keybind-key">
                              {listeningFor === def.id ? (
                                <span className="keybind-listening">{t('settings.listening')}</span>
                              ) : (
                                <>
                                  <kbd className={inherited ? 'inherited' : ''}>
                                    {formatKeyCode(value)}
                                  </kbd>
                                  {inherited && (
                                    <span className="inherit-badge">{t('settings.inheritBadge')}</span>
                                  )}
                                </>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setListeningFor(listeningFor === def.id ? null : def.id)
                              }
                            >
                              {listeningFor === def.id ? t('settings.cancel') : t('settings.change')}
                            </button>
                            {!isCommon && override !== undefined && (
                              <button
                                type="button"
                                onClick={() => clearProfileKeybind(bindTarget, def.id)}
                              >
                                {t('settings.revertToCommon')}
                              </button>
                            )}
                            {duplicateOf(def.id) && (
                              <span className="keybind-warning">
                                {t('settings.duplicate', { name: duplicateOf(def.id) })}
                              </span>
                            )}
                          </div>
                        );
                      })}
                  </section>
                ))}

                {isCommon ? (
                  <button type="button" onClick={resetKeybinds}>
                    {t('settings.resetKeybinds')}
                  </button>
                ) : (
                  <button type="button" disabled={overrideCount === 0} onClick={clearAllOverrides}>
                    {t('settings.clearOverrides')}
                  </button>
                )}
              </>
            )}

            {category === 'general' && (
              <>
                <section className="keybind-group">
                  <h3>{t('settings.language')}</h3>
                  <label className="setting-slider-row">
                    <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                      <option value="system">{t('settings.languageSystem')}</option>
                      {SUPPORTED_LANGUAGES.map((lang) => (
                        <option key={lang.id} value={lang.id}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>

                <section className="keybind-group">
                  <h3>{t('settings.sensitivityTitle')}</h3>
                  <label className="setting-slider-row">
                    <span className="keybind-label">{t('settings.mouseSensitivity')}</span>
                    <input
                      type="range"
                      min={0.03}
                      max={0.5}
                      step={0.01}
                      value={general.mouseSensitivity}
                      onChange={(e) => setGeneral({ mouseSensitivity: Number(e.target.value) })}
                    />
                    <span className="setting-value">
                      {general.mouseSensitivity.toFixed(2)} {t('settings.degPerPx')}
                    </span>
                  </label>
                  <label className="setting-slider-row">
                    <span className="keybind-label">{t('settings.walkSpeed')}</span>
                    <input
                      type="range"
                      min={0.5}
                      max={5}
                      step={0.1}
                      value={general.walkSpeed}
                      onChange={(e) => setGeneral({ walkSpeed: Number(e.target.value) })}
                    />
                    <span className="setting-value">
                      {general.walkSpeed.toFixed(1)} {t('settings.metersPerSec')}
                    </span>
                  </label>
                  <label className="setting-slider-row">
                    <span className="keybind-label">{t('settings.runSpeed')}</span>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      step={0.5}
                      value={general.runSpeed}
                      onChange={(e) => setGeneral({ runSpeed: Number(e.target.value) })}
                    />
                    <span className="setting-value">
                      {general.runSpeed.toFixed(1)} {t('settings.metersPerSec')}
                    </span>
                  </label>
                </section>
                <button type="button" onClick={() => setGeneral(DEFAULT_GENERAL)}>
                  {t('settings.resetGeneral')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
