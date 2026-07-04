//! ドライバーのインストール・登録・SteamVR設定の管理。

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::Manager;

use crate::steamvr;

/// vvreドライバーのインストール先
fn install_target_dir() -> Result<PathBuf, String> {
    let local = std::env::var("LOCALAPPDATA").map_err(|e| e.to_string())?;
    Ok(PathBuf::from(local).join("vvre").join("driver").join("vvre"))
}

/// openvrpaths.vrpath に登録済みのvvreドライバーパスを返す
fn registered_driver_path() -> Option<PathBuf> {
    let text = std::fs::read_to_string(steamvr::openvrpaths_path()?).ok()?;
    let jsonv: Value = serde_json::from_str(&text).ok()?;
    let drivers = jsonv.get("external_drivers")?.as_array()?;
    drivers.iter().find_map(|d| {
        let path = d.as_str()?;
        if path.to_lowercase().ends_with("\\vvre") || path.to_lowercase().ends_with("/vvre") {
            Some(PathBuf::from(path))
        } else {
            None
        }
    })
}

/// steamvr.vrsettings をJSONとして読む
fn read_vrsettings() -> Result<(PathBuf, Value), String> {
    let path = steamvr::vrsettings_path().ok_or("Steamが見つかりません")?;
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok((path, json))
}

