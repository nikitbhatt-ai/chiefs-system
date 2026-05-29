"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import { PoliceVehicle } from "./PoliceVehicle";
import type {
  VehicleModel,
  LightPackageSlug,
  InteriorOptionSlug,
} from "@/lib/upfit/catalog";

/**
 * The interactive 3D stage. Orbit-controllable, with a procedural police
 * vehicle at the center. `cutaway` flips to the interior view (translucent
 * body + equipment) and tightens the camera framing.
 */
export default function UpfitScene({
  model,
  bodyColor,
  lightPackage,
  interiorOptions,
  cutaway,
}: {
  model: VehicleModel;
  bodyColor: string;
  lightPackage: LightPackageSlug;
  interiorOptions: InteriorOptionSlug[];
  cutaway: boolean;
}) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: cutaway ? [4.5, 3, 5] : [7, 3.2, 7.5], fov: 38 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={["#0b0d16"]} />
      <fog attach="fog" args={["#0b0d16", 16, 32]} />

      {/* Key + fill + rim lighting */}
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[6, 10, 6]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-8, 5, -6]} intensity={0.5} color="#88aaff" />
      <spotLight position={[0, 8, -10]} intensity={0.6} angle={0.6} penumbra={1} color="#5a7cff" />

      <Suspense fallback={null}>
        <PoliceVehicle
          model={model}
          bodyColor={bodyColor}
          lightPackage={lightPackage}
          interiorOptions={interiorOptions}
          cutaway={cutaway}
        />
        <ContactShadows
          position={[0, 0.01, 0]}
          opacity={0.55}
          scale={14}
          blur={2.4}
          far={6}
          resolution={512}
          color="#000000"
        />
      </Suspense>

      {/* Ground grid */}
      <gridHelper args={[40, 40, "#1c2233", "#141826"]} position={[0, 0, 0]} />

      <OrbitControls
        enablePan={false}
        minDistance={4}
        maxDistance={14}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2.1}
        autoRotate={!cutaway}
        autoRotateSpeed={0.6}
        target={[0, 1, 0]}
      />
    </Canvas>
  );
}
