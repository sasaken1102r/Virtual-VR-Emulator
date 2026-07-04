#include "vvre_device.h"

#include <nlohmann/json.hpp>

#include "driverlog.h"

static const char *k_settings_section = "driver_vvre";
static const char *k_display_settings_section = "vvre_display";

// コントローラーの入力コンポーネント構成
enum class ControllerLayout
{
	TouchLike, // oculus_touch / pico_controller (ジョイスティック + A/B・X/Y)
	Knuckles,  // Valve Index (サムスティック + トラックパッド + グリップ感圧)
	ViveWand,  // Viveワンド (トラックパッド + アプリケーションメニュー)
};

// エミュレートするデバイスのプロパティ一式。
// quest系/index/viveはSteamVR同梱の各ドライバーのリソース(入力プロファイル・レンダーモデル)を参照する。
// pico4はSteamVRにリソースがないため自前の入力プロファイルを使う(ベストエフォート)
struct DeviceProfile
{
	const char *name;
	const char *hmd_manufacturer;
	const char *hmd_model;
	const char *tracking_system;
	const char *ctrl_manufacturer;
	const char *ctrl_model_left;
	const char *ctrl_model_right;
	const char *ctrl_render_left;
	const char *ctrl_render_right;
	const char *ctrl_type;
	const char *ctrl_input_profile;
	const char *registered_prefix;
	ControllerLayout layout;
	int32_t render_width;  // 片目のレンダー解像度
	int32_t render_height;
	float display_frequency;
};

static const DeviceProfile k_profiles[] = {
	{ "quest3", "Oculus", "Meta Quest 3", "oculus", "Meta",
		"Meta Quest 3 (Left Controller)", "Meta Quest 3 (Right Controller)",
		"oculus_quest_plus_controller_left", "oculus_quest_plus_controller_right",
		"oculus_touch", "{oculus}/input/touch_profile.json", "oculus",
		ControllerLayout::TouchLike, 2064, 2208, 90.f },
	{ "quest2", "Oculus", "Meta Quest 2", "oculus", "Meta",
		"Meta Quest 2 (Left Controller)", "Meta Quest 2 (Right Controller)",
		"oculus_quest2_controller_left", "oculus_quest2_controller_right",
		"oculus_touch", "{oculus}/input/touch_profile.json", "oculus",
		ControllerLayout::TouchLike, 1832, 1920, 90.f },
	{ "pico4", "PICO", "PICO 4", "pico", "PICO",
		"PICO 4 (Left Controller)", "PICO 4 (Right Controller)",
		"generic_controller", "generic_controller",
		"pico_controller", "{vvre}/input/pico4_controller_profile.json", "pico",
		ControllerLayout::TouchLike, 2160, 2160, 90.f },
	{ "index", "Valve", "Index", "lighthouse", "Valve",
		"Knuckles Left", "Knuckles Right",
		"valve_controller_knu_1_0_left", "valve_controller_knu_1_0_right",
		"knuckles", "{indexcontroller}/input/index_controller_profile.json", "valve",
		ControllerLayout::Knuckles, 1440, 1600, 120.f },
	{ "vive", "HTC", "Vive MV", "lighthouse", "HTC",
		"Vive Controller MV", "Vive Controller MV",
		"vr_controller_vive_1_5", "vr_controller_vive_1_5",
		"vive_controller", "{htc}/input/vive_controller_profile.json", "htc",
		ControllerLayout::ViveWand, 1080, 1200, 90.f },
};

// 設定の "profile" キーからアクティブなプロファイルを引く(不明値はquest3)
static const DeviceProfile &GetActiveProfile()
{
	char profile_name[ 64 ] = { 0 };
	vr::VRSettings()->GetString( k_settings_section, "profile", profile_name, sizeof( profile_name ) );

	for ( const auto &profile : k_profiles )
	{
		if ( strcmp( profile.name, profile_name ) == 0 )
		{
			return profile;
		}
	}
	return k_profiles[ 0 ];
}