/// steamvr.vrsettings をバックアップしてから書き込む
fn write_vrsettings(path: &Path, json: &Value) -> Result<(), String> {
    let backup = path.with_extension(format!(
        "vrsettings.vvre-backup-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    ));
    let _ = std::fs::copy(path, &backup);
    std::fs::write(path, serde_json::to_string_pretty(json).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// セットアップ状態(SetupPanelの表示用)。
/// tasklist等の重い処理を含むため、UIスレッドを塞がないよう別スレッドで実行する
#[tauri::command]
pub async fn get_setup_status() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(get_setup_status_blocking)
        .await
        .map_err(|e| e.to_string())
}

fn get_setup_status_blocking() -> Value {
    let vrsettings = read_vrsettings().ok().map(|(_, j)| j);
    let steamvr_section = vrsettings.as_ref().and_then(|j| j.get("steamvr"));

    json!({
        "steamRunning": steamvr::is_process_running("steam.exe"),
        "steamvrRunning": steamvr::is_process_running("vrserver.exe"),
        "driverRegistered": registered_driver_path().is_some(),
        "driverPath": registered_driver_path().map(|p| p.to_string_lossy().to_string()),
        "requireHmdOk": steamvr_section
            .and_then(|s| s.get("requireHmd"))
            .and_then(Value::as_bool)
            .map(|v| !v)
            .unwrap_or(false),
        "activateMultipleDriversOk": steamvr_section
            .and_then(|s| s.get("activateMultipleDrivers"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        "profile": vrsettings
            .as_ref()
            .and_then(|j| j.get("driver_vvre"))
            .and_then(|s| s.get("profile"))
            .and_then(Value::as_str)
            .unwrap_or("quest3")
            .to_string(),
    })
}

/// ディレクトリを再帰コピーする
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let target = dst.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 同梱ドライバーをコピーしてvrpathregで登録する
#[tauri::command]
pub async fn install_driver(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || install_driver_blocking(app))
        .await
        .map_err(|e| e.to_string())?
}

fn install_driver_blocking(app: tauri::AppHandle) -> Result<String, String> {
    // ビルド版: バンドルリソースから。開発時: リポジトリのdriver/output/vvreから
    let source = app
        .path()
        .resolve("vvre", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|p| p.join("driver.vrdrivermanifest").exists())
        .or_else(|| {
            let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../driver/output/vvre");
            dev.join("driver.vrdrivermanifest").exists().then_some(dev)
        })
        .ok_or("同梱ドライバーが見つかりません(先にdriverをビルドしてね)")?;

    let target = install_target_dir()?;
    copy_dir_recursive(&source, &target)?;

    let runtime = steamvr::steamvr_runtime_path().ok_or("SteamVRが見つかりません")?;
    let vrpathreg = runtime.join("bin").join("win64").join("vrpathreg.exe");
    let output = steamvr::hidden_command(&vrpathreg.to_string_lossy())
        .args(["adddriver", &target.to_string_lossy()])
        .output()
        .map_err(|e| format!("vrpathreg実行失敗: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "vrpathreg失敗: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(target.to_string_lossy().to_string())
}

/// ヘッドレス起動に必要なsteamvr.vrsettingsの設定を適用する(バックアップ付き)
#[tauri::command]
pub async fn apply_vrsettings() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(apply_vrsettings_blocking)
        .await
        .map_err(|e| e.to_string())?
}

fn apply_vrsettings_blocking() -> Result<(), String> {
    if steamvr::is_process_running("vrserver.exe") {
        return Err("SteamVRの実行中は設定を変更できません。先に停止してね".into());
    }

    let (path, mut json) = read_vrsettings()?;
    let steamvr_section = json
        .as_object_mut()
        .ok_or("steamvr.vrsettingsが壊れています")?
        .entry("steamvr")
        .or_insert_with(|| json!({}));

    steamvr_section["requireHmd"] = json!(false);
    steamvr_section["activateMultipleDrivers"] = json!(true);

    write_vrsettings(&path, &json)
}

/// デバイスプロファイルを切り替える(steamvr.vrsettingsのdriver_vvreセクション)
#[tauri::command]
pub async fn set_profile(profile: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set_profile_blocking(profile))
        .await
        .map_err(|e| e.to_string())?
}

fn set_profile_blocking(profile: String) -> Result<(), String> {
    if !["quest3", "quest2", "pico4", "index", "vive"].contains(&profile.as_str()) {
        return Err(format!("不明なプロファイル: {profile}"));
    }

    let (path, mut json) = read_vrsettings()?;
    let section = json
        .as_object_mut()
        .ok_or("steamvr.vrsettingsが壊れています")?
        .entry("driver_vvre")
        .or_insert_with(|| json!({}));

    section["profile"] = json!(profile);

    write_vrsettings(&path, &json)
}

/// vvreドライバーが確実に使われる状態を保証する(起動/再起動ボタンから呼ばれる)。
/// 未登録ならエラー、設定がズレている時だけsteamvr.vrsettingsを修正する
fn ensure_vvre_ready() -> Result<(), String> {
    if registered_driver_path().is_none() {
        return Err("vvreドライバーが未登録です。セットアップタブの「ドライバーをインストール」を先に実行してね".into());
    }

    let (path, mut json) = read_vrsettings()?;
    let mut changed = false;

    let obj = json
        .as_object_mut()
        .ok_or("steamvr.vrsettingsが壊れています")?;

    let steamvr_section = obj.entry("steamvr").or_insert_with(|| json!({}));
    for (key, desired) in [("requireHmd", false), ("activateMultipleDrivers", true)] {
        if steamvr_section.get(key).and_then(Value::as_bool) != Some(desired) {
            steamvr_section[key] = json!(desired);
            changed = true;
        }
    }

    // 実機用に無効化されていてもエミュレータ起動時は有効へ戻す
    let vvre_section = obj.entry("driver_vvre").or_insert_with(|| json!({}));
    if vvre_section.get("enable").and_then(Value::as_bool) != Some(true) {
        vvre_section["enable"] = json!(true);
        changed = true;
    }

    if changed {
        write_vrsettings(&path, &json)?;
    }
    Ok(())
}

/// SteamVRを再起動する(プロファイル反映用)
#[tauri::command]
pub async fn restart_steamvr() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        steamvr::stop_steamvr();
        ensure_vvre_ready()?;
        steamvr::start_steamvr()
    })
    .await
    .map_err(|e| e.to_string())?
}

/// SteamVRを起動する(vvreが使われる状態を保証してから)
#[tauri::command]
pub async fn start_steamvr() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        ensure_vvre_ready()?;
        steamvr::start_steamvr()
    })
    .await
    .map_err(|e| e.to_string())?
}

/// SteamVRを停止する
#[tauri::command]
pub async fn stop_steamvr() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        steamvr::stop_steamvr();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
