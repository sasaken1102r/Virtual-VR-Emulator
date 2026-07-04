//! WebSocketハブ。
//! フロントエンド・SteamVRドライバー・(将来の)外部クライアントが全員ここに接続する。
//! 最新状態をキャッシュし、ドライバー再接続時にリプレイすることで状態を失わない。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Map, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

/// 接続中ピアへの送信チャネル
type Tx = UnboundedSender<Message>;

/// ハブの共有状態
pub struct Shared {
    peers: Mutex<HashMap<u64, Tx>>,
    /// デバイスID → 最新ポーズ(JSON)
    poses: Mutex<Map<String, Value>>,
    /// デバイスID → 入力パス → 最新値(マージ済み)
    inputs: Mutex<HashMap<String, Map<String, Value>>>,
    /// 最新のデバイス構成
    config: Mutex<Option<Value>>,
    /// ドライバーとして接続しているピアのID
    driver_peer: Mutex<Option<u64>>,
    next_peer_id: AtomicU64,
}

impl Shared {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            peers: Mutex::new(HashMap::new()),
            poses: Mutex::new(Map::new()),
            inputs: Mutex::new(HashMap::new()),
            config: Mutex::new(None),
            driver_peer: Mutex::new(None),
            next_peer_id: AtomicU64::new(1),
        })
    }

    pub async fn status_json(&self) -> Value {
        json!({
            "v": 1,
            "type": "status",
            "driverConnected": self.driver_peer.lock().await.is_some(),
            "clients": self.peers.lock().await.len(),
        })
    }
}

/// ハブサーバーを起動する(アプリ常駐タスク)
pub async fn run_hub(shared: Arc<Shared>, port: u16) {
    let addr = format!("127.0.0.1:{port}");
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[hub] failed to bind {addr}: {e}");
            return;
        }
    };
    println!("[hub] listening on ws://{addr}");

    while let Ok((stream, _)) = listener.accept().await {
        let shared = shared.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_connection(shared, stream).await {
                eprintln!("[hub] connection error: {e}");
            }
        });
    }
}

/// 1接続分の処理
async fn handle_connection(
    shared: Arc<Shared>,
    stream: TcpStream,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let ws = tokio_tungstenite::accept_async(stream).await?;
    let (mut sink, mut source) = ws.split();

    let peer_id = shared.next_peer_id.fetch_add(1, Ordering::Relaxed);
    let (tx, mut rx) = unbounded_channel::<Message>();
    shared.peers.lock().await.insert(peer_id, tx.clone());

    // 送信タスク: チャネル経由でまとめてソケットに書く
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    // 接続直後: 現在のステータスとキャッシュをリプレイ(ドライバー再接続対策)
    let _ = tx.send(Message::text(shared.status_json().await.to_string()));
    if let Some(config) = shared.config.lock().await.clone() {
        let _ = tx.send(Message::text(config.to_string()));
    }
    {
        let poses = shared.poses.lock().await;
        if !poses.is_empty() {
            let replay = json!({ "v": 1, "type": "pose_batch", "poses": Value::Object(poses.clone()) });
            let _ = tx.send(Message::text(replay.to_string()));
        }
    }
    {
        let inputs = shared.inputs.lock().await;
        for (device, values) in inputs.iter() {
            let replay = json!({ "v": 1, "type": "input", "device": device, "inputs": Value::Object(values.clone()) });
            let _ = tx.send(Message::text(replay.to_string()));
        }
    }

    // 受信ループ
    while let Some(msg) = source.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(_) => break,
        };
        if let Message::Text(text) = msg {
            handle_message(&shared, peer_id, text.as_str()).await;
        }
    }

    // 切断処理
    shared.peers.lock().await.remove(&peer_id);
    {
        let mut driver = shared.driver_peer.lock().await;
        if *driver == Some(peer_id) {
            *driver = None;
        }
    }
    broadcast(&shared, None, &shared.status_json().await.to_string()).await;
    writer.abort();
    Ok(())
}

/// 受信メッセージの処理: キャッシュ更新 + 他ピアへ転送
async fn handle_message(shared: &Arc<Shared>, from: u64, text: &str) {
    let parsed: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return,
    };
    let msg_type = parsed.get("type").and_then(Value::as_str).unwrap_or("");

    match msg_type {
        "driver_hello" => {
            *shared.driver_peer.lock().await = Some(from);
            let status = shared.status_json().await.to_string();
            broadcast(shared, None, &status).await;
        }
        "pose_batch" => {
            if let Some(poses) = parsed.get("poses").and_then(Value::as_object) {
                let mut cache = shared.poses.lock().await;
                for (id, pose) in poses {
                    cache.insert(id.clone(), pose.clone());
                }
            }
            broadcast(shared, Some(from), text).await;
        }
        "input" => {
            if let (Some(device), Some(inputs)) = (
                parsed.get("device").and_then(Value::as_str),
                parsed.get("inputs").and_then(Value::as_object),
            ) {
                let mut cache = shared.inputs.lock().await;
                let entry = cache.entry(device.to_string()).or_default();
                for (path, value) in inputs {
                    entry.insert(path.clone(), value.clone());
                }
            }
            broadcast(shared, Some(from), text).await;
        }
        "config" => {
            *shared.config.lock().await = Some(parsed.clone());
            broadcast(shared, Some(from), text).await;
        }
        // haptic / device_status などはそのまま転送
        _ => {
            broadcast(shared, Some(from), text).await;
        }
    }
}

/// 全ピア(exceptを除く)へ送信
async fn broadcast(shared: &Arc<Shared>, except: Option<u64>, text: &str) {
    let peers = shared.peers.lock().await;
    for (id, tx) in peers.iter() {
        if Some(*id) != except {
            let _ = tx.send(Message::text(text.to_string()));
        }
    }
}
