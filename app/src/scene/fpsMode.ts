import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import type { DeviceId } from '../ipc/protocol';
import { sendInputs } from '../ipc/wsClient';
import {
  LAYOUT_MAPPINGS,
  PROFILE_LAYOUTS,
  type KeybindActionId,
  type LayoutMapping,
} from '../settings/keybindDefs';
import { mergeKeybinds, useSettingsStore } from '../state/settings';
import { useAppStore, type EditablePose } from '../state/store';

/**
 * 1イベントあたりのmovement上限 (px)。
 * Chromiumのポインタロック既知バグ(高ポーリングレートのマウスで巨大なmovementX/Yが
 * 突発的に届く)対策。8ms間隔で120px=秒速15,000px相当なので人間の操作では超えない
 */
const MAX_EVENT_DELTA = 120;
/** 1秒あたりに適用する回転の上限 (度/s)。スパイクが漏れても瞬間回転を物理的に防ぐ */
const MAX_TURN_SPEED_DEG = 720;

/**
 * 現在のプロファイルのレイアウト対応表を返す。
 * @returns {LayoutMapping} レイアウト対応表
 */
const currentLayout = (): LayoutMapping =>
  LAYOUT_MAPPINGS[PROFILE_LAYOUTS[useAppStore.getState().profile] ?? 'touch'];

/**
 * 現在のプロファイルで有効なキーバインドを返す(共通+プロファイル上書き)。
 * @returns {Record<KeybindActionId, string>} 解決済みバインド
 */
const activeKeybinds = (): Record<KeybindActionId, string> =>
  mergeKeybinds(useSettingsStore.getState().keybinds, useAppStore.getState().profile);

let active = false;
let targetDevice: DeviceId = 'hmd';
let pressedKeys = new Set<string>();
let rafId = 0;
let lastTime = 0;
let onExitCallback: (() => void) | undefined;

// mousemoveはrAFより高頻度で発火するため、移動量をためて1フレーム1回だけ適用する
// (毎イベントでストア更新するとReact再レンダリング連打でカクつく)
let pendingYawDeg = 0;
let pendingPitchDeg = 0;

/**
 * HMD主体モードでコントローラーを追従させるための相対変換(HMDローカル基準)。
 * HMDを親としたアンカーのように、位置も回転も剛体でついてくる
 */
type FollowOffset = {
  id: Extract<DeviceId, 'left' | 'right'>;
  localPos: Vector3;
  localRot: Quaternion;
};
let followOffsets: FollowOffset[] = [];

/**
 * ストアのオイラー角(度・YXZ)からクォータニオンを作る。
 * @param {[number, number, number]} rotDeg - [ピッチ, ヨー, ロール] (度)
 * @returns {Quaternion} クォータニオン
 */
const quatFromRotDeg = (rotDeg: [number, number, number]): Quaternion =>
  new Quaternion().setFromEuler(
    new Euler(
      MathUtils.degToRad(rotDeg[0]),
      MathUtils.degToRad(rotDeg[1]),
      MathUtils.degToRad(rotDeg[2]),
      'YXZ',
    ),
  );

/**
 * 角度を-180〜180度に正規化する。
 * @param {number} deg - 角度(度)
 * @returns {number} 正規化した角度
 */
const normalizeDeg = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

/**
 * 値を±limitにクランプする。
 * @param {number} value - 対象値
 * @param {number} limit - 上限(正の値)
 * @returns {number} クランプ後の値
 */
const clampAbs = (value: number, limit: number): number =>
  Math.max(-limit, Math.min(limit, value));

/**
 * 位置を0.1mm単位に丸める(パネルの数値表示を読みやすくするため)。
 * @param {number} value - 位置(m)
 * @returns {number} 丸めた値
 */
const roundPos = (value: number): number => Math.round(value * 10000) / 10000;

/**
 * 角度を0.01度単位に丸める。
 * @param {number} deg - 角度(度)
 * @returns {number} 丸めた値
 */