VvreDevice::VvreDevice( std::string id, vr::ETrackedDeviceClass deviceClass, vr::ETrackedControllerRole role,
	SharedState *state, SendFn send )
	: id_( std::move( id ) )
	, device_class_( deviceClass )
	, role_( role )
	, state_( state )
	, send_( std::move( send ) )
{
	// シリアル番号は設定ファイルの "serial_<id>" キーから取得する
	const std::string serial_key = "serial_" + id_;
	char serial_number[ 1024 ];
	vr::VRSettings()->GetString( k_settings_section, serial_key.c_str(), serial_number, sizeof( serial_number ) );
	serial_number_ = serial_number;

	const DeviceProfile &profile = GetActiveProfile();

	if ( device_class_ == vr::TrackedDeviceClass_HMD )
	{
		model_number_ = profile.hmd_model;

		DisplayConfiguration display_configuration{};
		display_configuration.window_x = vr::VRSettings()->GetInt32( k_display_settings_section, "window_x" );
		display_configuration.window_y = vr::VRSettings()->GetInt32( k_display_settings_section, "window_y" );
		display_configuration.window_width = vr::VRSettings()->GetInt32( k_display_settings_section, "window_width" );
		display_configuration.window_height = vr::VRSettings()->GetInt32( k_display_settings_section, "window_height" );
		// レンダー解像度はエミュレート対象デバイスの実機相当値を使う
		display_configuration.render_width = profile.render_width;
		display_configuration.render_height = profile.render_height;

		display_component_ = std::make_unique< VvreDisplayComponent >( display_configuration );
	}
	else
	{
		model_number_ = role_ == vr::TrackedControllerRole_LeftHand ? profile.ctrl_model_left : profile.ctrl_model_right;
	}

	DriverLog( "[vvre] device created: id=%s serial=%s profile=%s", id_.c_str(), serial_number_.c_str(), profile.name );
}

vr::EVRInitError VvreDevice::Activate( uint32_t unObjectId )
{
	device_index_ = unObjectId;
	is_active_ = true;

	vr::PropertyContainerHandle_t container = vr::VRProperties()->TrackedDeviceToPropertyContainer( device_index_ );

	vr::VRProperties()->SetStringProperty( container, vr::Prop_ModelNumber_String, model_number_.c_str() );

	if ( device_class_ == vr::TrackedDeviceClass_HMD )
	{
		SetupHmdProperties( container );

		// 常時「装着中」を報告してアイドル→スタンバイ落ちを防ぐ
		vr::VRInputComponentHandle_t proximity = vr::k_ulInvalidInputComponentHandle;
		vr::VRDriverInput()->CreateBooleanComponent( container, "/proximity", &proximity );
		vr::VRDriverInput()->UpdateBooleanComponent( proximity, true, 0 );
		bool_components_[ "/proximity" ] = proximity;
	}
	else if ( device_class_ == vr::TrackedDeviceClass_Controller )
	{
		SetupControllerProperties( container );
		CreateInputComponents( container );
	}

	pose_update_thread_ = std::thread( &VvreDevice::PoseUpdateThread, this );

	DriverLog( "[vvre] device activated: id=%s index=%u", id_.c_str(), unObjectId );
	return vr::VRInitError_None;
}

void VvreDevice::SetupHmdProperties( vr::PropertyContainerHandle_t container )
{
	const DeviceProfile &profile = GetActiveProfile();

	vr::VRProperties()->SetStringProperty( container, vr::Prop_ManufacturerName_String, profile.hmd_manufacturer );
	vr::VRProperties()->SetStringProperty( container, vr::Prop_TrackingSystemName_String, profile.tracking_system );
	vr::VRProperties()->SetStringProperty( container, vr::Prop_RenderModelName_String, "generic_hmd" );

	// IPD は SteamVR のユーザー設定を引き継ぐ
	const float ipd = vr::VRSettings()->GetFloat( vr::k_pch_SteamVR_Section, vr::k_pch_SteamVR_IPD_Float );
	vr::VRProperties()->SetFloatProperty( container, vr::Prop_UserIpdMeters_Float, ipd );

	// リフレッシュレートを設定しないと VRCompositor が起動に失敗する
	vr::VRProperties()->SetFloatProperty( container, vr::Prop_DisplayFrequency_Float, profile.display_frequency );

	// 近接センサーを持っていて常に「装着中」と報告する。
	// これがないと動きのない仮想デバイスはすぐアイドル→スタンバイに落ちる
	vr::VRProperties()->SetBoolProperty( container, vr::Prop_ContainsProximitySensor_Bool, true );

	vr::VRProperties()->SetFloatProperty( container, vr::Prop_UserHeadToEyeDepthMeters_Float, 0.f );

	const float vsync_to_photons = vr::VRSettings()->GetFloat( k_display_settings_section, "vsync_to_photons" );
	vr::VRProperties()->SetFloatProperty( container, vr::Prop_SecondsFromVsyncToPhotons_Float, vsync_to_photons );

	// vrmonitor の「フルスクリーンではありません」警告を抑止
	vr::VRProperties()->SetBoolProperty( container, vr::Prop_IsOnDesktop_Bool, false );
	vr::VRProperties()->SetBoolProperty( container, vr::Prop_DisplayDebugMode_Bool, true );

	// ルームセットアップのユニバースIDを固定(未設定だとシャペロン情報が保存されない)
	vr::VRProperties()->SetUint64Property( container, vr::Prop_CurrentUniverseId_Uint64, 2 );

	vr::VRProperties()->SetStringProperty( container, vr::Prop_InputProfilePath_String, "{vvre}/input/vvre_hmd_profile.json" );
}

