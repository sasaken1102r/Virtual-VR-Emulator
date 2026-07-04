import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri, invokeSafe } from '../lib/tauri';
import { recaptureFollowOffsets } from '../scene/fpsMode';
import { DEFAULT_POSES, useAppStore, type EditablePose } from '../state/store';
import type { DeviceId } from '../ipc/protocol';

/** アプリ同梱のプリセット(キーは翻訳キー) */
const BUILTIN_PRESETS: Record<string, Record<DeviceId, EditablePose>> = {
  'presets.standing': DEFAULT_POSES,
  'presets.seated': {
    hmd: { pos: [0, 1.2, 0], rotDeg: [0, 0, 0] },
    left: { pos: [-0.2, 0.85, -0.25], rotDeg: [0, 0, 0] },
    right: { pos: [0.2, 0.85, -0.25], rotDeg: [0, 0, 0] },
  },
  'presets.tpose': {
    hmd: { pos: [0, 1.7, 0], rotDeg: [0, 0, 0] },
    left: { pos: [-0.7, 1.45, 0], rotDeg: [0, 90, 0] },
    right: { pos: [0.7, 1.45, 0], rotDeg: [0, -90, 0] },
  },
  // HMD主体FPSでメニューをクリックしやすいように、手を視界の中央寄りに構えるポーズ
  // (角度はSteamVRダッシュボードにレーザーが届く実測値)
  'presets.menuPose': {
    hmd: { pos: [0, 1.7, 0], rotDeg: [0, 0, 0] },
    left: { pos: [-0.08, 1.45, -0.3], rotDeg: [37.7, -8.2, -0.3] },
    right: { pos: [0.08, 1.45, -0.3], rotDeg: [37.7, 8.2, 0.3] },
  },
};

/**
 * ポーズプリセットの保存・読込パネル。
 * 同梱プリセット+ユーザー保存分(%APPDATA%\vvre\presets)を扱う。
 * @returns {JSX.Element} パネル要素
 */
export const PresetPanel = () => {
  const { t } = useTranslation();
  const [userPresets, setUserPresets] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState('');
  const setPose = useAppStore((state) => state.setPose);

  /**
   * ユーザープリセット一覧を再取得する。
   */
  const refresh = async (): Promise<void> => {
    if (!isTauri()) {
      return;
    }
    try {
      setUserPresets(await invokeSafe<string[]>('list_presets'));
    } catch (e) {
      setMessage(String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  /**
   * ポーズ一式をストアへ適用する。
   * FPSモード中なら追従オフセットも取り直して、次の移動でズレないようにする。
   * @param {Record<DeviceId, EditablePose>} poses - 適用するポーズ
   */
  const applyPoses = (poses: Record<DeviceId, EditablePose>): void => {
    for (const [id, pose] of Object.entries(poses) as [DeviceId, EditablePose][]) {
      setPose(id, pose);
    }
    recaptureFollowOffsets();
  };

  /**
   * 現在のポーズを名前を付けて保存する。
   */
  const saveCurrent = async (): Promise<void> => {
    if (!newName.trim()) {
      setMessage(t('presets.nameRequired'));
      return;
    }
    try {
      await invokeSafe('save_preset', { name: newName, poses: useAppStore.getState().poses });
      setNewName('');
      setMessage(t('presets.saved', { name: newName }));
      await refresh();
    } catch (e) {
      setMessage(String(e));
    }
  };

  /**
   * ユーザープリセットを読み込んで適用する。
   * @param {string} name - プリセット名
   */
  const loadUserPreset = async (name: string): Promise<void> => {
    try {
      const poses = await invokeSafe<Record<DeviceId, EditablePose>>('load_preset', { name });
      applyPoses(poses);
      setMessage(t('presets.loaded', { name }));
    } catch (e) {
      setMessage(String(e));
    }
  };

  /**
   * ユーザープリセットを削除する。
   * @param {string} name - プリセット名
   */
  const deleteUserPreset = async (name: string): Promise<void> => {
    try {
      await invokeSafe('delete_preset', { name });
      await refresh();
    } catch (e) {
      setMessage(String(e));
    }
  };

  return (
    <section className="device-panel">
      <h2>{t('presets.title')}</h2>

      <div className="preset-list">
        {Object.entries(BUILTIN_PRESETS).map(([nameKey, poses]) => (
          <div key={nameKey} className="preset-row">
            <span>{t(nameKey)}</span>
            <button type="button" onClick={() => applyPoses(poses)}>
              {t('presets.apply')}
            </button>
          </div>
        ))}

        {userPresets.map((name) => (
          <div key={name} className="preset-row">
            <span>{name}</span>
            <span>
              <button type="button" onClick={() => void loadUserPreset(name)}>
                {t('presets.apply')}
              </button>{' '}
              <button type="button" onClick={() => void deleteUserPreset(name)}>
                {t('presets.delete')}
              </button>
            </span>
          </div>
        ))}
      </div>

      {isTauri() && (
        <div className="preset-save">
          <input
            type="text"
            placeholder={t('presets.namePlaceholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="button" onClick={() => void saveCurrent()}>
            {t('presets.saveCurrent')}
          </button>
        </div>
      )}

      {message && <p className="panel-message">{message}</p>}
    </section>
  );
};