const roundDeg = (deg: number): number => Math.round(deg * 100) / 100;

/**
 * FPSモードが有効かどうかを返す。
 * @returns {boolean} 有効ならtrue
 */
export const isFpsModeActive = (): boolean => active;

/**
 * 現在のプロファイルの2D軸ベースパス名を返す。
 * @returns {string} joystick | thumbstick | trackpad
 */
const stickBase = (): string => currentLayout().stickBase;

/**
 * 現在のコントローラーの位置・回転を、HMDを親とした相対変換として記録する。
 * HMD主体モードでHMDが動く/回ると、この相対変換を保ったまま剛体で追従する。
 */
const captureFollowOffsets = (): void => {
  const { poses } = useAppStore.getState();
  const hmd = poses.hmd;
  const hmdQuatInv = quatFromRotDeg(hmd.rotDeg).invert();

  followOffsets = (['left', 'right'] as const).map((id) => {
    const pose = poses[id];
    return {
      id,
      localPos: new Vector3(
        pose.pos[0] - hmd.pos[0],
        pose.pos[1] - hmd.pos[1],
        pose.pos[2] - hmd.pos[2],
      ).applyQuaternion(hmdQuatInv),
      localRot: hmdQuatInv.clone().multiply(quatFromRotDeg(pose.rotDeg)),
    };
  });
};

/**
 * FPSモード中に追従オフセットを取り直す(追従チェックボックスをONにした時用)。
 * @returns {void}
 */
export const recaptureFollowOffsets = (): void => {
  if (active) {
    captureFollowOffsets();
  }
};

/**
 * 操作対象デバイスを切り替える。
 * @param {DeviceId} device - 新しい操作対象
 */
const switchTarget = (device: DeviceId): void => {
  if (targetDevice === device) {
    return;
  }
  // コントローラーを個別に動かした結果を、次のHMD主体移動の追従オフセットに反映する
  if (device === 'hmd') {
    captureFollowOffsets();
  }
  targetDevice = device;
  useAppStore.getState().setFpsTarget(device);
};

/**
 * マウス移動量をためる(適用はtick側で1フレーム1回)。
 * Chromiumバグによる異常値はイベント単位でクランプする。
 * @param {MouseEvent} e - マウスイベント
 */
const handleMouseMove = (e: MouseEvent): void => {
  if (Math.abs(e.movementX) > MAX_EVENT_DELTA || Math.abs(e.movementY) > MAX_EVENT_DELTA) {
    console.debug(`[fps] 異常なマウス移動量をクランプ: (${e.movementX}, ${e.movementY})`);
  }
  const sensitivity = useSettingsStore.getState().general.mouseSensitivity;
  pendingYawDeg -= clampAbs(e.movementX, MAX_EVENT_DELTA) * sensitivity;
  pendingPitchDeg -= clampAbs(e.movementY, MAX_EVENT_DELTA) * sensitivity;
};

/**
 * トリガー/グリップのアナログ入力を送信する。
 * @param {DeviceId} device - 対象デバイス
 * @param {'trigger' | 'grip'} kind - 入力の種類
 * @param {boolean} down - 押されているか
 */
const sendAnalog = (device: DeviceId, kind: 'trigger' | 'grip', down: boolean): void => {
  if (kind === 'trigger') {
    sendInputs(device, {
      '/input/trigger/value': down ? 1 : 0,
      '/input/trigger/click': down,
      '/input/trigger/touch': down,
    });
  } else {
    sendInputs(device, {
      '/input/grip/value': down ? 1 : 0,
      '/input/grip/touch': down,
    });
  }
};

/**
 * ボタン(click+touch)を送信する。
 * @param {DeviceId} device - 対象デバイス
 * @param {string} name - コンポーネント名 (例: "a")
 * @param {boolean} down - 押されているか
 */
