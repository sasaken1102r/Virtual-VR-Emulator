# VVRE WebSocketプロトコル仕様 (v1)

ハブ: `ws://127.0.0.1:18320` (Tauriアプリ内蔵)。フロントエンド・SteamVRドライバー・外部クライアントが全員ここに接続する。1テキストフレーム=1 JSONオブジェクト。

- 座標系: SteamVR準拠の右手系Y-up、単位はメートル
- クォータニオン: `{x, y, z, w}`
- ハブは `pose_batch` / `input` / `config` の最新値をキャッシュし、新規接続クライアント(=再接続したドライバー)にリプレイする
- TypeScript型定義: `app/src/ipc/protocol.ts`(真実のソース)

## メッセージ一覧

### pose_batch (クライアント → ドライバー)

毎フレーム送信。含まれるデバイスだけ更新される。

```json
{
  "v": 1,
  "type": "pose_batch",
  "poses": {
    "hmd":   { "pos": [0, 1.7, 0], "rot": { "x": 0, "y": 0, "z": 0, "w": 1 } },
    "left":  { "pos": [-0.2, 1.4, -0.3], "rot": { "x": 0, "y": 0, "z": 0, "w": 1 },
               "vel": [0, 0, 0], "angVel": [0, 0, 0], "connected": true }
  }
}
```

`vel` / `angVel` / `connected` は省略可。デバイスID: `hmd` | `left` | `right`(v2でトラッカー追加予定)。

### input (クライアント → ドライバー)

変化時のみ送信。キーはOpenVR入力コンポーネントパスそのまま。bool=ボタン、number=スカラー。

```json
{
  "v": 1,
  "type": "input",
  "device": "right",
  "inputs": {
    "/input/a/click": true,
    "/input/a/touch": true,
    "/input/trigger/value": 0.72,
    "/input/joystick/x": 0.5,
    "/input/joystick/y": -0.1
  }
}
```

利用可能なパスはプロファイルにより異なる(ドライバーの`CreateInputComponents`と対応):

- **quest3 / quest2 / pico4** (Touch系): `/input/{a,b}/{click,touch}`(右)、`/input/{x,y}/{click,touch}`(左)、`/input/system/click`、`/input/trigger/{click,touch,value}`、`/input/grip/{value,touch}`、`/input/joystick/{x,y,click,touch}`、`/input/thumbrest/touch`
- **index** (Knuckles): `/input/{a,b,system}/{click,touch}`、`/input/trigger/{click,touch,value}`、`/input/grip/{value,force,touch}`、`/input/thumbstick/{x,y,click,touch}`、`/input/trackpad/{x,y,force,touch}`
- **vive** (ワンド): `/input/{system,application_menu,grip}/click`、`/input/trigger/{click,value}`、`/input/trackpad/{x,y,click,touch}`

HMDは`/proximity`(装着検知)を常時trueで報告する。

### driver_hello (ドライバー → ハブ)

接続時に送信。ハブはこのピアをドライバーとして記録する。

```json
{ "v": 1, "type": "driver_hello", "driver": "vvre", "version": "0.1.0" }
```

### status (ハブ → 全クライアント)

接続/切断時にブロードキャスト。

```json
{ "v": 1, "type": "status", "driverConnected": true, "clients": 2 }
```

### haptic (ドライバー → 全クライアント)

SteamVRアプリからのハプティクスイベントを転送。

```json
{ "v": 1, "type": "haptic", "device": "left", "durationSeconds": 0.1, "frequency": 160.0, "amplitude": 0.8 }
```

### config (予約 — v2)

デバイス構成。トラッカー追加時に使用予定。

```json
{ "v": 1, "type": "config", "profile": "quest3",
  "devices": [ { "id": "hmd", "class": "hmd" },
               { "id": "left", "class": "controller", "role": "left" } ] }
```

`device_add` / `device_remove` / `subscribe` もv2予約。

## 外部クライアント例 (Node.js)

```javascript
const ws = new WebSocket('ws://127.0.0.1:18320');
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({
    v: 1, type: 'pose_batch',
    poses: { hmd: { pos: [0, 1.7, 0], rot: { x: 0, y: 0, z: 0, w: 1 } } },
  }));
});
```
