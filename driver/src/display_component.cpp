#include "display_component.h"

VvreDisplayComponent::VvreDisplayComponent( const DisplayConfiguration &config )
	: config_( config )
{
}

bool VvreDisplayComponent::IsDisplayOnDesktop()
{
	return true;
}

bool VvreDisplayComponent::IsDisplayRealDisplay()
{
	return false;
}

void VvreDisplayComponent::GetRecommendedRenderTargetSize( uint32_t *pnWidth, uint32_t *pnHeight )
{
	*pnWidth = config_.render_width;
	*pnHeight = config_.render_height;
}

void VvreDisplayComponent::GetEyeOutputViewport( vr::EVREye eEye, uint32_t *pnX, uint32_t *pnY, uint32_t *pnWidth, uint32_t *pnHeight )
{
	*pnY = 0;
	*pnWidth = config_.window_width / 2;
	*pnHeight = config_.window_height;
	*pnX = ( eEye == vr::Eye_Left ) ? 0 : config_.window_width / 2;
}

void VvreDisplayComponent::GetProjectionRaw( vr::EVREye eEye, float *pfLeft, float *pfRight, float *pfTop, float *pfBottom )
{
	*pfLeft = -1.0f;
	*pfRight = 1.0f;
	*pfTop = -1.0f;
	*pfBottom = 1.0f;
}

vr::DistortionCoordinates_t VvreDisplayComponent::ComputeDistortion( vr::EVREye eEye, float fU, float fV )
{
	vr::DistortionCoordinates_t coordinates{};
	coordinates.rfBlue[ 0 ] = fU;
	coordinates.rfBlue[ 1 ] = fV;
	coordinates.rfGreen[ 0 ] = fU;
	coordinates.rfGreen[ 1 ] = fV;
	coordinates.rfRed[ 0 ] = fU;
	coordinates.rfRed[ 1 ] = fV;
	return coordinates;
}

void VvreDisplayComponent::GetWindowBounds( int32_t *pnX, int32_t *pnY, uint32_t *pnWidth, uint32_t *pnHeight )
{
	*pnX = config_.window_x;
	*pnY = config_.window_y;
	*pnWidth = config_.window_width;
	*pnHeight = config_.window_height;
}

bool VvreDisplayComponent::ComputeInverseDistortion( vr::HmdVector2_t *pResult, vr::EVREye eEye, uint32_t unChannel, float fU, float fV )
{
	// false を返すと SteamVR が ComputeDistortion から逆変換を推定する
	return false;
}
