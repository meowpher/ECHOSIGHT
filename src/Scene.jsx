import React, { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'

function CameraOrientation({ orientation = { alpha: 0, beta: 0 }, detached = false }) {
  const { camera } = useThree()
  useFrame(() => {
    if (detached) return
    const a = orientation.alpha || 0
    const b = orientation.beta || 0
    // Map device alpha/beta to camera Euler — simple mapping for AR overlay
    camera.rotation.set(THREE.MathUtils.degToRad(-b), 0, THREE.MathUtils.degToRad(a))
  })
  return null
}

function PointsCloud({ points = [] }) {
  const ref = useRef()

  const positions = useMemo(() => {
    const arr = new Float32Array(points.length * 3)
    for (let i = 0; i < points.length; i++) {
      arr[3 * i] = points[i].x
      arr[3 * i + 1] = points[i].y
      arr[3 * i + 2] = points[i].z
    }
    return arr
  }, [points])

  useEffect(() => {
    if (!ref.current) return
    const geom = ref.current.geometry
    if (!geom) return
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.attributes.position.needsUpdate = true
  }, [positions])

  return (
    <points ref={ref}>
      <bufferGeometry attach="geometry">
        <bufferAttribute
          attachObject={{ name: 'attributes', attach: 'position' }}
          array={positions}
          count={positions.length / 3}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        attach="material"
        color={0x00ff00}
        size={0.06}
        sizeAttenuation={true}
        blending={THREE.AdditiveBlending}
        depthTest={false}
        transparent={true}
        opacity={0.9}
      />
    </points>
  )
}

export default function Scene({ points = [], detached = false, orientation = { alpha: 0, beta: 0 } }) {
  return (
    <Canvas
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 12 }}
      gl={{ antialias: true, alpha: true }}
    >
      <perspectiveCamera makeDefault fov={70} position={detached ? [0, 6, 8] : [0, 0, 0]} />
      <ambientLight intensity={0.8} />
      <CameraOrientation orientation={orientation} detached={detached} />
      {detached && (
        <group position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <gridHelper args={[10, 10, '#1f2937', '#374151']} />
        </group>
      )}
      <PointsCloud points={points} />
    </Canvas>
  )
}
