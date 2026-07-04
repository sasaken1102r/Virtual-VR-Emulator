import { PivotControls } from '@react-three/drei';
import { useMemo } from 'react';
import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { DeviceId } from '../ipc/protocol';
import { useAppStore } from '../state/store';

/** デバイスごとの本体色 */
const DEVICE_COLORS: Record<DeviceId, string> = {
  hmd: '#4a86ec',
  left: '#e05c9a',
  right: '#5cc9e0',
};

type Props = {
  deviceId: DeviceId;
};

/**
 * 1デバイス分の3Dモデル+ドラッグギズモ。
 * ギズモ操作でストアのポーズを更新する(移動+回転)。
 * @param {Props} props - 対象デバイスID
 * @returns {JSX.Element} ギズモ付きメッシュ
 */
export const DeviceGizmo = ({ deviceId }: Props) => {
  const pose = useAppStore((state) => state.poses[deviceId]);
  const setPose = useAppStore((state) => state.setPose);
  // FPSモードで操作中のデバイスは発光ハイライトする
  const isFpsTarget = useAppStore((state) => state.fpsTarget === deviceId);

  // ストアのポーズ→ギズモの行列 (回転はYXZオイラー)
  const matrix = useMemo(() => {
    const euler = new Euler(
      MathUtils.degToRad(pose.rotDeg[0]),
      MathUtils.degToRad(pose.rotDeg[1]),
      MathUtils.degToRad(pose.rotDeg[2]),
      'YXZ',
    );
    return new Matrix4().compose(
      new Vector3(...pose.pos),
      new Quaternion().setFromEuler(euler),
      new Vector3(1, 1, 1),
    );
  }, [pose]);

  /**
   * ギズモのドラッグ結果をストアへ反映する。
   * @param {Matrix4} local - ドラッグ後のローカル行列
   */
  const handleDrag = (local: Matrix4): void => {
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    local.decompose(position, quaternion, scale);

    const euler = new Euler().setFromQuaternion(quaternion, 'YXZ');
    setPose(deviceId, {
      pos: [position.x, position.y, position.z],
      rotDeg: [
        MathUtils.radToDeg(euler.x),
        MathUtils.radToDeg(euler.y),
        MathUtils.radToDeg(euler.z),
      ],
    });
  };

  const color = DEVICE_COLORS[deviceId];

  return (
    <PivotControls
      matrix={matrix}
      onDrag={handleDrag}
      scale={deviceId === 'hmd' ? 0.35 : 0.25}
      depthTest={false}
      disableScaling
      annotations={false}
      // ギズモの見た目だけY軸180°回転させ、Z矢印をデバイスの正面(-Z)向きにする
      // (ドラッグ結果の行列には影響しない。dreiの軸方向は+固定のため)
      rotation={[0, Math.PI, 0]}
    >
      {deviceId === 'hmd' ? (
        <group>
          {/* HMD本体 */}
          <mesh>
            <boxGeometry args={[0.19, 0.11, 0.11]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={isFpsTarget ? 0.9 : 0}
            />
          </mesh>
          {/* 前面(視線方向 -Z)のマーカー */}
          <mesh position={[0, 0, -0.06]}>
            <boxGeometry args={[0.17, 0.09, 0.01]} />
            <meshStandardMaterial color="#1a1a26" />
          </mesh>
        </group>
      ) : (
        <group>
          {/* コントローラー本体 */}
          <mesh>
            <sphereGeometry args={[0.035, 24, 16]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={isFpsTarget ? 0.9 : 0}
            />
          </mesh>
          {/* グリップ部分(下向き) */}
          <mesh position={[0, -0.05, 0.02]} rotation={[Math.PI / 8, 0, 0]}>
            <cylinderGeometry args={[0.016, 0.02, 0.09, 16]} />
            <meshStandardMaterial color="#2a2a38" />
          </mesh>
          {/* 向きマーカー(-Z) */}
          <mesh position={[0, 0.01, -0.045]}>
            <boxGeometry args={[0.01, 0.01, 0.03]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
        </group>
      )}
    </PivotControls>
  );
};
