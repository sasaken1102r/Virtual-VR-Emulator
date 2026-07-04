import { create } from 'zustand';
import type { DeviceId } from '../ipc/protocol';

/** UI上で編集する1デバイス分のポーズ (回転はオイラー角・度で保持) */
export type EditablePose = {
  pos: [number, number, number];
  rotDeg: [number, number, number];
};

/** 接続状態 */
export type ConnectionStatus = {
  /** フロント⇔ハブのWebSocket接続 */
  hubConnected: boolean;
  /** ドライバー⇔ハブの接続 */
  driverConnected: boolean;
  clients: number;
};

/** デバイスの初期配置 (立位、コントローラーは体の前) */
export const DEFAULT_POSES: Record<DeviceId, EditablePose> = {
  hmd: { pos: [0, 1.7, 0], rotDeg: [0, 0, 0] },
  left: { pos: [-0.2, 1.4, -0.3], rotDeg: [0, 0, 0] },
  right: { pos: [0.2, 1.4, -0.3], rotDeg: [0, 0, 0] },
};

type AppState = {
  poses: Record<DeviceId, EditablePose>;
  status: ConnectionStatus;
  /** 現在のデバイスプロファイル (quest3/quest2/pico4/index/vive) */
  profile: string;
  /** FPSモードの操作対象 (null=FPSモード外) */
  fpsTarget: DeviceId | null;
  /** HMD主体FPSモードでコントローラーを追従させるか */
  followControllers: boolean;
  /** SteamVRが起動中か (SetupPanelのポーリングが更新する。undefined=未取得) */
  steamvrRunning: boolean | undefined;
  /** ポーズ変更のシリアル番号 (送信ループがこの変化を見て送信する) */
  poseVersion: number;
  /** デバイスごとの最後のハプティクス発生時刻 (UI可視化用) */
  lastHaptic: Partial<Record<DeviceId, number>>;
  setPose: (id: DeviceId, pose: Partial<EditablePose>) => void;
  /** 複数デバイスをまとめて更新する(再レンダリング1回で済む) */
  setPoses: (updates: Partial<Record<DeviceId, Partial<EditablePose>>>) => void;
  /** 外部クライアント由来のポーズを反映する(ハブへ送り返さない) */
  setPosesFromRemote: (updates: Partial<Record<DeviceId, Partial<EditablePose>>>) => void;
  resetPoses: () => void;
  setStatus: (status: Partial<ConnectionStatus>) => void;
  setProfile: (profile: string) => void;
  setFpsTarget: (target: DeviceId | null) => void;
  setFollowControllers: (follow: boolean) => void;
  setSteamvrRunning: (running: boolean) => void;
  notifyHaptic: (id: DeviceId) => void;
};

/** アプリ全体の状態ストア (単一の真実) */
export const useAppStore = create<AppState>((set) => ({
  poses: structuredClone(DEFAULT_POSES),
  status: { hubConnected: false, driverConnected: false, clients: 0 },
  profile: 'quest3',
  fpsTarget: null,
  followControllers: false,
  steamvrRunning: undefined,
  poseVersion: 0,
  lastHaptic: {},
  setPose: (id, pose) =>
    set((state) => ({
      poses: { ...state.poses, [id]: { ...state.poses[id], ...pose } },
      poseVersion: state.poseVersion + 1,
    })),
  setPoses: (updates) =>
    set((state) => {
      const poses = { ...state.poses };
      for (const [id, pose] of Object.entries(updates) as [DeviceId, Partial<EditablePose>][]) {
        poses[id] = { ...poses[id], ...pose };
      }
      return { poses, poseVersion: state.poseVersion + 1 };
    }),
  setPosesFromRemote: (updates) =>
    set((state) => {
      const poses = { ...state.poses };
      for (const [id, pose] of Object.entries(updates) as [DeviceId, Partial<EditablePose>][]) {
        poses[id] = { ...poses[id], ...pose };
      }
      // poseVersionは上げない(外部由来のポーズを送り返してループしないように)
      return { poses };
    }),
  resetPoses: () =>
    set((state) => ({
      poses: structuredClone(DEFAULT_POSES),
      poseVersion: state.poseVersion + 1,
    })),
  setStatus: (status) => set((state) => ({ status: { ...state.status, ...status } })),
  setProfile: (profile) => set(() => ({ profile })),
  setFpsTarget: (fpsTarget) => set(() => ({ fpsTarget })),
  setFollowControllers: (followControllers) => set(() => ({ followControllers })),
  setSteamvrRunning: (steamvrRunning) => set(() => ({ steamvrRunning })),
  notifyHaptic: (id) =>
    set((state) => ({ lastHaptic: { ...state.lastHaptic, [id]: Date.now() } })),
}));
