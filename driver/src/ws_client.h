#pragma once

#include <atomic>
#include <string>

#include <ixwebsocket/IXWebSocket.h>

class SharedState;

// ハブ(Tauriアプリ)へのWebSocket接続。自動再接続はIXWebSocketに任せる。
class WsClient
{
public:
	WsClient( std::string url, SharedState *state );
	~WsClient();

	void Start();
	void Stop();
	void Send( const std::string &text );
	bool IsConnected() const;

private:
	void OnMessage( const ix::WebSocketMessagePtr &msg );
	void HandleTextMessage( const std::string &text );

	ix::WebSocket websocket_;
	SharedState *state_;
	std::atomic< bool > connected_{ false };
};