void VvreDevice::SetupControllerProperties( vr::PropertyContainerHandle_t container )
{
	const bool is_left = role_ == vr::TrackedControllerRole_LeftHand;
	const DeviceProfile &profile = GetActiveProfile();

	vr::VRProperties()->SetStringProperty( container, vr::Prop_TrackingSystemName_String, profile.tracking_system );
	vr::VRProperties()->SetStringProperty( container, vr::Prop_ManufacturerName_String, profile.ctrl_manufacturer );
	vr::VRProperties()->SetStringProperty( container, vr::Prop_RenderModelName_String,
		is_left ? profile.ctrl_render_left : profile.ctrl_render_right );
	vr::VRProperties()->SetStringProperty( container, vr::Prop_ControllerType_String, profile.ctrl_type );
	vr::VRProperties()->SetStringProperty( container, vr::Prop_InputProfilePath_String, profile.ctrl_input_profile );

	const std::string registered_type = std::string( profile.registered_prefix ) + "/" + serial_number_ + ( is_left ? "_Controller_Left" : "_Controller_Right" );
	vr::VRProperties()->SetStringProperty( container, vr::Prop_RegisteredDeviceType_String, registered_type.c_str() );

	vr::VRProperties()->SetInt32Property( container, vr::Prop_ControllerRoleHint_Int32, role_ );

	// バッテリー表示(ダッシュボードで確認できるダミー値)
	vr::VRProperties()->SetBoolProperty( container, vr::Prop_DeviceProvidesBatteryStatus_Bool, true );
	vr::VRProperties()->SetFloatProperty( container, vr::Prop_DeviceBatteryPercentage_Float, 1.f );
}

