import { HUB_URL, type DeviceId, type HubMessage, type PoseBatchMessage } from './protocol';
import { eulerDegToQuat, quatToEulerDeg } from '../lib/math';
import { useAppStore, type EditablePose } from '../state/store';

let ws: WebSocket | undefined;
let reconnectTimer: number | undefined;

/**
 * ハブWebSocketへ接続する。切断時は1秒後に自動再接続。
 * @returns {void}
 */
export const connectHub = (): void => {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  ws = new WebSocket(HUB_URL);

  ws.addEventListener('open', () => {
    useAppStore.getState().setStatus({ hubConnected: true });
  });

  ws.addEventListener('message', (event) => {
    handleMessage(event.data);
  });

  ws.addEventListener('close', () => {
    useAppStore.getState().setStatus({ hubConnected: false, driverConnected: false });
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    ws?.close();
  });
};

/**
 * 再接続をスケジュールする(多重予約はしない)。
 * @returns {void}
 */
const scheduleReconnect = (): void => {
  if (reconnectTimer !== undefined) {
    return;
  }
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    connectHub();
  }, 1000);
};

/**
 * ハブから届いたメッセージを処理してストアへ反映する。
 * @param {unknown} data - 受信データ(JSON文字列)
 * @returns {void}
 */
const handleMessage = (data: unknown): void => {
  if (typeof data !== 'string') {
    return;
  }

  let message: HubMessage;
  try {
    message = JSON.parse(data) as HubMessage;
  } catch {
    return;
  }

  const store = useAppStore.getState();

  switch (message.type) {
    case 'status':
      store.setStatus({ driverConnected: message.driverConnected, clients: message.clients });
      break;
    case 'haptic':
      store.notifyHaptic(message.device);
      break;
    case 'pose_batch': {
      // 外部クライアント(自動化API等)が動かしたポーズをUIにも反映する
      const updates: Partial<Record<DeviceId, Partial<EditablePose>>> = {};
      for (const [id, pose] of Object.entries(message.poses)) {
        if (pose) {
          updates[id as DeviceId] = { pos: pose.pos, rotDeg: quatToEulerDeg(pose.rot) };
        }
      }
      store.setPosesFromRemote(updates);
      break;
    }
    default:
      break;
  }
};

/**
 * 現在のストアのポーズをpose_batchメッセージとして送信する。
 * @returns {void}
 */
const sendPoses = (): void => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  const { poses } = useAppStore.getState();
  const message: PoseBatchMessage = {
    v: 1,
    type: 'pose_batch',
    poses: Object.fromEntries(
      (Object.keys(poses) as DeviceId[]).map((id) => [
        id,
        {
          pos: poses[id].pos,
          rot: eulerDegToQuat(...poses[id].rotDeg),
        },
      ]),
    ),
  };

  ws.send(JSON.stringify(message));
};

/**
 * 入力(ボタン/軸)の変更を送信する。
 * @param {DeviceId} device - 対象デバイス
 * @param {Record<string, boolean | number>} inputs - OpenVRコンポーネントパス→値
 * @returns {void}
 */
export const sendInputs = (device: DeviceId, inputs: Record<string, boolean | number>): void => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify({ v: 1, type: 'input', device, inputs }));
};

/**
 * ポーズ送信ループを開始する。
 * rAFごとにストアの変更(poseVersion)を確認し、変化があった時だけ送信する。
 * @returns {void}
 */
export const startPoseSender = (): void => {
  // 初期値(0)から送信しない: 接続しただけで他クライアントやドライバーのポーズを
  // 自分の初期ポーズで上書きしないため。ローカルで変更が起きてから送り始める
  let lastSentVersion = 0;

  const tick = (): void => {
    const { poseVersion, status } = useAppStore.getState();
    if (status.hubConnected && poseVersion !== lastSentVersion) {
      sendPoses();
      lastSentVersion = poseVersion;
    }
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
};
