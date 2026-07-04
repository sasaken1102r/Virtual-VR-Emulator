#include "ws_client.h"

#include <nlohmann/json.hpp>

#include <ixwebsocket/IXNetSystem.h>

#include "driverlog.h"
#include "shared_state.h"

using nlohmann::json;

WsClient::WsClient( std::string url, SharedState *state )
	: state_( state )
{
	// Windows では WinSock の初期化が必要
	ix::initNetSystem();

	websocket_.setUrl( url );
	websocket_.setPingInterval( 2 );
	// 自動再接続はデフォルト有効(指数バックオフ)。上限だけ短めにして復帰を早くする
	websocket_.setMaxWaitBetweenReconnectionRetries( 3000 );

	websocket_.setOnMessageCallback( [ this ]( const ix::WebSocketMessagePtr &msg ) { OnMessage( msg ); } );
}

WsClient::~WsClient()
{
	Stop();
	ix::uninitNetSystem();
}

void WsClient::Start()
{
	// 非同期接続。vrserver の起動をブロックしない
	websocket_.start();
}

void WsClient::Stop()
{
	websocket_.stop();
}

void WsClient::Send( const std::string &text )
{
	if ( connected_ )
	{
		websocket_.sendText( text );
	}
}

bool WsClient::IsConnected() const
{
	return connected_;
}

void WsClient::OnMessage( const ix::WebSocketMessagePtr &msg )
{
	switch ( msg->type )
	{
		case ix::WebSocketMessageType::Open:
		{
			connected_ = true;
			state_->SetHubConnected( true );
			DriverLog( "[vvre] websocket connected" );
			websocket_.sendText( R"({"v":1,"type":"driver_hello","driver":"vvre","version":"0.1.0"})" );
			break;
		}
		case ix::WebSocketMessageType::Close:
		{
			connected_ = false;
			state_->SetHubConnected( false );
			DriverLog( "[vvre] websocket disconnected" );
			break;
		}
		case ix::WebSocketMessageType::Message:
		{
			HandleTextMessage( msg->str );
			break;
		}
		default:
			break;
	}
}

void WsClient::HandleTextMessage( const std::string &text )
{
	const json j = json::parse( text, nullptr, false );
	if ( j.is_discarded() || !j.is_object() )
		return;

	const std::string type = j.value( "type", "" );

	if ( type == "pose_batch" )
	{
		const auto poses = j.find( "poses" );
		if ( poses == j.end() || !poses->is_object() )
			return;

		for ( const auto &[ id, p ] : poses->items() )
		{
			if ( !p.is_object() )
				continue;

			DevicePoseState pose{};
			pose.has_data = true;

			if ( const auto pos = p.find( "pos" ); pos != p.end() && pos->is_array() && pos->size() == 3 )
			{
				pose.position[ 0 ] = ( *pos )[ 0 ].get< double >();
				pose.position[ 1 ] = ( *pos )[ 1 ].get< double >();
				pose.position[ 2 ] = ( *pos )[ 2 ].get< double >();
			}

			if ( const auto rot = p.find( "rot" ); rot != p.end() && rot->is_object() )
			{
				pose.rotation[ 0 ] = rot->value( "w", 1.0 );
				pose.rotation[ 1 ] = rot->value( "x", 0.0 );
				pose.rotation[ 2 ] = rot->value( "y", 0.0 );
				pose.rotation[ 3 ] = rot->value( "z", 0.0 );
			}

			if ( const auto vel = p.find( "vel" ); vel != p.end() && vel->is_array() && vel->size() == 3 )
			{
				pose.velocity[ 0 ] = ( *vel )[ 0 ].get< double >();
				pose.velocity[ 1 ] = ( *vel )[ 1 ].get< double >();
				pose.velocity[ 2 ] = ( *vel )[ 2 ].get< double >();
			}

			if ( const auto ang = p.find( "angVel" ); ang != p.end() && ang->is_array() && ang->size() == 3 )
			{
				pose.angular_velocity[ 0 ] = ( *ang )[ 0 ].get< double >();
				pose.angular_velocity[ 1 ] = ( *ang )[ 1 ].get< double >();
				pose.angular_velocity[ 2 ] = ( *ang )[ 2 ].get< double >();
			}

			pose.connected = p.value( "connected", true );

			state_->SetPose( id, pose );
		}
	}
	else if ( type == "input" )
	{
		const std::string device = j.value( "device", "" );
		const auto inputs = j.find( "inputs" );
		if ( device.empty() || inputs == j.end() || !inputs->is_object() )
			return;

		for ( const auto &[ path, value ] : inputs->items() )
		{
			InputUpdate update{};
			update.device_id = device;
			update.path = path;

			if ( value.is_boolean() )
			{
				update.is_scalar = false;
				update.bool_value = value.get< bool >();
			}
			else if ( value.is_number() )
			{
				update.is_scalar = true;
				update.scalar_value = value.get< float >();
			}
			else
			{
				continue;
			}

			state_->QueueInput( std::move( update ) );
		}
	}
}
