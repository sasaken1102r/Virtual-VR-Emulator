/**
 * ハブWebSocketプロトコルのメッセージ定義。
 * このファイルがスキーマの「真実のソース」(ドライバーC++/Rustハブもこれに準拠)。
 */

/** 仮想デバイスの識別子 (v2でトラッカー追加予定) */
export type DeviceId = 'hmd' | 'left' | 'right';

/** クォータニオン */
export type Quat = {
  x: number;
  y: number;
  z: number;
  w: number;
};

/** 1デバイス分のポーズ (SteamVR右手系Y-up、メートル) */
export type PoseData = {
  pos: [number, number, number];
  rot: Quat;
  vel?: [number, number, number];
  angVel?: [number, number, number];
  connected?: boolean;
};

/** ポーズ一括更新 (フロント→ドライバー、毎フレーム) */
export type PoseBatchMessage = {
  v: 1;
  type: 'pose_batch';
  poses: Partial<Record<DeviceId, PoseData>>;
};

/** 入力更新 (フロント→ドライバー、変化時のみ)。キーはOpenVRコンポーネントパス */
export type InputMessage = {
  v: 1;
  type: 'input';
  device: DeviceId;
  inputs: Record<string, boolean | number>;
};

/** ハブ接続状態 (ハブ→全クライアント) */
export type StatusMessage = {
  v: 1;
  type: 'status';
  driverConnected: boolean;
  clients: number;
};

/** ハプティクスイベント (ドライバー→フロント) */
export type HapticMessage = {
  v: 1;
  type: 'haptic';
  device: DeviceId;
  durationSeconds: number;
  frequency: number;
  amplitude: number;
};

/** ドライバー接続通知 (ドライバー→ハブ) */
export type DriverHelloMessage = {
  v: 1;
  type: 'driver_hello';
  driver: string;
  version: string;
};

/** ハブから届く可能性のあるメッセージ */
export type HubMessage =
  | PoseBatchMessage
  | InputMessage
  | StatusMessage
  | HapticMessage
  | DriverHelloMessage;

/** ハブWebSocketのデフォルトURL */
export const HUB_URL = 'ws://127.0.0.1:18320';
