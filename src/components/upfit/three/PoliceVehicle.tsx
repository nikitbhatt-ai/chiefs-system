"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type { Mesh, MeshStandardMaterial, PointLight } from "three";
import type {
  VehicleModel,
  LightPackageSlug,
  InteriorOptionSlug,
} from "@/lib/upfit/catalog";

// Emergency-lighting timing. We alternate red / blue clusters in a fast
// twin-flash pattern, the way a real LED bar cycles.
function redActiveAt(t: number): boolean {
  // Two quick flashes per color per cycle.
  const phase = Math.floor(t * 9) % 4;
  return phase === 0 || phase === 1;
}

/**
 * A single emissive emergency-light head. Pulses its color on the shared
 * clock. `color` decides whether it flashes on the red or blue half-cycle.
 */
function FlashLight({
  position,
  size,
  color,
  rotation,
}: {
  position: [number, number, number];
  size: [number, number, number];
  color: "red" | "blue";
  rotation?: [number, number, number];
}) {
  const matRef = useRef<MeshStandardMaterial>(null);
  const hex = color === "red" ? "#ff2222" : "#2244ff";

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const on = color === "red" ? redActiveAt(t) : !redActiveAt(t);
    if (matRef.current) {
      matRef.current.emissiveIntensity = on ? 4.5 : 0.25;
    }
  });

  return (
    <mesh position={position} rotation={rotation} castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        ref={matRef}
        color={hex}
        emissive={hex}
        emissiveIntensity={0.25}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Roof glow lights that pulse alongside the bar for a marked-unit feel. */
function GlowLights({ y, halfLen }: { y: number; halfLen: number }) {
  const redRef = useRef<PointLight>(null);
  const blueRef = useRef<PointLight>(null);
  useFrame(({ clock }) => {
    const red = redActiveAt(clock.getElapsedTime());
    if (redRef.current) redRef.current.intensity = red ? 6 : 0;
    if (blueRef.current) blueRef.current.intensity = red ? 0 : 6;
  });
  return (
    <>
      <pointLight ref={redRef} position={[0, y, halfLen]} color="#ff2222" distance={6} decay={2} />
      <pointLight ref={blueRef} position={[0, y, -halfLen]} color="#2244ff" distance={6} decay={2} />
    </>
  );
}

/**
 * The emergency-lighting layer. Renders one of the three packages:
 *  - lightbar:  full roof bar (split red/blue) + roof glow
 *  - surface:   perimeter surface heads (grille, mirrors, rear deck)
 *  - slicktop:  covert — visor + grille only, no roof bar
 */
function LightingPackage({
  pkg,
  model,
  bodyTopY,
  cabinFrontX,
  cabinRearX,
}: {
  pkg: LightPackageSlug;
  model: VehicleModel;
  bodyTopY: number;
  cabinFrontX: number;
  cabinRearX: number;
}) {
  const { dims } = model;
  const halfW = dims.width / 2;
  const roofY = bodyTopY + dims.cabinHeight;
  const frontX = dims.length / 2;
  const rearX = -dims.length / 2;

  if (pkg === "lightbar") {
    const barLen = dims.width * 0.82;
    const seg = barLen / 6;
    const barX = (cabinFrontX + cabinRearX) / 2 + (cabinFrontX - cabinRearX) * 0.18;
    return (
      <group>
        {/* Bar housing */}
        <RoundedBox
          args={[0.34, 0.12, barLen]}
          radius={0.04}
          smoothness={3}
          position={[barX, roofY + 0.08, 0]}
          castShadow
        >
          <meshStandardMaterial color="#0a0a0a" roughness={0.4} />
        </RoundedBox>
        {/* Six alternating heads across the bar */}
        {Array.from({ length: 6 }).map((_, i) => (
          <FlashLight
            key={i}
            position={[barX, roofY + 0.12, -barLen / 2 + seg / 2 + i * seg]}
            size={[0.3, 0.07, seg * 0.85]}
            color={i % 2 === 0 ? "red" : "blue"}
          />
        ))}
        <GlowLights y={roofY + 0.5} halfLen={barLen / 2} />
      </group>
    );
  }

  if (pkg === "surface") {
    const grilleY = bodyTopY - dims.bodyHeight * 0.45;
    const rearY = bodyTopY - dims.bodyHeight * 0.2;
    return (
      <group>
        {/* Grille (front face) */}
        <FlashLight position={[frontX - 0.02, grilleY, -0.35]} size={[0.06, 0.14, 0.28]} color="red" />
        <FlashLight position={[frontX - 0.02, grilleY, 0.35]} size={[0.06, 0.14, 0.28]} color="blue" />
        {/* Mirror heads */}
        <FlashLight position={[cabinFrontX, bodyTopY + 0.05, halfW + 0.04]} size={[0.18, 0.06, 0.06]} color="red" />
        <FlashLight position={[cabinFrontX, bodyTopY + 0.05, -halfW - 0.04]} size={[0.18, 0.06, 0.06]} color="blue" />
        {/* Rear deck */}
        <FlashLight position={[rearX + 0.02, rearY, -0.35]} size={[0.06, 0.14, 0.28]} color="blue" />
        <FlashLight position={[rearX + 0.02, rearY, 0.35]} size={[0.06, 0.14, 0.28]} color="red" />
      </group>
    );
  }

  // slicktop — covert interior lighting only
  const visorX = cabinFrontX - 0.15;
  return (
    <group>
      {/* Windshield visor strip just under the roofline */}
      <FlashLight position={[visorX, roofY - 0.12, -0.35]} size={[0.05, 0.05, 0.3]} color="red" />
      <FlashLight position={[visorX, roofY - 0.12, 0.35]} size={[0.05, 0.05, 0.3]} color="blue" />
      {/* Discreet grille pair */}
      <FlashLight position={[frontX - 0.02, bodyTopY - dims.bodyHeight * 0.5, -0.2]} size={[0.05, 0.08, 0.12]} color="red" />
      <FlashLight position={[frontX - 0.02, bodyTopY - dims.bodyHeight * 0.5, 0.2]} size={[0.05, 0.08, 0.12]} color="blue" />
    </group>
  );
}

function Wheel({
  position,
  radius,
  width,
}: {
  position: [number, number, number];
  radius: number;
  width: number;
}) {
  return (
    <group position={position} rotation={[Math.PI / 2, 0, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[radius, radius, width, 24]} />
        <meshStandardMaterial color="#0c0c0c" roughness={0.85} />
      </mesh>
      {/* Hub */}
      <mesh>
        <cylinderGeometry args={[radius * 0.55, radius * 0.55, width + 0.01, 18]} />
        <meshStandardMaterial color="#8a8d93" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
}

/**
 * Procedurally-built police vehicle. Distinct silhouettes for SUVs (roof
 * carries to the tail) vs trucks (short crew cab + open bed). Body goes
 * translucent in the interior view so the partition / console / storage
 * box read clearly.
 */
export function PoliceVehicle({
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
  const bodyRef = useRef<Mesh>(null);
  const { dims } = model;
  const L = dims.length;
  const W = dims.width;
  const bodyBottomY = dims.rideHeight;
  const bodyTopY = dims.rideHeight + dims.bodyHeight;
  const bodyCenterY = (bodyBottomY + bodyTopY) / 2;

  const hoodEndX = L / 2 - dims.hoodLength;
  const isTruck = dims.rearKind === "bed";

  // Cabin/greenhouse extent.
  const cabinFrontX = hoodEndX;
  const cabinRearX = isTruck ? hoodEndX - dims.cabinLength : -L / 2 + 0.18;
  const cabinCenterX = (cabinFrontX + cabinRearX) / 2;
  const cabinLen = cabinFrontX - cabinRearX;
  const cabinCenterY = bodyTopY + dims.cabinHeight / 2;
  const cabinW = W * 0.9;

  const bodyOpacity = cutaway ? 0.18 : 1;

  // Wheels
  const wheelW = 0.26;
  const axleZ = W / 2 - wheelW * 0.4;
  const frontAxleX = hoodEndX - 0.1;
  const rearAxleX = isTruck ? -L / 2 + 1.0 : -L / 2 + 0.95;

  return (
    <group position={[0, 0, 0]}>
      {/* Lower body */}
      <RoundedBox
        ref={bodyRef}
        args={[L, dims.bodyHeight, W]}
        radius={0.12}
        smoothness={4}
        position={[0, bodyCenterY, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={bodyColor}
          metalness={0.45}
          roughness={0.35}
          transparent={cutaway}
          opacity={bodyOpacity}
        />
      </RoundedBox>

      {/* Greenhouse / cabin */}
      <RoundedBox
        args={[cabinLen, dims.cabinHeight, cabinW]}
        radius={0.1}
        smoothness={4}
        position={[cabinCenterX, cabinCenterY, 0]}
        castShadow
      >
        <meshStandardMaterial
          color={bodyColor}
          metalness={0.45}
          roughness={0.35}
          transparent={cutaway}
          opacity={bodyOpacity}
        />
      </RoundedBox>

      {/* Glass band on the greenhouse */}
      <mesh position={[cabinCenterX, cabinCenterY + dims.cabinHeight * 0.08, 0]}>
        <boxGeometry args={[cabinLen * 0.96, dims.cabinHeight * 0.5, cabinW + 0.02]} />
        <meshStandardMaterial
          color="#0a1622"
          metalness={0.2}
          roughness={0.1}
          transparent
          opacity={cutaway ? 0.12 : 0.85}
        />
      </mesh>

      {/* Truck bed walls */}
      {isTruck && (
        <>
          <mesh position={[(cabinRearX + -L / 2) / 2, bodyTopY + 0.12, W / 2 - 0.05]} castShadow>
            <boxGeometry args={[cabinRearX - -L / 2, 0.24, 0.06]} />
            <meshStandardMaterial color={bodyColor} metalness={0.4} roughness={0.4} transparent={cutaway} opacity={bodyOpacity} />
          </mesh>
          <mesh position={[(cabinRearX + -L / 2) / 2, bodyTopY + 0.12, -W / 2 + 0.05]} castShadow>
            <boxGeometry args={[cabinRearX - -L / 2, 0.24, 0.06]} />
            <meshStandardMaterial color={bodyColor} metalness={0.4} roughness={0.4} transparent={cutaway} opacity={bodyOpacity} />
          </mesh>
          <mesh position={[-L / 2 + 0.03, bodyTopY + 0.12, 0]} castShadow>
            <boxGeometry args={[0.06, 0.24, W - 0.1]} />
            <meshStandardMaterial color={bodyColor} metalness={0.4} roughness={0.4} transparent={cutaway} opacity={bodyOpacity} />
          </mesh>
        </>
      )}

      {/* Headlights + grille hint */}
      <mesh position={[L / 2 - 0.01, bodyCenterY + 0.05, 0.55]}>
        <boxGeometry args={[0.04, 0.12, 0.3]} />
        <meshStandardMaterial color="#dfe7ff" emissive="#88aaff" emissiveIntensity={0.4} toneMapped={false} />
      </mesh>
      <mesh position={[L / 2 - 0.01, bodyCenterY + 0.05, -0.55]}>
        <boxGeometry args={[0.04, 0.12, 0.3]} />
        <meshStandardMaterial color="#dfe7ff" emissive="#88aaff" emissiveIntensity={0.4} toneMapped={false} />
      </mesh>

      {/* Wheels */}
      <Wheel position={[frontAxleX, dims.wheelRadius, axleZ]} radius={dims.wheelRadius} width={wheelW} />
      <Wheel position={[frontAxleX, dims.wheelRadius, -axleZ]} radius={dims.wheelRadius} width={wheelW} />
      <Wheel position={[rearAxleX, dims.wheelRadius, axleZ]} radius={dims.wheelRadius} width={wheelW} />
      <Wheel position={[rearAxleX, dims.wheelRadius, -axleZ]} radius={dims.wheelRadius} width={wheelW} />

      {/* Emergency lighting */}
      <LightingPackage
        pkg={lightPackage}
        model={model}
        bodyTopY={bodyTopY}
        cabinFrontX={cabinFrontX}
        cabinRearX={cabinRearX}
      />

      {/* Interior equipment (only meaningful in cutaway) */}
      {cutaway && (
        <Interior
          model={model}
          options={interiorOptions}
          bodyTopY={bodyTopY}
          bodyBottomY={bodyBottomY}
          cabinFrontX={cabinFrontX}
          cabinRearX={cabinRearX}
          isTruck={isTruck}
        />
      )}
    </group>
  );
}

/**
 * Interior equipment shown in the cutaway view: front seats, an optional
 * prisoner partition behind them, a center console between the seats, and a
 * rear storage box in the cargo area (bed for trucks).
 */
function Interior({
  model,
  options,
  bodyTopY,
  bodyBottomY,
  cabinFrontX,
  cabinRearX,
  isTruck,
}: {
  model: VehicleModel;
  options: InteriorOptionSlug[];
  bodyTopY: number;
  bodyBottomY: number;
  cabinFrontX: number;
  cabinRearX: number;
  isTruck: boolean;
}) {
  const floorY = bodyTopY - model.dims.bodyHeight * 0.55;
  const seatZ = model.dims.width * 0.22;
  const frontSeatX = cabinFrontX - 0.55;
  const partitionX = frontSeatX - 0.45;

  const has = (o: InteriorOptionSlug) => options.includes(o);

  return (
    <group>
      {/* Front seats */}
      {[seatZ, -seatZ].map((z, i) => (
        <group key={i} position={[frontSeatX, floorY, z]}>
          <mesh castShadow>
            <boxGeometry args={[0.5, 0.12, 0.5]} />
            <meshStandardMaterial color="#15151c" roughness={0.9} />
          </mesh>
          <mesh position={[-0.22, 0.32, 0]} castShadow>
            <boxGeometry args={[0.12, 0.6, 0.5]} />
            <meshStandardMaterial color="#15151c" roughness={0.9} />
          </mesh>
        </group>
      ))}

      {/* Center console */}
      {has("console") && (
        <group position={[frontSeatX + 0.15, floorY + 0.12, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.55, 0.26, 0.26]} />
            <meshStandardMaterial color="#3a3f47" metalness={0.6} roughness={0.4} />
          </mesh>
          {/* Faceplate / control head */}
          <mesh position={[0.0, 0.18, 0]}>
            <boxGeometry args={[0.3, 0.12, 0.22]} />
            <meshStandardMaterial color="#0c0c10" emissive="#1b6f3a" emissiveIntensity={0.6} toneMapped={false} />
          </mesh>
        </group>
      )}

      {/* Prisoner partition */}
      {has("partition") && (
        <group position={[partitionX, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.06, model.dims.cabinHeight * 0.95 + model.dims.bodyHeight * 0.3, model.dims.width * 0.82]} />
            <meshStandardMaterial color="#9aa0aa" metalness={0.7} roughness={0.35} transparent opacity={0.55} />
          </mesh>
          {/* Cage bars */}
          {Array.from({ length: 6 }).map((_, i) => (
            <mesh key={i} position={[0, floorY + 0.55, -model.dims.width * 0.35 + i * (model.dims.width * 0.7 / 5)]}>
              <boxGeometry args={[0.02, 0.9, 0.02]} />
              <meshStandardMaterial color="#5a5f68" metalness={0.8} roughness={0.3} />
            </mesh>
          ))}
        </group>
      )}

      {/* Rear storage box */}
      {has("storage") && (
        <mesh
          position={[isTruck ? cabinRearX - 0.9 : (cabinRearX + -model.dims.length / 2) / 2, floorY + 0.18, 0]}
          castShadow
        >
          <boxGeometry args={[isTruck ? 1.0 : Math.abs(cabinRearX + model.dims.length / 2) * 0.8, 0.36, model.dims.width * 0.7]} />
          <meshStandardMaterial color="#23262e" metalness={0.5} roughness={0.5} />
        </mesh>
      )}
    </group>
  );
}
