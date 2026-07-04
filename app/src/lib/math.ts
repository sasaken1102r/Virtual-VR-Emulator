import { Euler, MathUtils, Quaternion } from 'three';
import type { Quat } from '../ipc/protocol';

/**
 * オイラー角(度)をクォータニオンに変換する。
 * 回転順序はYXZ(ヨー→ピッチ→ロール)でFPS視点操作と相性が良い。
 * three.jsもSteamVRも右手系Y-upなので座標変換は不要。
 * @param {number} pitchDeg - X軸回転(度)
 * @param {number} yawDeg - Y軸回転(度)
 * @param {number} rollDeg - Z軸回転(度)
 * @returns {Quat} クォータニオン
 * @example
 * eulerDegToQuat(0, 90, 0) // 左に90度向く
 */
export const eulerDegToQuat = (pitchDeg: number, yawDeg: number, rollDeg: number): Quat => {
  const euler = new Euler(
    MathUtils.degToRad(pitchDeg),
    MathUtils.degToRad(yawDeg),
    MathUtils.degToRad(rollDeg),
    'YXZ',
  );
  const q = new Quaternion().setFromEuler(euler);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
};

/**
 * クォータニオンをオイラー角(度)に変換する(YXZ順)。
 * @param {Quat} quat - クォータニオン
 * @returns {[number, number, number]} [pitch, yaw, roll] (度)
 */
export const quatToEulerDeg = (quat: Quat): [number, number, number] => {
  const euler = new Euler().setFromQuaternion(
    new Quaternion(quat.x, quat.y, quat.z, quat.w),
    'YXZ',
  );
  return [
    MathUtils.radToDeg(euler.x),
    MathUtils.radToDeg(euler.y),
    MathUtils.radToDeg(euler.z),
  ];
};
