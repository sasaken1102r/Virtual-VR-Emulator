/**
 * FPSモードのキーバインドアクション定義。
 * 設定画面とfpsMode本体の両方がこの定義を参照する(真実のソース)。
 *
 * ボタン系は「ボタン1/ボタン2」の抽象アクションで、実際のOpenVRコンポーネント名は
 * デバイスレイアウト(touch/knuckles/vive)ごとの対応表(LAYOUT_MAPPINGS)が吸収する。
 * ラベルは i18n の翻訳キー (keybinds.actions.*) で持つ。
 */

import i18n from '../i18n';

/** キーバインドできるアクションのID */
export type KeybindActionId =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'moveUp'
  | 'moveDown'
  | 'run'
  | 'targetHmd'
  | 'targetLeft'
  | 'targetRight'
  | 'leftTrigger'
  | 'leftGrip'
  | 'leftPrimary'
  | 'leftSecondary'
  | 'leftSystem'
  | 'leftStickClick'
  | 'leftStickUp'
  | 'leftStickDown'
  | 'leftStickLeft'
  | 'leftStickRight'
  | 'rightTrigger'
  | 'rightGrip'
  | 'rightPrimary'
  | 'rightSecondary'
  | 'rightSystem'
  | 'rightStickClick'
  | 'rightStickUp'
  | 'rightStickDown'
  | 'rightStickLeft'
  | 'rightStickRight';

/** アクションのグループID (表示名は keybinds.groups.* で翻訳) */
export type KeybindGroupId = 'move' | 'target' | 'left' | 'right';

/** アクション1件の定義 */
export type KeybindDef = {
  id: KeybindActionId;
  group: KeybindGroupId;
  defaultKey: string; // KeyboardEvent.code または "Mouse0"等の疑似コード
};

/** 全アクションの定義(設定画面の表示順) */
export const KEYBIND_DEFS: KeybindDef[] = [
  { id: 'moveForward', group: 'move', defaultKey: 'KeyW' },
  { id: 'moveBack', group: 'move', defaultKey: 'KeyS' },
  { id: 'moveLeft', group: 'move', defaultKey: 'KeyA' },
  { id: 'moveRight', group: 'move', defaultKey: 'KeyD' },
  { id: 'moveUp', group: 'move', defaultKey: 'Space' },
  { id: 'moveDown', group: 'move', defaultKey: 'KeyC' },
  { id: 'run', group: 'move', defaultKey: 'ShiftLeft' },

  { id: 'targetHmd', group: 'target', defaultKey: 'Digit1' },
  { id: 'targetLeft', group: 'target', defaultKey: 'Digit2' },
  { id: 'targetRight', group: 'target', defaultKey: 'Digit3' },

  { id: 'leftTrigger', group: 'left', defaultKey: 'KeyE' },
  { id: 'leftGrip', group: 'left', defaultKey: 'KeyR' },
  { id: 'leftPrimary', group: 'left', defaultKey: 'KeyZ' },
  { id: 'leftSecondary', group: 'left', defaultKey: 'KeyX' },
  { id: 'leftSystem', group: 'left', defaultKey: 'KeyQ' },
  { id: 'leftStickClick', group: 'left', defaultKey: 'KeyV' },
  { id: 'leftStickUp', group: 'left', defaultKey: 'ArrowUp' },
  { id: 'leftStickDown', group: 'left', defaultKey: 'ArrowDown' },
  { id: 'leftStickLeft', group: 'left', defaultKey: 'ArrowLeft' },
  { id: 'leftStickRight', group: 'left', defaultKey: 'ArrowRight' },

  { id: 'rightTrigger', group: 'right', defaultKey: 'Mouse0' },
  { id: 'rightGrip', group: 'right', defaultKey: 'Mouse2' },
  { id: 'rightPrimary', group: 'right', defaultKey: 'KeyF' },
  { id: 'rightSecondary', group: 'right', defaultKey: 'KeyG' },
  { id: 'rightSystem', group: 'right', defaultKey: 'KeyP' },
  { id: 'rightStickClick', group: 'right', defaultKey: 'KeyB' },
  { id: 'rightStickUp', group: 'right', defaultKey: 'KeyI' },
  { id: 'rightStickDown', group: 'right', defaultKey: 'KeyK' },
  { id: 'rightStickLeft', group: 'right', defaultKey: 'KeyJ' },
  { id: 'rightStickRight', group: 'right', defaultKey: 'KeyL' },
];

/** デフォルトのキーバインド一式 */
export const DEFAULT_KEYBINDS: Record<KeybindActionId, string> = Object.fromEntries(
  KEYBIND_DEFS.map((def) => [def.id, def.defaultKey]),
) as Record<KeybindActionId, string>;

/** コントローラーのレイアウト種別 */
export type ControllerLayoutKind = 'touch' | 'knuckles' | 'vive';

