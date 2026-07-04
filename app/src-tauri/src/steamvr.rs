//! Steam / SteamVR の検出・プロセス管理。

use std::path::PathBuf;
use std::process::Command;

/// コンソール窓を出さずに外部コマンドを作る (CREATE_NO_WINDOW)
pub fn hidden_command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// Steamのインストールパスをレジストリから取得する
pub fn steam_path() -> Option<PathBuf> {
    let output = hidden_command("reg")
        .args([
            "query",
            r"HKCU\Software\Valve\Steam",
            "/v",
            "SteamPath",
        ])
        .output()
        .ok()?;

    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().find(|l| l.contains("SteamPath"))?;
    let value = line.split("REG_SZ").nth(1)?.trim();
    if value.is_empty() {
        return None;
    }
    Some(PathBuf::from(value.replace('/', "\\")))
}

/// steamvr.vrsettings のパス
pub fn vrsettings_path() -> Option<PathBuf> {
    Some(steam_path()?.join("config").join("steamvr.vrsettings"))
}

/// openvrpaths.vrpath のパス
pub fn openvrpaths_path() -> Option<PathBuf> {
    let local = std::env::var("LOCALAPPDATA").ok()?;
    Some(PathBuf::from(local).join("openvr").join("openvrpaths.vrpath"))
}

/// SteamVRランタイムのパス (openvrpaths.vrpath の runtime[0])
pub fn steamvr_runtime_path() -> Option<PathBuf> {
    let text = std::fs::read_to_string(openvrpaths_path()?).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    let runtime = json.get("runtime")?.as_array()?.first()?.as_str()?;
    Some(PathBuf::from(runtime))
}

/// 指定した実行ファイル名のプロセスが動いているか
pub fn is_process_running(name: &str) -> bool {
    let Ok(output) = hidden_command("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {name}"), "/NH"])
        .output()
    else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout).contains(name)
}

/// SteamVR関連プロセスをすべて停止する
pub fn stop_steamvr() {
    // vrmonitorがvrserverを再起動することがあるため、複数回に分けて全部止める
    for _ in 0..3 {
        for name in [
            "vrmonitor.exe",
            "vrdashboard.exe",
            "vrserver.exe",
            "vrcompositor.exe",
            "vrwebhelper.exe",
            "vrstartup.exe",
        ] {
            let _ = hidden_command("taskkill").args(["/IM", name, "/F"]).output();
        }
        std::thread::sleep(std::time::Duration::from_millis(1500));
    }
}

/// SteamVRを起動する
pub fn start_steamvr() -> Result<(), String> {
    let runtime = steamvr_runtime_path().ok_or("SteamVRランタイムが見つかりません")?;
    let vrstartup = runtime.join("bin").join("win64").join("vrstartup.exe");
    Command::new(vrstartup)
        .spawn()
        .map_err(|e| format!("vrstartup起動失敗: {e}"))?;
    Ok(())
}

/// vrcompositorの「Headset Window」(仮想HMDのデバッグ表示、デスクトップ全面に出る)を
/// 自動で最小化する常駐ウォッチャー。VRビュー(ミラー)には影響しない
pub fn spawn_headset_window_minimizer() {
    std::thread::spawn(|| loop {
        minimize_headset_window();
        std::thread::sleep(std::time::Duration::from_secs(3));
    });
}

#[cfg(windows)]
fn minimize_headset_window() {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, IsIconic, IsWindowVisible, ShowWindow, SW_MINIMIZE,
    };

    unsafe extern "system" fn callback(hwnd: HWND, _lparam: LPARAM) -> BOOL {
        let mut buf = [0u16; 64];
        let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        let class_name = String::from_utf16_lossy(&buf[..len.max(0) as usize]);

        if class_name == "Headset Window"
            && unsafe { IsWindowVisible(hwnd) } != 0
            && unsafe { IsIconic(hwnd) } == 0
        {
            unsafe { ShowWindow(hwnd, SW_MINIMIZE) };
        }
        1
    }

    unsafe {
        EnumWindows(Some(callback), 0);
    }
}

#[cfg(not(windows))]
fn minimize_headset_window() {}
