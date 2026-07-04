import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri, invokeSafe } from '../lib/tauri';
import { useAppStore } from '../state/store';

/** セットアップ状態 (installer.rsのget_setup_statusと対応) */
type SetupStatus = {
  steamRunning: boolean;
  steamvrRunning: boolean;
  driverRegistered: boolean;
  driverPath?: string;
  requireHmdOk: boolean;
  activateMultipleDriversOk: boolean;
  profile: string;
};

/**
 * ドライバーのインストール・SteamVR設定・プロファイル切替のパネル。
 * @returns {JSX.Element} パネル要素
 */
export const SetupPanel = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SetupStatus | undefined>();
  const [profile, setProfile] = useState('quest3');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * セットアップ状態を再取得する。
   */
  const refresh = async (): Promise<void> => {
    if (!isTauri()) {
      return;
    }
    try {
      const s = await invokeSafe<SetupStatus>('get_setup_status');
      setStatus(s);
      setProfile(s.profile);
      // 入力パネルのUI構成をプロファイルに追従させ、ヘッダーの起動/停止ボタンにも状態を共有する
      useAppStore.getState().setProfile(s.profile);
      useAppStore.getState().setSteamvrRunning(s.steamvrRunning);
    } catch (e) {
      setMessage(String(e));
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  /**
   * コマンドを実行してメッセージ表示と状態更新を行う。
   * @param {string} command - Tauriコマンド名
   * @param {Record<string, unknown>} [args] - 引数
   * @param {string} [okMessage] - 成功時メッセージ
   */
  const run = async (command: string, args?: Record<string, unknown>, okMessage?: string): Promise<void> => {
    setBusy(true);
    try {
      await invokeSafe(command, args);
      setMessage(okMessage ?? t('setup.done'));
      await refresh();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * プロファイルを適用してSteamVRを再起動する。
   */
  const applyProfile = async (): Promise<void> => {
    setBusy(true);
    try {
      await invokeSafe('set_profile', { profile });
      setMessage(t('setup.profileApplying'));
      await invokeSafe('restart_steamvr');
      setMessage(t('setup.profileApplied', { profile }));
      await refresh();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!isTauri()) {
    return (
      <section className="device-panel">
        <h2>{t('setup.title')}</h2>
        <p className="panel-message">{t('setup.tauriOnly')}</p>
      </section>
    );
  }

  /**
   * 状態チェックを描画する(☑=OK緑 / ☐=未達成赤 / 取得前はグレー)。
   * @param {boolean | undefined} ok - 状態 (undefined=取得中)
   * @param {string} label - ラベル
   * @returns {JSX.Element} チェック行要素
   */
  const badge = (ok: boolean | undefined, label: string) => (
    <div className="setup-row">
      <span className={`setup-check ${ok === undefined ? 'unknown' : ok ? 'ok' : 'ng'}`}>
        {ok ? '☑' : '☐'}
      </span>
      <span>{label}</span>
    </div>
  );

  return (
    <section className="device-panel">
      <h2>{t('setup.title')}</h2>

      {badge(status?.steamRunning, t('setup.steamRunning'))}
      {badge(status?.steamvrRunning, t('setup.steamvrRunning'))}
      {badge(status?.driverRegistered, `${t('setup.driverRegistered')}${status?.driverPath ? ` (${status.driverPath})` : ''}`)}
      {badge(status?.requireHmdOk, t('setup.requireHmdOk'))}
      {badge(status?.activateMultipleDriversOk, t('setup.multiDriversOk'))}

      <div className="setup-actions">
        <button type="button" disabled={busy} onClick={() => void run('install_driver', undefined, t('setup.installed'))}>
          {t('setup.installDriver')}
        </button>
        <button type="button" disabled={busy} onClick={() => void run('apply_vrsettings', undefined, t('setup.settingsApplied'))}>
          {t('setup.applySettings')}
        </button>
        <button type="button" disabled={busy} onClick={() => void run('restart_steamvr', undefined, t('setup.restarted'))}>
          {t('setup.restartSteamvr')}
        </button>
      </div>

      <div className="setup-profile">
        <label>
          {t('setup.profile')}{' '}
          <select value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="quest3">Meta Quest 3</option>
            <option value="quest2">Meta Quest 2</option>
            <option value="pico4">PICO 4</option>
            <option value="index">Valve Index</option>
            <option value="vive">HTC Vive</option>
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void applyProfile()}>
          {t('setup.applyProfile')}
        </button>
      </div>

      {message && <p className="panel-message">{message}</p>}
    </section>
  );
};