/** プロファイル→レイアウト種別 */
export const PROFILE_LAYOUTS: Record<string, ControllerLayoutKind> = {
  quest3: 'touch',
  quest2: 'touch',
  pico4: 'touch',
  index: 'knuckles',
  vive: 'vive',
};

/** ボタン系の抽象アクションID */
type ButtonActionId = 'leftPrimary' | 'leftSecondary' | 'rightPrimary' | 'rightSecondary';

/** レイアウトごとの、抽象アクション→実デバイスの対応 */
export type LayoutMapping = {
  /** 2D軸コンポーネントのベースパス名 */
  stickBase: string;
  /** ボタン系アクション→OpenVRコンポーネント名 (undefined=そのデバイスに存在しない) */
  buttons: Partial<Record<ButtonActionId, string>>;
  /** ボタン系アクションの実デバイスでの表示名 ("i18n:"始まりは翻訳キー) */
  buttonLabels: Partial<Record<ButtonActionId, string>>;
};

export const LAYOUT_MAPPINGS: Record<ControllerLayoutKind, LayoutMapping> = {
  touch: {
    stickBase: 'joystick',
    buttons: { leftPrimary: 'x', leftSecondary: 'y', rightPrimary: 'a', rightSecondary: 'b' },
    buttonLabels: { leftPrimary: 'X', leftSecondary: 'Y', rightPrimary: 'A', rightSecondary: 'B' },
  },
  knuckles: {
    stickBase: 'thumbstick',
    buttons: { leftPrimary: 'a', leftSecondary: 'b', rightPrimary: 'a', rightSecondary: 'b' },
    buttonLabels: { leftPrimary: 'A', leftSecondary: 'B', rightPrimary: 'A', rightSecondary: 'B' },
  },
  vive: {
    stickBase: 'trackpad',
    buttons: { leftPrimary: 'application_menu', rightPrimary: 'application_menu' },
    buttonLabels: { leftPrimary: 'i18n:input.menu', rightPrimary: 'i18n:input.menu' },
  },
};

/**
 * アクションが指定レイアウトのデバイスに存在するかを返す。
 * @param {KeybindActionId} id - アクションID
 * @param {ControllerLayoutKind} layout - レイアウト種別
 * @returns {boolean} 存在すればtrue
 */
export const actionAvailableForLayout = (id: KeybindActionId, layout: ControllerLayoutKind): boolean => {
  const mapping = LAYOUT_MAPPINGS[layout];
  if (id === 'leftPrimary' || id === 'leftSecondary' || id === 'rightPrimary' || id === 'rightSecondary') {
    return mapping.buttons[id] !== undefined;
  }
  return true;
};

/**
 * アクションの表示ラベルを返す(レイアウト指定時は実デバイスのボタン名を併記)。
 * @param {KeybindDef} def - アクション定義
 * @param {ControllerLayoutKind} [layout] - レイアウト種別
 * @returns {string} 表示ラベル
 * @example
 * actionLabel(def_leftPrimary, 'touch') // "左ボタン1 (X)"
 */
export const actionLabel = (def: KeybindDef, layout?: ControllerLayoutKind): string => {
  const base = i18n.t(`keybinds.actions.${def.id}`);
  if (!layout) {
    return base;
  }
  const raw = LAYOUT_MAPPINGS[layout].buttonLabels[def.id as ButtonActionId];
  if (!raw) {
    return base;
  }
  const real = raw.startsWith('i18n:') ? i18n.t(raw.slice(5)) : raw;
  return `${base} (${real})`;
};

/** 言語に依存しないキー表示名 */
const KEY_LABELS: Record<string, string> = {
  Space: 'Space',
  ShiftLeft: 'Shift',
  ControlLeft: 'Ctrl',
  AltLeft: 'Alt',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'BS',
};

/** 言語ごとに表示名が変わるキー(keys.* の翻訳キーを引く) */
const TRANSLATED_KEYS = new Set(['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4', 'ShiftRight', 'ControlRight', 'AltRight']);

/**
 * キーコードを表示用ラベルに変換する。
 * @param {string} code - KeyboardEvent.code または "Mouse0"等
 * @returns {string} 表示名 (例: "W", "左クリック")
 * @example
 * formatKeyCode('KeyW') // "W"
 */
export const formatKeyCode = (code: string): string => {
  if (TRANSLATED_KEYS.has(code)) {
    return i18n.t(`keys.${code}`);
  }
  if (KEY_LABELS[code]) {
    return KEY_LABELS[code];
  }
  if (code.startsWith('Key')) {
    return code.slice(3);
  }
  if (code.startsWith('Digit')) {
    return code.slice(5);
  }
  if (code.startsWith('Numpad')) {
    return `Num${code.slice(6)}`;
  }
  return code;
};
