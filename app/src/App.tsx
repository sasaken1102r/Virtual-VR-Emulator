import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { connectHub, startPoseSender } from './ipc/wsClient';
import { DevicePanel } from './panels/DevicePanel';
import { PresetPanel } from './panels/PresetPanel';
import { SettingsView } from './panels/SettingsView';
import { SetupPanel } from './panels/SetupPanel';
import { Viewport } from './scene/Viewport';
import { recaptureFollowOffsets, startFpsMode } from './scene/fpsMode';
import { isTauri, invokeSafe } from './lib/tauri';
import { formatKeyCode, type KeybindActionId } from './settings/keybindDefs';
import { loadSettings, mergeKeybinds, useSettingsStore } from './state/settings';
import { useAppStore } from './state/store';
import './App.css';

/** FPSモードの操作対象の表示名キー */
const FPS_TARGET_LABEL_KEYS: Record<string, string> = {
  hmd: 'devices.hmd',
  left: 'devices.leftShort',
  right: 'devices.rightShort',
};

/** 右パネルのタブ定義 */
const TABS = [
  { id: 'devices', labelKey: 'tabs.devices' },
  { id: 'presets', labelKey: 'tabs.presets' },
  { id: 'setup', labelKey: 'tabs.setup' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * キーバインド1項目(キーチップ+説明)を描画する。
 * @param {{ keys: string[]; label: string }} props - キー表記と説明
 * @returns {JSX.Element} キーバインド要素
 */
const KeyHint = ({ keys, label }: { keys: string[]; label: string }) => (
  <span className="key-hint">
    {keys.map((key, index) => (
      <kbd key={`${index}-${key}`}>{key}</kbd>
    ))}
    <span className="key-label">{label}</span>
  </span>
);

const App = () => {
  const { t } = useTranslation();
  const status = useAppStore((state) => state.status);
  const resetPoses = useAppStore((state) => state.resetPoses);
  const fpsTarget = useAppStore((state) => state.fpsTarget);
  const followControllers = useAppStore((state) => state.followControllers);
  const setFollowControllers = useAppStore((state) => state.setFollowControllers);
  const keybindSettings = useSettingsStore((state) => state.keybinds);
  const profile = useAppStore((state) => state.profile);
  const steamvrRunning = useAppStore((state) => state.steamvrRunning);
  const setSteamvrRunning = useAppStore((state) => state.setSteamvrRunning);
  const [fpsMode, setFpsMode] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('devices');
  const [showSettings, setShowSettings] = useState(false);
  const [steamvrBusy, setSteamvrBusy] = useState(false);
  const [steamvrError, setSteamvrError] = useState('');
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadSettings();
    connectHub();
    startPoseSender();
  }, []);

  // 現在のデバイスプロファイルで有効なキーバインド(共通+上書き)
  const resolvedKeybinds = mergeKeybinds(keybindSettings, profile);

  /**
   * アクションに割り当てられたキーの表示名を返す。
   * @param {KeybindActionId} id - アクションID
   * @returns {string} キーの表示名
   */
  const fmt = (id: KeybindActionId): string => formatKeyCode(resolvedKeybinds[id]);

  /**
   * SteamVRを起動または停止する(現在の稼働状態でトグル)。
   * @returns {Promise<void>} 完了
   */
  const toggleSteamvr = async (): Promise<void> => {
    setSteamvrBusy(true);
    setSteamvrError('');
    try {
      if (steamvrRunning) {
        await invokeSafe('stop_steamvr');
        setSteamvrRunning(false);
      } else {
        await invokeSafe('start_steamvr');
        setSteamvrRunning(true);
      }
    } catch (e) {
      console.error('SteamVR起動/停止失敗:', e);
      setSteamvrError(String(e));
      window.setTimeout(() => setSteamvrError(''), 8000);
    } finally {
      setSteamvrBusy(false);
    }
  };

  /**
   * FPSモードを開始する。
   * @param {'hmd' | 'left' | 'right'} target - 操作主体のデバイス
   * @returns {void}
   */
  const enterFpsMode = (target: 'hmd' | 'left' | 'right'): void => {
    if (!viewportRef.current) {
      return;
    }
    setFpsMode(true);
    startFpsMode(viewportRef.current, () => setFpsMode(false), target);
  };

  return (
    <main className="app">
      <header className="app-header">
        <h1>Virtual VR Emulator</h1>
        <div className="status-dots">
          <span
            className={`status-dot ${status.hubConnected ? 'ok' : 'ng'}`}
            title={`${t('header.hub')}: ${t(status.hubConnected ? 'header.connected' : 'header.disconnected')}`}
          />
          <span
            className={`status-dot ${status.driverConnected ? 'ok' : 'ng'}`}
            title={`${t('header.driver')}: ${t(status.driverConnected ? 'header.connected' : 'header.disconnected')}`}
          />
        </div>
        <div className="header-spacer" />
        <button type="button" onClick={resetPoses}>
          {t('header.resetPoses')}
        </button>
        {isTauri() && (
          <button
            type="button"
            className={steamvrRunning ? 'steamvr-stop' : 'steamvr-start'}
            disabled={steamvrBusy}
            onClick={() => void toggleSteamvr()}
          >
            {steamvrBusy
              ? t('header.steamvrBusy')
              : steamvrRunning
                ? t('header.steamvrStop')
                : t('header.steamvrStart')}
          </button>
        )}
        <button type="button" onClick={() => setShowSettings(true)}>
          {t('header.settings')}
        </button>
      </header>

      {steamvrError && <p className="steamvr-error">{steamvrError}</p>}

      {showSettings && <SettingsView onClose={() => setShowSettings(false)} />}

      <div className="layout">
        <div className="viewport-wrap" ref={viewportRef}>
          <Viewport />

          {!fpsMode && (
            <div className="viewport-toolbar">
              <span className="toolbar-label">{t('fps.toolbarLabel')}</span>
              <span className="fps-group">
                <button type="button" onClick={() => enterFpsMode('hmd')}>
                  {t('devices.hmd')}
                </button>
                <label className="follow-toggle" title={t('fps.followTooltip')}>
                  <input
                    type="checkbox"
                    checked={followControllers}
                    onChange={(e) => {
                      setFollowControllers(e.target.checked);
                      if (e.target.checked) {
                        recaptureFollowOffsets();
                      }
                    }}
                  />
                  {t('fps.follow')}
                </label>
              </span>
              <button type="button" onClick={() => enterFpsMode('left')}>
                {t('devices.leftShort')}
              </button>
              <button type="button" onClick={() => enterFpsMode('right')}>
                {t('devices.rightShort')}
              </button>
            </div>
          )}

          {fpsMode && (
            <div className="fps-overlay">
              <div className="fps-overlay-header">
                <strong>{t('fps.title')}</strong>
                <span className="fps-chip">
                  {t('fps.operating', { target: t(FPS_TARGET_LABEL_KEYS[fpsTarget ?? 'hmd']) })}
                </span>
                {fpsTarget === 'hmd' && followControllers && (
                  <span className="fps-chip">{t('fps.followOn')}</span>
                )}
                <span className="fps-exit">
                  <KeyHint keys={['Esc']} label={t('fps.exit')} />
                </span>
              </div>
              <div className="fps-keys">
                <KeyHint
                  keys={[fmt('moveForward'), fmt('moveLeft'), fmt('moveBack'), fmt('moveRight')]}
                  label={t('fps.move')}
                />
                <KeyHint keys={[t('fps.mouse')]} label={t('fps.look')} />
                <KeyHint keys={[fmt('moveUp'), fmt('moveDown')]} label={t('fps.upDown')} />
                <KeyHint keys={[fmt('run')]} label={t('fps.fast')} />
                <KeyHint
                  keys={[fmt('targetHmd'), fmt('targetLeft'), fmt('targetRight')]}
                  label={t('fps.switchTarget')}
                />
              </div>
              <div className="fps-keys">
                <KeyHint keys={[fmt('rightTrigger')]} label={t('keybinds.actions.rightTrigger')} />
                <KeyHint keys={[fmt('rightGrip')]} label={t('keybinds.actions.rightGrip')} />
                <KeyHint keys={[fmt('leftTrigger')]} label={t('keybinds.actions.leftTrigger')} />
                <KeyHint keys={[fmt('leftGrip')]} label={t('keybinds.actions.leftGrip')} />
                <KeyHint keys={[fmt('leftPrimary'), fmt('leftSecondary')]} label={t('fps.leftButtons')} />
                <KeyHint keys={[fmt('rightPrimary'), fmt('rightSecondary')]} label={t('fps.rightButtons')} />
                <KeyHint keys={[fmt('leftSystem'), fmt('rightSystem')]} label={t('fps.systems')} />
              </div>
              <div className="fps-keys">
                <KeyHint
                  keys={[fmt('leftStickUp'), fmt('leftStickDown'), fmt('leftStickLeft'), fmt('leftStickRight')]}
                  label={t('fps.leftStick')}
                />
                <KeyHint
                  keys={[fmt('rightStickUp'), fmt('rightStickDown'), fmt('rightStickLeft'), fmt('rightStickRight')]}
                  label={t('fps.rightStick')}
                />
                <KeyHint
                  keys={[fmt('leftStickClick'), fmt('rightStickClick')]}
                  label={t('fps.stickClicks')}
                />
              </div>
            </div>
          )}
        </div>

        <div className="side-panel">
          <div className="tab-bar">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </div>

          {/* タブはdisplay切替でマウントを維持する(切替のたびに状態取得し直してチラつくのを防ぐ) */}
          <div className="tab-content" style={{ display: activeTab === 'devices' ? undefined : 'none' }}>
            <DevicePanel deviceId="hmd" />
            <DevicePanel deviceId="left" />
            <DevicePanel deviceId="right" />
          </div>
          <div className="tab-content" style={{ display: activeTab === 'presets' ? undefined : 'none' }}>
            <PresetPanel />
          </div>
          <div className="tab-content" style={{ display: activeTab === 'setup' ? undefined : 'none' }}>
            <SetupPanel />
          </div>
        </div>
      </div>
    </main>
  );
};

export default App;
