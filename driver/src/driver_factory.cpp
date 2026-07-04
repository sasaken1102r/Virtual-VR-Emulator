#include <cstring>

#include "openvr_driver.h"

#include "device_provider.h"

#if defined( _WIN32 )
#define HMD_DLL_EXPORT extern "C" __declspec( dllexport )
#else
#error "Unsupported Platform."
#endif

static VvreDeviceProvider device_provider;

// vrserver がドライバーDLLをロードした際に呼ぶエントリーポイント
HMD_DLL_EXPORT void *HmdDriverFactory( const char *pInterfaceName, int *pReturnCode )
{
	if ( 0 == strcmp( vr::IServerTrackedDeviceProvider_Version, pInterfaceName ) )
	{
		return &device_provider;
	}

	if ( pReturnCode )
		*pReturnCode = vr::VRInitError_Init_InterfaceNotFound;

	return nullptr;
}
