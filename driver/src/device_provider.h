#pragma once

#include <memory>
#include <vector>

#include "openvr_driver.h"

#include "shared_state.h"
#include "vvre_device.h"
#include "ws_client.h"

class VvreDeviceProvider : public vr::IServerTrackedDeviceProvider
{
public:
	vr::EVRInitError Init( vr::IVRDriverContext *pDriverContext ) override;
	void Cleanup() override;
	const char *const *GetInterfaceVersions() override;
	void RunFrame() override;
	bool ShouldBlockStandbyMode() override;
	void EnterStandby() override;
	void LeaveStandby() override;

private:
	bool AddDevice( std::unique_ptr< VvreDevice > device, vr::ETrackedDeviceClass deviceClass );
	void AddAllDevices();

	std::unique_ptr< SharedState > state_;
	std::unique_ptr< WsClient > ws_client_;
	std::vector< std::unique_ptr< VvreDevice > > devices_;
	bool devices_added_ = false;
};
