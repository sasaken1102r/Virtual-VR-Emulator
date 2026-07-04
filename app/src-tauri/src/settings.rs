//! アプリ設定の保存/読込 (%APPDATA%\vvre\settings.json)。

use std::path::PathBuf;

/// 設定ファイルのパス(ディレクトリがなければ作成)
fn settings_path() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    let dir = PathBuf::from(appdata).join("vvre");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// 設定を読み込む(未保存ならnullを返す)
#[tauri::command]
pub fn load_settings() -> Result<serde_json::Value, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(serde_json::Value::Null);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// 設定を保存する
#[tauri::command]
pub fn save_settings(settings: serde_json::Value) -> Result<(), String> {
    let path = settings_path()?;
    std::fs::write(&path, serde_json::to_string_pretty(&settings).unwrap())
        .map_err(|e| e.to_string())
}
