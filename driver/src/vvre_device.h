#pragma once

#include <atomic>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <unordered_map>

#include "openvr_driver.h"

#include "display_component.h"
#include "shared_state.h"

// 仮想デバイス1台分(HMD / 左コントローラー / 右コントローラー)。
// どの種類になるかはコンストラクタ引数で決まる。
class VvreDevice final : public vr::ITrackedDeviceServerDriver
{
public:
	using SendFn = std::function< void( const std::string & ) >;

	VvreDevice( std::string id, vr::ETrackedDeviceClass deviceClass, vr::ETrackedControllerRole role,
		SharedState *state, SendFn send );

	// ----- vr::ITrackedDeviceServerDriver -----
	vr::EVRInitError Activate( uint32_t unObjectId ) override;
	void Deactivate() override;
	void EnterStandby() override;
	void *GetComponent( const char *pchComponentNameAndVersion ) override;
	void DebugRequest( const char *pchRequest, char *pchResponseBuffer, uint32_t unResponseBufferSize ) override;
	vr::DriverPose_t GetPose() override;

	// ----- 独自メソッド -----
	const std::string &GetSerialNumber() const;
	const std::string &GetId() const;
	vr::ETrackedDeviceClass GetDeviceClass() const;
	void ApplyInput( const InputUpdate &update );
	void ProcessEvent( const vr::VREvent_t &vrevent );

private:
	void SetupHmdProperties( vr::PropertyContainerHandle_t container );
	void SetupControllerProperties( vr::PropertyContainerHandle_t container );
	void CreateInputComponents( vr::PropertyContainerHandle_t container );
	void GetDefaultPose( double *position ) const;
	void PoseUpdateThread();

	std::string id_;
	vr::ETrackedDeviceClass device_class_;
	vr::ETrackedControllerRole role_;

	std::string serial_number_;
	std::string model_number_;

	SharedState *state_;
	SendFn send_;

	std::unique_ptr< VvreDisplayComponent > display_component_;

	std::unordered_map< std::string, vr::VRInputComponentHandle_t > bool_components_;
	std::unordered_map< std::string, vr::VRInputComponentHandle_t > scalar_components_;
	vr::VRInputComponentHandle_t haptic_component_ = vr::k_ulInvalidInputComponentHandle;

	std::atomic< bool > is_active_{ false };
	std::atomic< uint32_t > device_index_{ vr::k_unTrackedDeviceIndexInvalid };

	std::thread pose_update_thread_;
};
