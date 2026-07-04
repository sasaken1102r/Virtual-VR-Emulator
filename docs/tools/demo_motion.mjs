/**
 * 撮影用の振り付けスクリプト。
 * 使い方:
 *   node demo_motion.mjs pose   … 見栄えのいい静止ポーズを1回送って終了
 *   node demo_motion.mjs loop 12 … 12秒間なめらかに動かして終了
 *   node demo_motion.mjs reset  … デフォルトポーズに戻して終了
 */
const mode = process.argv[2] ?? 'pose';
const durationSec = Number(process.argv[3] ?? 12);

const ws = new WebSocket('ws://127.0.0.1:18320');

/**
 * YXZオイラー角(度)からクォータニオンを作る。
 * @param {number} pitchDeg - ピッチ(度)
 * @param {number} yawDeg - ヨー(度)
 * @param {number} rollDeg - ロール(度)
 * @returns {{x:number,y:number,z:number,w:number}} クォータニオン
 */
const quat = (pitchDeg, yawDeg, rollDeg = 0) => {
  const p = (pitchDeg * Math.PI) / 360;
  const y = (yawDeg * Math.PI) / 360;
  const r = (rollDeg * Math.PI) / 360;
  const [sp, cp, sy, cy, sr, cr] = [Math.sin(p), Math.cos(p), Math.sin(y), Math.cos(y), Math.sin(r), Math.cos(r)];
  // YXZ順: q = qy * qx * qz
  return {
    w: cy * cp * cr + sy * sp * sr,
    x: cy * sp * cr + sy * cp * sr,
    y: sy * cp * cr - cy * sp * sr,
    z: cy * cp * sr - sy * sp * cr,
  };
};

/**
 * ポーズ一式を送る。
 * @param {object} poses - デバイスID→ポーズ
 */
const send = (poses) => ws.send(JSON.stringify({ v: 1, type: 'pose_batch', poses }));

/** 見栄え用の静止ポーズ */
const heroPose = () => ({
  hmd: { pos: [0, 1.7, 0], rot: quat(-8, -18) },
  left: { pos: [-0.28, 1.35, -0.38], rot: quat(35, 20, -15) },
  right: { pos: [0.22, 1.5, -0.32], rot: quat(50, -12, 10) },
});

/** デフォルトポーズ */
const defaultPose = () => ({
  hmd: { pos: [0, 1.7, 0], rot: quat(0, 0) },
  left: { pos: [-0.2, 1.4, -0.3], rot: quat(0, 0) },
  right: { pos: [0.2, 1.4, -0.3], rot: quat(0, 0) },
});

ws.addEventListener('open', () => {
  if (mode === 'pose') {
    send(heroPose());
    setTimeout(() => process.exit(0), 300);
    return;
  }
  if (mode === 'reset') {
    send(defaultPose());
    setTimeout(() => process.exit(0), 300);
    return;
  }

  // loop: なめらかに見回し+手を振る
  const start = Date.now();
  const timer = setInterval(() => {
    const t = (Date.now() - start) / 1000;
    if (t > durationSec) {
      clearInterval(timer);
      send(defaultPose());
      setTimeout(() => process.exit(0), 300);
      return;
    }

    const yaw = Math.sin(t * 0.7) * 35;             // ゆっくり左右を見回す
    const pitch = Math.sin(t * 1.1) * 8 - 4;        // 軽く上下
    const bob = Math.sin(t * 2.2) * 0.02;           // 歩行っぽい上下動

    send({
      hmd: { pos: [Math.sin(t * 0.5) * 0.15, 1.7 + bob, 0], rot: quat(pitch, yaw) },
      left: {
        pos: [-0.25 + Math.sin(t * 1.8) * 0.06, 1.35 + Math.sin(t * 2.6) * 0.08, -0.35],
        rot: quat(30 + Math.sin(t * 2.6) * 20, 15, -10),
      },
      right: {
        pos: [0.25 + Math.sin(t * 1.4 + 1) * 0.05, 1.45 + Math.cos(t * 2.1) * 0.06, -0.33],
        rot: quat(40 + Math.cos(t * 2.1) * 15, -10, 8),
      },
    });
  }, 33);
});

ws.addEventListener('error', () => process.exit(1));
