# サードパーティライセンス表記 / Third-Party Notices

本プロジェクトは以下のサードパーティ製ソフトウェア・アセットを含む、または利用しています。

## 同梱(vendor)しているもの

### OpenVR SDK (openvr_driver.h, vrmath.h, driverlog)
- Copyright (c) Valve Corporation
- License: **BSD-3-Clause**
- https://github.com/ValveSoftware/openvr
- `driver/vendor/openvr/` および `driver/src/driverlog.*`(公式ドライバーサンプル由来)

### nlohmann/json (json.hpp)
- Copyright (c) 2013-2025 Niels Lohmann
- License: **MIT**
- https://github.com/nlohmann/json
- `driver/vendor/nlohmann/json.hpp`

### Noto Sans / Noto Sans JP / Noto Sans SC / Noto Sans KR
- Copyright Google LLC
- License: **SIL Open Font License 1.1**
- https://fonts.google.com/noto
- `@fontsource/noto-sans*` 経由でアプリに同梱

### SteamVR入力バインディング定義の派生物
- `driver/vvre/resources/input/legacy_bindings_pico4_controller.json` は
  SteamVR同梱の `legacy_bindings_touch.json` (Valve Corporation) を元に
  controller_type等を変更した派生ファイルです

## ビルド時に取得されるもの

### IXWebSocket
- Copyright (c) Machine Zone, Inc.
- License: **BSD-3-Clause**
- https://github.com/machinezone/IXWebSocket
- CMake FetchContentでビルド時に取得

## パッケージ依存

- npm依存 (React, three.js, @react-three/*, zustand, i18next ほか): 各パッケージのライセンス(主にMIT)に従います。詳細は `app/package.json` と各パッケージを参照
- Cargo依存 (Tauri, tokio, tokio-tungstenite ほか): 主にMIT / Apache-2.0。詳細は `app/src-tauri/Cargo.toml` と各クレートを参照

## 商標について

"Meta Quest", "PICO", "Valve Index", "HTC Vive", "SteamVR" は各社の商標です。
本プロジェクトはこれらの企業とは無関係の非公式ツールで、デバイス名はエミュレーション対象の識別のためにのみ使用しています。
