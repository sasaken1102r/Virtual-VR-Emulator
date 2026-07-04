mod hub;
mod installer;
mod presets;
mod settings;
mod steamvr;

use std::sync::Arc;

/// ハブの現在状態を返す(フロントの接続インジケータ用)
#[tauri::command]
async fn get_hub_status(state: tauri::State<'_, Arc<hub::Shared>>) -> Result<serde_json::Value, String> {
    Ok(state.status_json().await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared = hub::Shared::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(shared.clone())
        .setup(move |_app| {
            // WebSocketハブをバックグラウンドで常駐させる
            tauri::async_runtime::spawn(hub::run_hub(shared, 18320));
            // 仮想HMDのHeadset Window(デスクトップ全面のデバッグ表示)を自動最小化
            steamvr::spawn_headset_window_minimizer();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_hub_status,
            presets::list_presets,
            presets::save_preset,
            presets::load_preset,
            presets::delete_preset,
            installer::get_setup_status,
            installer::install_driver,
            installer::apply_vrsettings,
            installer::set_profile,
            installer::restart_steamvr,
            installer::start_steamvr,
            installer::stop_steamvr,
            settings::load_settings,
            settings::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
