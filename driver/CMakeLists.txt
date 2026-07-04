cmake_minimum_required(VERSION 3.20)
project(vvre_driver CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# SteamVR (Windows) は win64 のみ対象
if(NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
    message(FATAL_ERROR "This driver only supports 64-bit Windows builds")
endif()
set(ARCH_TARGET win64)

set(DRIVER_NAME driver_vvre)
set(VVRE_OUTPUT_DIR ${CMAKE_CURRENT_SOURCE_DIR}/output/vvre)

# WebSocketクライアント(自動再接続内蔵)。TLS/zlibは不要なので無効化
include(FetchContent)
set(USE_TLS OFF CACHE BOOL "" FORCE)
set(USE_ZLIB OFF CACHE BOOL "" FORCE)
set(IXWEBSOCKET_INSTALL OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
    ixwebsocket
    GIT_REPOSITORY https://github.com/machinezone/IXWebSocket.git
    GIT_TAG v11.4.6
)
FetchContent_MakeAvailable(ixwebsocket)

add_library(${DRIVER_NAME} SHARED
    src/driver_factory.cpp
    src/device_provider.h
    src/device_provider.cpp
    src/vvre_device.h
    src/vvre_device.cpp
    src/display_component.h
    src/display_component.cpp
    src/shared_state.h
    src/ws_client.h
    src/ws_client.cpp
    src/driverlog.h
    src/driverlog.cpp
)

target_include_directories(${DRIVER_NAME} PRIVATE vendor/openvr vendor src)
target_link_libraries(${DRIVER_NAME} PRIVATE ixwebsocket)

# ソースはUTF-8(BOMなし)。MSVCの既定はCP932なので明示する
target_compile_options(${DRIVER_NAME} PRIVATE "$<$<CXX_COMPILER_ID:MSVC>:/utf-8>")

# マルチコンフィグ(MSVC)でも常に output/vvre/bin/win64 に DLL を出す
set_target_properties(${DRIVER_NAME} PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${VVRE_OUTPUT_DIR}/bin/${ARCH_TARGET}
    RUNTIME_OUTPUT_DIRECTORY_DEBUG ${VVRE_OUTPUT_DIR}/bin/${ARCH_TARGET}
    RUNTIME_OUTPUT_DIRECTORY_RELEASE ${VVRE_OUTPUT_DIR}/bin/${ARCH_TARGET}
    RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO ${VVRE_OUTPUT_DIR}/bin/${ARCH_TARGET}
)

# ドライバーパッケージ(マニフェスト+resources)を出力ディレクトリへ同梱
add_custom_command(
    TARGET ${DRIVER_NAME}
    POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${CMAKE_CURRENT_SOURCE_DIR}/vvre
        ${VVRE_OUTPUT_DIR}
)
