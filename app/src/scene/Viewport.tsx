import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { DeviceGizmo } from './DeviceGizmo';

/**
 * three.jsビューポート。
 * グリッド床の上にHMD/コントローラーを表示し、ギズモで操作できる。
 * @returns {JSX.Element} ビューポート要素
 */
export const Viewport = () => {
  return (
    <Canvas camera={{ position: [1.8, 1.9, 1.8], fov: 50 }}>
      <color attach="background" args={['#101018']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 5, 2]} intensity={1.2} />

      <Grid
        args={[10, 10]}
        cellColor="#2e2e40"
        sectionColor="#44445c"
        fadeDistance={12}
        infiniteGrid
      />
      {/* プレイエリアの目安 (2m x 2m) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <planeGeometry args={[2, 2]} />
        <meshBasicMaterial color="#1c2c44" transparent opacity={0.35} />
      </mesh>

      <DeviceGizmo deviceId="hmd" />
      <DeviceGizmo deviceId="left" />
      <DeviceGizmo deviceId="right" />

      <OrbitControls makeDefault target={[0, 1.2, 0]} />
    </Canvas>
  );
};
