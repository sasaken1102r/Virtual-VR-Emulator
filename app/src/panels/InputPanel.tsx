import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceId } from '../ipc/protocol';
import { sendInputs } from '../ipc/wsClient';
import { useAppStore } from '../state/store';
import './inputPanel.css';

type ControllerId = Extract<DeviceId, 'left' | 'right'>;

/** コントローラー種別ごとのUI構成 */
type PanelLayout = {
  /** 押している間ONのボタン群 (OpenVRコンポーネント名 + 表示ラベル) */
  buttons: { name: string; label: string }[];
  /** 2D軸のベースパス名 (joystick / thumbstick / trackpad) */
  stickBase: string;
  /** 2D軸の表示ラベル */
  stickLabel: string;
  /** グリップの種類: アナログ値 / 感圧付き / クリックのみ(ボタンに含む) */
  grip: 'value' | 'valueForce' | 'click';
};

/** プロファイル→レイアウト種別 */
const PROFILE_LAYOUTS: Record<string, 'touch' | 'knuckles' | 'vive'> = {
  quest3: 'touch',
  quest2: 'touch',
  pico4: 'touch',
  index: 'knuckles',
  vive: 'vive',
};

/**
 * プロファイルと手からUI構成を決める。
 * ドライバー側のCreateInputComponentsと対応している。
 * @param {string} profile - デバイスプロファイル名
 * @param {boolean} isLeft - 左手かどうか
 * @returns {PanelLayout} UI構成
 */
const layoutFor = (profile: string, isLeft: boolean): PanelLayout => {
  const kind = PROFILE_LAYOUTS[profile] ?? 'touch';

  if (kind === 'knuckles') {
    return {
      buttons: [
        { name: 'a', label: 'A' },
        { name: 'b', label: 'B' },
        { name: 'system', label: 'Sys' },
        { name: 'thumbstick', label: 'i18n:input.stickClick' },
      ],
      stickBase: 'thumbstick',
      stickLabel: 'i18n:input.stick',
      grip: 'valueForce',
    };
  }

  if (kind === 'vive') {
    return {
      buttons: [
        { name: 'application_menu', label: 'i18n:input.menu' },
        { name: 'system', label: 'Sys' },
        { name: 'grip', label: 'i18n:input.grip' },
        { name: 'trackpad', label: 'i18n:input.padClick' },
      ],
      stickBase: 'trackpad',
      stickLabel: 'i18n:input.pad',
      grip: 'click',
    };
  }

  const primary = isLeft ? 'x' : 'a';
  const secondary = isLeft ? 'y' : 'b';
  return {
    buttons: [
      { name: primary, label: primary.toUpperCase() },
      { name: secondary, label: secondary.toUpperCase() },
      { name: 'system', label: 'Sys' },
      { name: 'joystick', label: 'i18n:input.stickClick' },
    ],
    stickBase: 'joystick',
    stickLabel: 'i18n:input.stick',
    grip: 'value',
  };
};

type Props = {
  deviceId: ControllerId;
};

/**
 * コントローラーのボタン・トリガー・2D軸を操作するパネル。
 * プロファイル(Quest/Pico/Index/Vive)に応じてUI構成が変わる。
 * @param {Props} props - 対象コントローラーID
 * @returns {JSX.Element} パネル要素
 */
