#include "device_provider.h"

#include <chrono>
#include <thread>

#include "driverlog.h"

static const char *k_settings_section = "driver_vvre";

vr::EVRInitError VvreDeviceProvider::Init( vr::IVRDriverContext *pDriverContext )
{
	VR_INIT_SERVER_DRIVER_CONTEXT( pDriverContext );

	DriverLog( "[vvre] driver init" );

	state_ = std::make_unique< SharedState >();

	char websocket_url[ 1024 ];
	vr::VRSettings()->GetString( k_settings_section, "websocket_url", websocket_url, sizeof( websocket_url ) );
	ws_client_ = std::make_unique< WsClient >( websocket_url, state_.get() );
	ws_client_->Start();

	// アプリ(ハブ)が起動している時だけデバイスを名乗る。
	// 通常ケースはここで即接続できるので最大1秒だけ待ち、
	// 繋がらなければ登録せずRunFrameでの動的追加に任せる
	for ( int i = 0; i < 50 && !ws_client_->IsConnected(); ++i )
	{
		std::this_thread::sleep_for( std::chrono::milliseconds( 20 ) );
	}

	if ( ws_client_->IsConnected() )
	{
		AddAllDevices();
	}
	else
	{
		DriverLog( "[vvre] hub not connected; devices will be added when the app connects" );
	}

	return vr::VRInitError_None;
}

void VvreDeviceProvider::AddAllDevices()
{
	if ( devices_added_ )
	{
		return;
	}
	devices_added_ = true;

	const auto send = [ this ]( const std::string &text ) { ws_client_->Send( text ); };

	AddDevice( std::make_unique< VvreDevice >( "hmd", vr::TrackedDeviceClass_HMD, vr::TrackedControllerRole_Invalid, state_.get(), send ),
		vr::TrackedDeviceClass_HMD );
	AddDevice( std::make_unique< VvreDevice >( "left", vr::TrackedDeviceClass_Controller, vr::TrackedControllerRole_LeftHand, state_.get(), send ),
		vr::TrackedDeviceClass_Controller );
	AddDevice( std::make_unique< VvreDevice >( "right", vr::TrackedDeviceClass_Controller, vr::TrackedControllerRole_RightHand, state_.get(), send ),
		vr::TrackedDeviceClass_Controller );
}

bool VvreDeviceProvider::AddDevice( std::unique_ptr< VvreDevice > device, vr::ETrackedDeviceClass deviceClass )
{
	if ( !vr::VRServerDriverHost()->TrackedDeviceAdded( device->GetSerialNumber().c_str(), deviceClass, device.get() ) )
	{
		DriverLog( "[vvre] failed to add device: id=%s", device->GetId().c_str() );
		return false;
	}

	devices_.push_back( std::move( device ) );
	return true;
}

const char *const *VvreDeviceProvider::GetInterfaceVersions()
{
	return vr::k_InterfaceVersions;
}

bool VvreDeviceProvider::ShouldBlockStandbyMode()
{
	return false;
}

void VvreDeviceProvider::RunFrame()
{
	// SteamVR起動後にアプリが立ち上がった場合はここで動的にデバイスを追加する
	if ( !devices_added_ && ws_client_ && ws_client_->IsConnected() )
	{
		DriverLog( "[vvre] hub connected; adding devices now" );
		AddAllDevices();
	}

	// アプリから届いた入力更新をこのフレームで反映する
	// (OpenVR APIはソケットスレッドからではなくここから呼ぶ)
	if ( state_ )
	{
		for ( const auto &update : state_->DrainInputs() )
		{
			for ( auto &device : devices_ )
			{
				if ( device->GetId() == update.device_id )
				{
					device->ApplyInput( update );
					break;
				}
			}
		}
	}

	vr::VREvent_t vrevent{};
	while ( vr::VRServerDriverHost()->PollNextEvent( &vrevent, sizeof( vr::VREvent_t ) ) )
	{
		for ( auto &device : devices_ )
		{
			device->ProcessEvent( vrevent );
		}
	}
}

void VvreDeviceProvider::EnterStandby()
{
}

void VvreDeviceProvider::LeaveStandby()
{
}

void VvreDeviceProvider::Cleanup()
{
	if ( ws_client_ )
	{
		ws_client_->Stop();
	}

	devices_.clear();
	ws_client_ = nullptr;
	state_ = nullptr;
}
