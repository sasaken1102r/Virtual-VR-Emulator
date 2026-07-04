//! ポーズプリセットの保存/読込 (%APPDATA%\vvre\presets\*.json)。

use std::path::PathBuf;

/// プリセット保存ディレクトリ(なければ作成)
fn presets_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    let dir = PathBuf::from(appdata).join("vvre").join("presets");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// ファイル名に使えない文字を除去する
fn sanitize_name(name: &str) -> String {
    name.chars()
        .filter(|c| !r#"\/:*?"<>|"#.contains(*c))
        .collect::<String>()
        .trim()
        .to_string()
}

/// 保存済みプリセット名の一覧
#[tauri::command]
pub fn list_presets() -> Result<Vec<String>, String> {
    let dir = presets_dir()?;
    let mut names = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                names.push(stem.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

/// プリセットを保存する
#[tauri::command]
pub fn save_preset(name: String, poses: serde_json::Value) -> Result<(), String> {
    let name = sanitize_name(&name);
    if name.is_empty() {
        return Err("プリセット名が空です".into());
    }
    let path = presets_dir()?.join(format!("{name}.json"));
    let body = serde_json::json!({ "name": name, "poses": poses });
    std::fs::write(&path, serde_json::to_string_pretty(&body).unwrap()).map_err(|e| e.to_string())
}

/// プリセットを読み込む(posesオブジェクトを返す)
#[tauri::command]
pub fn load_preset(name: String) -> Result<serde_json::Value, String> {
    let name = sanitize_name(&name);
    let path = presets_dir()?.join(format!("{name}.json"));
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    json.get("poses")
        .cloned()
        .ok_or_else(|| "posesが含まれていません".into())
}

/// プリセットを削除する
#[tauri::command]
pub fn delete_preset(name: String) -> Result<(), String> {
    let name = sanitize_name(&name);
    let path = presets_dir()?.join(format!("{name}.json"));
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}