const sendButtonInput = (device: DeviceId, name: string, down: boolean): void => {
  sendInputs(device, {
    [`/input/${name}/click`]: down,
    [`/input/${name}/touch`]: down,
  });
};

/**
 * スティックの軸値を、スティック系キーの押下状態から計算して送信する。
 * @param {'left' | 'right'} device - 対象コントローラー
 */
const sendStickFromKeys = (device: 'left' | 'right'): void => {
  const kb = activeKeybinds();
  const prefix = device === 'left' ? 'leftStick' : 'rightStick';
  const x =
    (pressedKeys.has(kb[`${prefix}Right`]) ? 1 : 0) - (pressedKeys.has(kb[`${prefix}Left`]) ? 1 : 0);
  const y =
    (pressedKeys.has(kb[`${prefix}Up`]) ? 1 : 0) - (pressedKeys.has(kb[`${prefix}Down`]) ? 1 : 0);
  const base = stickBase();
  sendInputs(device, {
    [`/input/${base}/x`]: x,
    [`/input/${base}/y`]: y,
    [`/input/${base}/touch`]: x !== 0 || y !== 0,
  });
};

/**
 * ボタン系抽象アクションを現在のレイアウトの実コンポーネントに変換して送信する。
 * そのデバイスに存在しないボタンは何もしない。
 * @param {'left' | 'right'} device - 対象コントローラー
 * @param {'leftPrimary' | 'leftSecondary' | 'rightPrimary' | 'rightSecondary'} action - 抽象アクション
 * @param {boolean} down - 押されているか
 */
const sendMappedButton = (
  device: 'left' | 'right',
  action: 'leftPrimary' | 'leftSecondary' | 'rightPrimary' | 'rightSecondary',
  down: boolean,
): void => {
  const name = currentLayout().buttons[action];
  if (name) {
    sendButtonInput(device, name, down);
  }
};

/**
 * キーバインドアクションを実行する(移動系はtick側でポーリングするためここでは扱わない)。
 * @param {KeybindActionId} id - アクションID
 * @param {boolean} down - 押下かどうか
 */
const dispatchAction = (id: KeybindActionId, down: boolean): void => {
  switch (id) {
    case 'targetHmd':
      if (down) switchTarget('hmd');
      break;
    case 'targetLeft':
      if (down) switchTarget('left');
      break;
    case 'targetRight':
      if (down) switchTarget('right');
      break;
    case 'leftTrigger':
      sendAnalog('left', 'trigger', down);
      break;
    case 'leftGrip':
      sendAnalog('left', 'grip', down);
      break;
    case 'rightTrigger':
      sendAnalog('right', 'trigger', down);
      break;
    case 'rightGrip':
      sendAnalog('right', 'grip', down);
      break;
    case 'leftPrimary':
    case 'leftSecondary':
      sendMappedButton('left', id, down);
      break;
    case 'rightPrimary':
    case 'rightSecondary':
      sendMappedButton('right', id, down);
      break;
    case 'leftSystem':
      sendButtonInput('left', 'system', down);
      break;
    case 'rightSystem':
      sendButtonInput('right', 'system', down);
      break;
    case 'leftStickClick':
      sendInputs('left', { [`/input/${stickBase()}/click`]: down });
      break;
    case 'rightStickClick':
      sendInputs('right', { [`/input/${stickBase()}/click`]: down });
      break;
    case 'leftStickUp':
    case 'leftStickDown':
    case 'leftStickLeft':
    case 'leftStickRight':
      sendStickFromKeys('left');
      break;
    case 'rightStickUp':
    case 'rightStickDown':
    case 'rightStickLeft':
    case 'rightStickRight':
      sendStickFromKeys('right');
      break;
    default:
      break;
  }
};

/**
 * キー/マウスボタンの押下状態を反映してアクションを発火する共通処理。
 * @param {string} code - KeyboardEvent.code または "Mouse0"等の疑似コード
 * @param {boolean} down - 押下かどうか
 */