void VvreDevice::CreateInputComponents( vr::PropertyContainerHandle_t container )
{
	const bool is_left = role_ == vr::TrackedControllerRole_LeftHand;
	const DeviceProfile &profile = GetActiveProfile();

	auto create_bool = [ & ]( const std::string &path ) {
		vr::VRInputComponentHandle_t handle = vr::k_ulInvalidInputComponentHandle;
		vr::VRDriverInput()->CreateBooleanComponent( container, path.c_str(), &handle );
		bool_components_[ path ] = handle;
	};

	auto create_scalar = [ & ]( const std::string &path, vr::EVRScalarUnits units ) {
		vr::VRInputComponentHandle_t handle = vr::k_ulInvalidInputComponentHandle;
		vr::VRDriverInput()->CreateScalarComponent( container, path.c_str(), &handle, vr::VRScalarType_Absolute, units );
		scalar_components_[ path ] = handle;
	};

	// 各プロファイルの入力プロファイルJSON (input_source) と一致させる
	switch ( profile.layout )
	{
		case ControllerLayout::TouchLike:
		{
			const char *primary = is_left ? "x" : "a";
			const char *secondary = is_left ? "y" : "b";

			create_bool( std::string( "/input/" ) + primary + "/click" );
			create_bool( std::string( "/input/" ) + primary + "/touch" );
			create_bool( std::string( "/input/" ) + secondary + "/click" );
			create_bool( std::string( "/input/" ) + secondary + "/touch" );

			create_bool( "/input/system/click" );

			create_bool( "/input/trigger/click" );
			create_bool( "/input/trigger/touch" );
			create_scalar( "/input/trigger/value", vr::VRScalarUnits_NormalizedOneSided );

			create_scalar( "/input/grip/value", vr::VRScalarUnits_NormalizedOneSided );
			create_bool( "/input/grip/touch" );

			create_scalar( "/input/joystick/x", vr::VRScalarUnits_NormalizedTwoSided );
			create_scalar( "/input/joystick/y", vr::VRScalarUnits_NormalizedTwoSided );
			create_bool( "/input/joystick/click" );
			create_bool( "/input/joystick/touch" );

			create_bool( "/input/thumbrest/touch" );
			break;
		}
		case ControllerLayout::Knuckles:
		{
			create_bool( "/input/system/click" );
			create_bool( "/input/system/touch" );

			create_bool( "/input/a/click" );
			create_bool( "/input/a/touch" );
			create_bool( "/input/b/click" );
			create_bool( "/input/b/touch" );

			create_bool( "/input/trigger/click" );
			create_bool( "/input/trigger/touch" );
			create_scalar( "/input/trigger/value", vr::VRScalarUnits_NormalizedOneSided );

			// Indexのグリップは感圧(force)付き
			create_scalar( "/input/grip/value", vr::VRScalarUnits_NormalizedOneSided );
			create_scalar( "/input/grip/force", vr::VRScalarUnits_NormalizedOneSided );
			create_bool( "/input/grip/touch" );

			create_scalar( "/input/thumbstick/x", vr::VRScalarUnits_NormalizedTwoSided );
			create_scalar( "/input/thumbstick/y", vr::VRScalarUnits_NormalizedTwoSided );
			create_bool( "/input/thumbstick/click" );
			create_bool( "/input/thumbstick/touch" );

			create_scalar( "/input/trackpad/x", vr::VRScalarUnits_NormalizedTwoSided );
			create_scalar( "/input/trackpad/y", vr::VRScalarUnits_NormalizedTwoSided );
			create_scalar( "/input/trackpad/force", vr::VRScalarUnits_NormalizedOneSided );
			create_bool( "/input/trackpad/touch" );
			break;
		}
		case ControllerLayout::ViveWand:
		{
			create_bool( "/input/system/click" );
			create_bool( "/input/application_menu/click" );
			create_bool( "/input/grip/click" );

			create_bool( "/input/trigger/click" );
			create_scalar( "/input/trigger/value", vr::VRScalarUnits_NormalizedOneSided );

			create_scalar( "/input/trackpad/x", vr::VRScalarUnits_NormalizedTwoSided );
			create_scalar( "/input/trackpad/y", vr::VRScalarUnits_NormalizedTwoSided );
			create_bool( "/input/trackpad/click" );
			create_bool( "/input/trackpad/touch" );
			break;
		}
	}

	vr::VRDriverInput()->CreateHapticComponent( container, "/output/haptic", &haptic_component_ );
}

void *VvreDevice::GetComponent( const char *pchComponentNameAndVersion )
{
	if ( display_component_ && strcmp( pchComponentNameAndVersion, vr::IVRDisplayComponent_Version ) == 0 )
	{
		return display_component_.get();
	}

	return nullptr;
}

void VvreDevice::DebugRequest( const char *pchRequest, char *pchResponseBuffer, uint32_t unResponseBufferSize )
{
	if ( unResponseBufferSize >= 1 )
		pchResponseBuffer[ 0 ] = 0;
}

void VvreDevice::GetDefaultPose( double *position ) const
{
	// アプリ未接続時の初期配置(立位、コントローラーは体の前)
	if ( device_class_ == vr::TrackedDeviceClass_HMD )
	{
		position[ 0 ] = 0.0;
		position[ 1 ] = 1.7;
		position[ 2 ] = 0.0;
	}
	else
	{
		position[ 0 ] = role_ == vr::TrackedControllerRole_LeftHand ? -0.2 : 0.2;
		position[ 1 ] = 1.4;
		position[ 2 ] = -0.3;
	}
}