export const InputPanel = ({ deviceId }: Props) => {
  const { t } = useTranslation();
  const profile = useAppStore((state) => state.profile);
  const layout = layoutFor(profile, deviceId === 'left');

  /**
   * "i18n:"始まりのラベルを翻訳し、それ以外はそのまま返す。
   * @param {string} raw - ラベル文字列または翻訳キー
   * @returns {string} 表示ラベル
   */
  const lbl = (raw: string): string => (raw.startsWith('i18n:') ? t(raw.slice(5)) : raw);

  const [trigger, setTrigger] = useState(0);
  const [grip, setGrip] = useState(0);
  const [stick, setStick] = useState<[number, number]>([0, 0]);
  const [pressed, setPressed] = useState<Record<string, boolean>>({});
  const padRef = useRef<HTMLDivElement>(null);

  /**
   * 押下系ボタンの状態を送信する(click+touchを同時に送る。
   * touchコンポーネントがないボタンはドライバー側で無視される)。
   * @param {string} name - ボタン名(例: "a")
   * @param {boolean} down - 押されているか
   */
  const sendButton = (name: string, down: boolean): void => {
    setPressed((prev) => ({ ...prev, [name]: down }));
    sendInputs(deviceId, {
      [`/input/${name}/click`]: down,
      [`/input/${name}/touch`]: down,
    });
  };

  /**
   * トリガー値を送信する(click/touchも値から導出)。
   * @param {number} value - 0〜1のトリガー値
   */
  const updateTrigger = (value: number): void => {
    setTrigger(value);
    sendInputs(deviceId, {
      '/input/trigger/value': value,
      '/input/trigger/click': value > 0.9,
      '/input/trigger/touch': value > 0.05,
    });
  };

  /**
   * グリップ値を送信する(Indexはforceも同じ値で送る)。
   * @param {number} value - 0〜1のグリップ値
   */
  const updateGrip = (value: number): void => {
    setGrip(value);
    const inputs: Record<string, boolean | number> = {
      '/input/grip/value': value,
      '/input/grip/touch': value > 0.05,
    };
    if (layout.grip === 'valueForce') {
      inputs['/input/grip/force'] = value;
    }
    sendInputs(deviceId, inputs);
  };

  /**
   * 2D軸(スティック/パッド)の値を送信する。
   * @param {number} x - -1〜1
   * @param {number} y - -1〜1
   */
  const updateStick = (x: number, y: number): void => {
    setStick([x, y]);
    sendInputs(deviceId, {
      [`/input/${layout.stickBase}/x`]: x,
      [`/input/${layout.stickBase}/y`]: y,
      [`/input/${layout.stickBase}/touch`]: x !== 0 || y !== 0,
    });
  };

  /**
   * パッド上のポインタ位置から軸値を計算する。
   * @param {React.PointerEvent} e - ポインタイベント
   */
  const handlePadPointer = (e: React.PointerEvent): void => {
    if (e.buttons !== 1 || !padRef.current) {
      return;
    }
    const rect = padRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    updateStick(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
  };

  /**
   * 押している間だけONになるボタンを描画する。
   * @param {string} name - コンポーネント名
   * @param {string} label - 表示ラベル
   * @returns {JSX.Element} ボタン要素
   */
  const momentaryButton = (name: string, label: string) => (
    <button
      key={name}
      type="button"
      className={`input-button ${pressed[name] ? 'active' : ''}`}
      onPointerDown={() => sendButton(name, true)}
      onPointerUp={() => sendButton(name, false)}
      onPointerLeave={() => pressed[name] && sendButton(name, false)}
    >
      {label}
    </button>
  );

  return (
    <div className="input-panel">
      <div className="input-buttons">
        {layout.buttons.map((button) => momentaryButton(button.name, lbl(button.label)))}
      </div>

      <div className="axis-row axis-row-with-pulse">
        <button
          type="button"
          className={`input-button pulse-button ${trigger > 0.9 ? 'active' : ''}`}
          onPointerDown={() => updateTrigger(1)}
          onPointerUp={() => updateTrigger(0)}
          onPointerLeave={() => trigger > 0 && updateTrigger(0)}
        >
          {t('input.trigger')}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={trigger}
          onChange={(e) => updateTrigger(Number(e.target.value))}
        />
        <span className="axis-value">{trigger.toFixed(2)}</span>
      </div>

      {layout.grip !== 'click' && (
        <div className="axis-row axis-row-with-pulse">
          <button
            type="button"
            className={`input-button pulse-button ${grip > 0.9 ? 'active' : ''}`}
            onPointerDown={() => updateGrip(1)}
            onPointerUp={() => updateGrip(0)}
            onPointerLeave={() => grip > 0 && updateGrip(0)}
          >
            {t('input.grip')}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={grip}
            onChange={(e) => updateGrip(Number(e.target.value))}
          />
          <span className="axis-value">{grip.toFixed(2)}</span>
        </div>
      )}

      <div className="joystick-block">
        <span className="axis-label">{lbl(layout.stickLabel)}</span>
        <div className="joystick-pad-row">
          <div
            ref={padRef}
            className="joystick-pad"
            onPointerDown={handlePadPointer}
            onPointerMove={handlePadPointer}
            onPointerUp={() => updateStick(0, 0)}
            onPointerLeave={() => (stick[0] !== 0 || stick[1] !== 0) && updateStick(0, 0)}
          >
            <div
              className="joystick-dot"
              style={{
                left: `${(stick[0] + 1) * 50}%`,
                top: `${(1 - stick[1]) * 50}%`,
              }}
            />
          </div>
          <span className="axis-value">
            {stick[0].toFixed(2)}, {stick[1].toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
};