const processBinding = (code: string, down: boolean): void => {
  const changed = pressedKeys.has(code) !== down;
  if (down) {
    pressedKeys.add(code);
  } else {
    pressedKeys.delete(code);
  }
  if (!changed) {
    return;
  }

  // 同じキーに複数アクションが割当たっていても全部発火させる
  const keybinds = activeKeybinds();
  for (const [id, bound] of Object.entries(keybinds) as [KeybindActionId, string][]) {
    if (bound === code) {
      dispatchAction(id, down);
    }
  }
};

/**
 * キー押下/解放の処理。
 * @param {KeyboardEvent} e - キーイベント
 * @param {boolean} down - 押下かどうか
 */
const handleKey = (e: KeyboardEvent, down: boolean): void => {
  // ポインタロックが取れていない環境でも必ずEscで抜けられるようにする(Escは固定)
  if (down && e.code === 'Escape') {
    stopFpsMode();
    return;
  }

  // スクロール等のブラウザ既定動作を抑止
  if (e.code.startsWith('Arrow') || e.code === 'Space') {
    e.preventDefault();
  }

  processBinding(e.code, down);
};

/**
 * 毎フレームの更新処理。ためたマウス回転とWASD移動をまとめて1回のsetPosesで適用する。
 * HMD主体の時はコントローラーも追従させる。
 * @param {number} time - タイムスタンプ(ms)
 */
const tick = (time: number): void => {
  if (!active) {
    return;
  }

  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  const store = useAppStore.getState();
  const { general } = useSettingsStore.getState();
  const keybinds = activeKeybinds();
  const pose = store.poses[targetDevice];

  /**
   * アクションのキーが押されているか。
   * @param {KeybindActionId} id - アクションID
   * @returns {boolean} 押されていればtrue
   */
  const has = (id: KeybindActionId): boolean => pressedKeys.has(keybinds[id]);

  // 回転: ためたマウス移動量を、角速度上限をかけて適用
  // (超過分は持ち越さず捨てる。持ち越すとスパイク後に勝手に回り続けるため)
  let [pitch, yaw, roll] = pose.rotDeg;
  const rotated = pendingYawDeg !== 0 || pendingPitchDeg !== 0;
  if (rotated) {
    const maxTurnDeg = MAX_TURN_SPEED_DEG * dt;
    yaw = roundDeg(normalizeDeg(yaw + clampAbs(pendingYawDeg, maxTurnDeg)));
    pitch = roundDeg(Math.max(-89, Math.min(89, pitch + clampAbs(pendingPitchDeg, maxTurnDeg))));
    pendingYawDeg = 0;
    pendingPitchDeg = 0;
  }

  // 移動: 視線のヨー基準 (-Zが正面。forward=(-sinθ,0,-cosθ), right=(cosθ,0,-sinθ))
  const forward = (has('moveForward') ? 1 : 0) - (has('moveBack') ? 1 : 0);
  const strafe = (has('moveRight') ? 1 : 0) - (has('moveLeft') ? 1 : 0);
  const vertical = (has('moveUp') ? 1 : 0) - (has('moveDown') ? 1 : 0);
  const moved = forward !== 0 || strafe !== 0 || vertical !== 0;

  if (rotated || moved) {
    const speed = has('run') ? general.runSpeed : general.walkSpeed;
    const yawRad = (yaw * Math.PI) / 180;
    const c = Math.cos(yawRad);
    const s = Math.sin(yawRad);

    const newPos: [number, number, number] = [
      roundPos(pose.pos[0] + (-s * forward + c * strafe) * speed * dt),
      roundPos(pose.pos[1] + vertical * speed * dt),
      roundPos(pose.pos[2] + (-c * forward - s * strafe) * speed * dt),
    ];

    const updates: Partial<Record<DeviceId, Partial<EditablePose>>> = {
      [targetDevice]: { pos: newPos, rotDeg: [pitch, yaw, roll] },
    };

    // HMD主体: 追従がONの時だけコントローラーをHMDアンカーの相対変換で追従させる(位置+回転)
    if (targetDevice === 'hmd' && store.followControllers) {
      const hmdQuat = quatFromRotDeg([pitch, yaw, roll]);
      for (const offset of followOffsets) {
        const worldPos = offset.localPos.clone().applyQuaternion(hmdQuat);
        const worldRot = hmdQuat.clone().multiply(offset.localRot);
        const euler = new Euler().setFromQuaternion(worldRot, 'YXZ');
        updates[offset.id] = {
          pos: [
            roundPos(newPos[0] + worldPos.x),
            roundPos(newPos[1] + worldPos.y),
            roundPos(newPos[2] + worldPos.z),
          ],
          rotDeg: [
            roundDeg(MathUtils.radToDeg(euler.x)),
            roundDeg(MathUtils.radToDeg(euler.y)),
            roundDeg(MathUtils.radToDeg(euler.z)),
          ],
        };
      }
    }

    store.setPoses(updates);
  }

  rafId = requestAnimationFrame(tick);
};