vr::DriverPose_t VvreDevice::GetPose()
{
	vr::DriverPose_t pose = { 0 };

	// 単位クォータニオンでないとデバイスが出現しない
	pose.qWorldFromDriverRotation.w = 1.f;
	pose.qDriverFromHeadRotation.w = 1.f;

	// ハブ(アプリ)と切断中は「デバイス未接続」として報告する。
	// アプリが終了/クラッシュした後にvvreがHMDスロットを占有し続けないため
	if ( state_ == nullptr || !state_->IsHubConnected() )
	{
		pose.qRotation.w = 1.f;
		pose.deviceIsConnected = false;
		pose.poseIsValid = false;
		pose.result = vr::TrackingResult_Uninitialized;
		return pose;
	}

	DevicePoseState state{};
	if ( state_->GetPose( id_, &state ) )
	{
		pose.vecPosition[ 0 ] = state.position[ 0 ];
		pose.vecPosition[ 1 ] = state.position[ 1 ];
		pose.vecPosition[ 2 ] = state.position[ 2 ];

		pose.qRotation.w = state.rotation[ 0 ];
		pose.qRotation.x = state.rotation[ 1 ];
		pose.qRotation.y = state.rotation[ 2 ];
		pose.qRotation.z = state.rotation[ 3 ];

		pose.vecVelocity[ 0 ] = state.velocity[ 0 ];
		pose.vecVelocity[ 1 ] = state.velocity[ 1 ];
		pose.vecVelocity[ 2 ] = state.velocity[ 2 ];

		pose.vecAngularVelocity[ 0 ] = state.angular_velocity[ 0 ];
		pose.vecAngularVelocity[ 1 ] = state.angular_velocity[ 1 ];
		pose.vecAngularVelocity[ 2 ] = state.angular_velocity[ 2 ];

		pose.deviceIsConnected = state.connected;
	}
	else
	{
		pose.qRotation.w = 1.f;
		GetDefaultPose( pose.vecPosition );
		pose.deviceIsConnected = true;
	}

	pose.poseIsValid = true;
	pose.result = vr::TrackingResult_Running_OK;

	if ( device_class_ == vr::TrackedDeviceClass_HMD )
	{
		pose.shouldApplyHeadModel = true;
	}

	return pose;
}

void VvreDevice::PoseUpdateThread()
{
	while ( is_active_ )
	{
		vr::VRServerDriverHost()->TrackedDevicePoseUpdated( device_index_, GetPose(), sizeof( vr::DriverPose_t ) );
		std::this_thread::sleep_for( std::chrono::milliseconds( 4 ) );
	}
}

void VvreDevice::EnterStandby()
{
	DriverLog( "[vvre] device standby: id=%s", id_.c_str() );
}

void VvreDevice::Deactivate()
{
	if ( is_active_.exchange( false ) )
	{
		pose_update_thread_.join();
	}

	device_index_ = vr::k_unTrackedDeviceIndexInvalid;
	DriverLog( "[vvre] device deactivated: id=%s", id_.c_str() );
}

void VvreDevice::ApplyInput( const InputUpdate &update )
{
	if ( update.is_scalar )
	{
		const auto it = scalar_components_.find( update.path );
		if ( it != scalar_components_.end() )
		{
			vr::VRDriverInput()->UpdateScalarComponent( it->second, update.scalar_value, 0 );
		}
	}
	else
	{
		const auto it = bool_components_.find( update.path );
		if ( it != bool_components_.end() )
		{
			vr::VRDriverInput()->UpdateBooleanComponent( it->second, update.bool_value, 0 );
		}
	}
}

void VvreDevice::ProcessEvent( const vr::VREvent_t &vrevent )
{
	if ( vrevent.eventType == vr::VREvent_Input_HapticVibration
		&& haptic_component_ != vr::k_ulInvalidInputComponentHandle
		&& vrevent.data.hapticVibration.componentHandle == haptic_component_ )
	{
		// ハプティクスをアプリに転送してUIで可視化できるようにする
		nlohmann::json j = {
			{ "v", 1 },
			{ "type", "haptic" },
			{ "device", id_ },
			{ "durationSeconds", vrevent.data.hapticVibration.fDurationSeconds },
			{ "frequency", vrevent.data.hapticVibration.fFrequency },
			{ "amplitude", vrevent.data.hapticVibration.fAmplitude },
		};

		if ( send_ )
		{
			send_( j.dump() );
		}
	}
}

const std::string &VvreDevice::GetSerialNumber() const
{
	return serial_number_;
}

const std::string &VvreDevice::GetId() const
{
	return id_;
}

vr::ETrackedDeviceClass VvreDevice::GetDeviceClass() const
{
	return device_class_;
}
