import React, { useEffect, useRef, useState } from 'react'
import SonarEngine from './SonarEngine'

export default function App() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  
  const [status, setStatus] = useState('idle')
  const [distance, setDistance] = useState(null)
  const [confidence, setConfidence] = useState(0)
  const [micRMS, setMicRMS] = useState(0)
  const [peakCorr, setPeakCorr] = useState(0)
  const [rawDistance, setRawDistance] = useState(null)
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    let mounted = true

    console.log('App mounted')

    // Resize canvas
    const resize = () => {
      const c = canvasRef.current
      if (!c) return
      const dpr = window.devicePixelRatio || 1
      c.width = Math.floor(window.innerWidth * dpr)
      c.height = Math.floor(window.innerHeight * dpr)
      const ctx = c.getContext('2d')
      ctx.scale(dpr, dpr)
    }

    resize()
    window.addEventListener('resize', resize)

    // Animation loop
    let rafId = null
    function drawLoop() {
      const c = canvasRef.current
      if (!c) return

      const ctx = c.getContext('2d')
      const width = window.innerWidth
      const height = window.innerHeight

      ctx.clearRect(0, 0, width, height)

      // Draw red circle if distance detected
      if (distance != null && scanning) {
        const cx = width / 2
        const cy = height / 2
        const maxRange = 5
        const frac = Math.min(1, distance / maxRange)
        const r = Math.min(width, height) * 0.3 * frac
        ctx.beginPath()
        ctx.fillStyle = 'rgba(220, 38, 38, 0.8)'
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(220, 38, 38, 0.6)'
        ctx.lineWidth = 2
        ctx.stroke()
      }

      // Debug Dashboard (top-left)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      ctx.fillRect(10, 10, 220, 140)

      ctx.fillStyle = 'rgba(34, 197, 94, 0.95)'
      ctx.font = 'bold 14px monospace'
      ctx.fillText('DEBUG DASHBOARD', 15, 28)

      ctx.font = '12px monospace'
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.fillText(`Mic RMS: ${(micRMS * 100).toFixed(1)}%`, 15, 45)
      ctx.fillText(`Peak Corr: ${peakCorr.toFixed(3)}`, 15, 60)
      ctx.fillText(`Raw Dist: ${rawDistance != null ? rawDistance.toFixed(2) + ' m' : '--'}`, 15, 75)
      ctx.fillText(`Smoothed: ${distance != null ? distance.toFixed(2) + ' m' : '--'}`, 15, 90)
      ctx.fillText(`Conf: ${confidence.toFixed(3)}`, 15, 105)
      ctx.fillText(`Status: ${status}`, 15, 120)
      ctx.fillText(`Scanning: ${scanning ? 'YES' : 'NO'}`, 15, 135)

      rafId = requestAnimationFrame(drawLoop)
    }
    rafId = requestAnimationFrame(drawLoop)

    return () => {
      mounted = false
      window.removeEventListener('resize', resize)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [distance, confidence, micRMS, peakCorr, rawDistance, status, scanning])

  async function handleStart() {
    console.log('handleStart called')
    if (scanning) return

    setStatus('requesting-camera')
    setScanning(true)

    try {
      // Step 1: Request Camera Only
      console.log('Step 1: Requesting camera...')
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment'
        },
        audio: false
      })
      console.log('Step 1: Camera granted')

      // Attach to video element
      const v = videoRef.current
      if (v) {
        v.srcObject = cameraStream
        v.muted = true
        v.playsInline = true
        await v.play().catch((e) => console.warn('Video play error:', e))
        console.log('Step 1: Video element playing')
      }

      setStatus('requesting-microphone')

      // Step 2: Request Microphone Only
      console.log('Step 2: Requesting microphone...')
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: false
      })
      console.log('Step 2: Microphone granted')

      // Initialize engine with mic stream
      setStatus('initializing-sonar')
      console.log('Step 3: Initializing SonarEngine...')
      const engine = new SonarEngine({
        recMs: 200,
        pulseMs: 40,
        f0: 15000,
        f1: 17000,
        noiseGate: 0.05,
        smoothingAlpha: 0.15
      })
      engineRef.current = engine

      // Call init() with microphone stream
      await engine.init(micStream)
      console.log('Step 3: SonarEngine initialized')

      setStatus('running')
      console.log('Starting continuous scan...')

      // Start scanning
      engine.startContinuousScan((res) => {
        setConfidence(res.confidence || 0)
        setDistance(res.smoothed == null ? null : res.smoothed)
        setMicRMS(res.micRMS || 0)
        setPeakCorr(res.peakCorr || 0)
        setRawDistance(res.rawDistance || null)
      })
    } catch (err) {
      console.error('Error in handleStart:', err)
      setStatus('error: ' + (err && err.message))
      setScanning(false)
      alert('Error: ' + (err && err.message))
    }
  }

  async function handleStop() {
    console.log('handleStop called')
    setScanning(false)
    setStatus('stopped')

    try {
      if (engineRef.current) {
        engineRef.current.stop()
      }
    } catch (e) {
      console.error('Error stopping engine:', e)
    }

    // Stop camera
    try {
      const v = videoRef.current
      if (v && v.srcObject) {
        const s = v.srcObject
        if (s.getTracks) s.getTracks().forEach(t => t.stop())
        v.srcObject = null
      }
    } catch (e) {
      console.error('Error stopping camera:', e)
    }
  }

  async function handleTestBeep() {
    console.log('handleTestBeep called')
    try {
      if (!engineRef.current) {
        console.error('Engine not initialized yet')
        alert('Start scan first to initialize the audio engine')
        return
      }
      await engineRef.current.playTestBeep(500, 440)
    } catch (e) {
      console.error('Test beep error:', e)
      alert('Speaker test failed: ' + e.message)
    }
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {/* Video background */}
      <video
        ref={videoRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          objectFit: 'cover',
          zIndex: -1
        }}
        autoPlay
        playsInline
        muted
      />

      {/* Canvas overlay */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 10,
          pointerEvents: 'none'
        }}
      />

      {/* Control buttons */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 12,
          zIndex: 20
        }}
      >
        <button
          onClick={handleStart}
          disabled={scanning}
          style={{
            padding: '12px 24px',
            backgroundColor: scanning ? '#4b5563' : '#16a34a',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 'bold',
            cursor: scanning ? 'not-allowed' : 'pointer',
            boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
          }}
        >
          {scanning ? 'Scanning...' : 'Start Scan'}
        </button>

        <button
          onClick={handleStop}
          disabled={!scanning}
          style={{
            padding: '12px 24px',
            backgroundColor: scanning ? '#dc2626' : '#4b5563',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 'bold',
            cursor: scanning ? 'pointer' : 'not-allowed',
            boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
          }}
        >
          Stop
        </button>

        <button
          onClick={handleTestBeep}
          style={{
            padding: '12px 24px',
            backgroundColor: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
          }}
        >
          Test Speaker
        </button>
      </div>
    </div>
  )
}
