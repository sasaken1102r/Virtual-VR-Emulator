import { useTranslation } from 'react-i18next';
import type { DeviceId } from '../ipc/protocol';
import { useAppStore } from '../state/store';
import { InputPanel } from './InputPanel';

/** 位置スライダーの定義 */
const POS_AXES = [
  { index: 0, label: 'X', min: -3, max: 3 },
  { index: 1, label: 'Y', min: 0, max: 3 },
  { index: 2, label: 'Z', min: -3, max: 3 },
] as const;

/** 回転スライダーの定義 (YXZオイラー、度。labelは翻訳キー) */
const ROT_AXES = [
  { index: 0, label: 'device.pitch', min: -90, max: 90 },
  { index: 1, label: 'device.yaw', min: -180, max: 180 },
  { index: 2, label: 'device.roll', min: -180, max: 180 },
] as const;

type Props = {
  deviceId: DeviceId;
};

/**
 * 1デバイス分の位置・回転を操作するパネル。
 * @param {Props} props - 対象デバイスID
 * @returns {JSX.Element} パネル要素
 */
export const DevicePanel = ({ deviceId }: Props) => {
  const { t } = useTranslation();
  const pose = useAppStore((state) => state.poses[deviceId]);
  const setPose = useAppStore((state) => state.setPose);
  const lastHaptic = useAppStore((state) => state.lastHaptic[deviceId]);

  /**
   * 位置の1軸を更新する。
   * @param {number} index - 軸インデックス(0=X,1=Y,2=Z)
   * @param {number} value - 新しい値(m)
   */
  const updatePos = (index: number, value: number): void => {
    const pos = [...pose.pos] as [number, number, number];
    pos[index] = value;
    setPose(deviceId, { pos });
  };

  /**
   * 回転の1軸を更新する。
   * @param {number} index - 軸インデックス(0=ピッチ,1=ヨー,2=ロール)
   * @param {number} value - 新しい値(度)
   */
  const updateRot = (index: number, value: number): void => {
    const rotDeg = [...pose.rotDeg] as [number, number, number];
    rotDeg[index] = value;
    setPose(deviceId, { rotDeg });
  };

  const hapticActive = lastHaptic !== undefined && Date.now() - lastHaptic < 500;

  return (
    <section className="device-panel">
      <h2>
        {t(`devices.${deviceId}`)}
        {hapticActive && <span className="haptic-indicator">📳</span>}
      </h2>

      <div className="axis-group">
        <h3>{t('device.position')}</h3>
        {POS_AXES.map((axis) => (
          <label key={axis.label} className="axis-row">
            <span className="axis-label">{axis.label}</span>
            <input
              type="range"
              min={axis.min}
              max={axis.max}
              step={0.01}
              value={pose.pos[axis.index]}
              onChange={(e) => updatePos(axis.index, Number(e.target.value))}
            />
            <input
              type="number"
              step={0.01}
              value={pose.pos[axis.index]}
              onChange={(e) => updatePos(axis.index, Number(e.target.value))}
            />
          </label>
        ))}
      </div>

      <div className="axis-group">
        <h3>{t('device.rotation')}</h3>
        {ROT_AXES.map((axis) => (
          <label key={axis.label} className="axis-row">
            <span className="axis-label">{t(axis.label)}</span>
            <input
              type="range"
              min={axis.min}
              max={axis.max}
              step={1}
              value={pose.rotDeg[axis.index]}
              onChange={(e) => updateRot(axis.index, Number(e.target.value))}
            />
            <input
              type="number"
              step={1}
              value={pose.rotDeg[axis.index]}
              onChange={(e) => updateRot(axis.index, Number(e.target.value))}
            />
          </label>
        ))}
      </div>

      {deviceId !== 'hmd' && (
        <div className="axis-group">
          <h3>{t('device.input')}</h3>
          <InputPanel deviceId={deviceId} />
        </div>
      )}
    </section>
  );
};
