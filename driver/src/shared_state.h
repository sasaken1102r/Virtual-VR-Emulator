#pragma once

#include <atomic>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

// アプリから受信した最新のデバイスポーズ
struct DevicePoseState
{
	double position[ 3 ] = { 0.0, 0.0, 0.0 };
	double rotation[ 4 ] = { 1.0, 0.0, 0.0, 0.0 }; // w, x, y, z
	double velocity[ 3 ] = { 0.0, 0.0, 0.0 };
	double angular_velocity[ 3 ] = { 0.0, 0.0, 0.0 };
	bool connected = true;
	bool has_data = false;
};

// アプリから受信した入力(ボタン/軸)の更新1件分
struct InputUpdate
{
	std::string device_id;
	std::string path; // 例: "/input/trigger/value"
	bool is_scalar = false;
	bool bool_value = false;
	float scalar_value = 0.f;
};

// WebSocketスレッドが書き、ポーズスレッド/RunFrameが読む共有状態。
// OpenVR APIはここからは一切呼ばない。
class SharedState
{
public:
	// ハブ(アプリ)と接続中か。切断中はデバイスを「未接続」として報告する
	void SetHubConnected( bool connected )
	{
		hub_connected_ = connected;
	}

	bool IsHubConnected() const
	{
		return hub_connected_;
	}

	void SetPose( const std::string &id, const DevicePoseState &pose )
	{
		std::lock_guard< std::mutex > lock( mutex_ );
		poses_[ id ] = pose;
	}

	bool GetPose( const std::string &id, DevicePoseState *out ) const
	{
		std::lock_guard< std::mutex > lock( mutex_ );
		const auto it = poses_.find( id );
		if ( it == poses_.end() || !it->second.has_data )
			return false;
		*out = it->second;
		return true;
	}

	void QueueInput( InputUpdate update )
	{
		std::lock_guard< std::mutex > lock( mutex_ );
		input_queue_.push_back( std::move( update ) );
	}

	std::vector< InputUpdate > DrainInputs()
	{
		std::lock_guard< std::mutex > lock( mutex_ );
		std::vector< InputUpdate > drained;
		drained.swap( input_queue_ );
		return drained;
	}

private:
	std::atomic< bool > hub_connected_{ false };
	mutable std::mutex mutex_;
	std::unordered_map< std::string, DevicePoseState > poses_;
	std::vector< InputUpdate > input_queue_;
};