const handleMouseDown = (e: MouseEvent): void => processBinding(`Mouse${e.button}`, true);
const handleMouseUp = (e: MouseEvent): void => processBinding(`Mouse${e.button}`, false);
const handleKeyDown = (e: KeyboardEvent): void => handleKey(e, true);
const handleKeyUp = (e: KeyboardEvent): void => handleKey(e, false);
const handleContextMenu = (e: Event): void => e.preventDefault();

/**
 * ポインタロック解除を検知してFPSモードを終了する。
 */
const handlePointerLockChange = (): void => {
  if (document.pointerLockElement === null) {
    stopFpsMode();
  }
};

/**
 * ポインタロック取得失敗時もFPSモードを終了する。
 */
const handlePointerLockError = (): void => {
  stopFpsMode();
};

/**
 * FPSモードを開始する(要素にポインタロックを要求)。
 * @param {HTMLElement} element - ロック対象の要素
 * @param {() => void} onExit - 終了時に呼ばれるコールバック
 * @param {DeviceId} [initialTarget] - 開始時の操作対象 (省略時はHMD)
 * @returns {void}
 */
export const startFpsMode = (element: HTMLElement, onExit: () => void, initialTarget: DeviceId = 'hmd'): void => {
  if (active) {
    return;
  }
  active = true;
  targetDevice = initialTarget;
  pressedKeys = new Set();
  pendingYawDeg = 0;
  pendingPitchDeg = 0;
  onExitCallback = onExit;
  lastTime = performance.now();

  captureFollowOffsets();
  useAppStore.getState().setFpsTarget(initialTarget);

  element.requestPointerLock();
  document.addEventListener('pointerlockerror', handlePointerLockError);
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);
  document.addEventListener('contextmenu', handleContextMenu);
  document.addEventListener('pointerlockchange', handlePointerLockChange);

  rafId = requestAnimationFrame(tick);
};

/**
 * FPSモードを終了してリスナーを解除する。
 * @returns {void}
 */
export const stopFpsMode = (): void => {
  if (!active) {
    return;
  }
  active = false;

  cancelAnimationFrame(rafId);
  document.removeEventListener('pointerlockerror', handlePointerLockError);
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mousedown', handleMouseDown);
  document.removeEventListener('mouseup', handleMouseUp);
  document.removeEventListener('keydown', handleKeyDown);
  document.removeEventListener('keyup', handleKeyUp);
  document.removeEventListener('contextmenu', handleContextMenu);
  document.removeEventListener('pointerlockchange', handlePointerLockChange);

  if (document.pointerLockElement !== null) {
    document.exitPointerLock();
  }

  useAppStore.getState().setFpsTarget(null);

  onExitCallback?.();
  onExitCallback = undefined;
};
