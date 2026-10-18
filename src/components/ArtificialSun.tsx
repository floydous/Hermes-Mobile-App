import { useEffect, useMemo, useRef } from 'react'

export interface ArtificialSunProps {
  theme?: 'light' | 'grey' | 'dark'
  setTheme?: (theme: 'light' | 'grey' | 'dark') => void
  onCycle?: () => void
  className?: string
  interactive?: boolean
}

interface RayDef {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  isSpike?: boolean
  strokeWidth: number
  opacity: number
}

interface CrossTickDef {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  strokeWidth: number
  opacity: number
}

const THEME_ANGLES: Record<'light' | 'grey' | 'dark', number> = {
  light: 0,   // Day: 0 deg
  grey: 120,  // Dusk: 120 deg
  dark: 240,  // Night: 240 deg
}

// Module-level seeded PRNG to ensure 100% deterministic, immutable ray geometry across all renders
function generateStaticRayData() {
  const xc = 400
  const yc = 400
  const rCore = 46 // Shrunk from 74 to 46 for a refined, balanced speedbump core

  let s = 83921
  const random = () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }

  const rayList: RayDef[] = []
  const tickList: CrossTickDef[] = []
  const spokeList: RayDef[] = []

  // Add 3 prominent cardinal spikes corresponding to the 3 daytime sectors:
  // 1. Day / Helios Spike at 90 deg (shooting 380px straight down when theme is Day)
  const addThemedSpike = (id: string, angleDeg: number, length: number, strokeWidth = 2.0) => {
    // Keep max spike length inside 340px so endpoints remain well within the 800x800 viewBox (radius 386px < 400px)
    const clampedLength = Math.min(340, length)
    const rad = (angleDeg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const x1 = Number((xc + rCore * cos).toFixed(2))
    const y1 = Number((yc + rCore * sin).toFixed(2))
    const x2 = Number((xc + (rCore + clampedLength) * cos).toFixed(2))
    const y2 = Number((yc + (rCore + clampedLength) * sin).toFixed(2))

    rayList.push({
      id: `${id}-spike`,
      x1,
      y1,
      x2,
      y2,
      isSpike: true,
      strokeWidth,
      opacity: 1,
    })

    // Technical crossbar ticks along the spike
    const tickOffsets = [length * 0.28, length * 0.5, length * 0.72, length * 0.92]
    tickOffsets.forEach((offset, i) => {
      const half = 6.0 - i * 1.0
      const tx = xc + (rCore + offset) * cos
      const ty = yc + (rCore + offset) * sin
      const perpCos = -sin
      const perpSin = cos
      tickList.push({
        id: `${id}-tick-${i}`,
        x1: Number((tx - half * perpCos).toFixed(2)),
        y1: Number((ty - half * perpSin).toFixed(2)),
        x2: Number((tx + half * perpCos).toFixed(2)),
        y2: Number((ty + half * perpSin).toFixed(2)),
        strokeWidth: 1.0,
        opacity: 0.85,
      })
    })
  }

  // 12 Prominent Cardinal & Intercardinal Spikes (one every 30 degrees around the full 360-degree circle)
  const cardinalAngles = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]
  cardinalAngles.forEach(angleDeg => {
    const isMajor = angleDeg % 90 === 0
    const spikeLen = isMajor ? 335 : 285
    const strokeWidth = isMajor ? 2.2 : 1.7
    addThemedSpike(`cardinal-${angleDeg}`, angleDeg, spikeLen, strokeWidth)
  })

  // Dense array of radiating straight lines covering the FULL 360 DEGREES
  const totalRays = 132
  const angleStep = 360 / totalRays

  for (let i = 0; i < totalRays; i++) {
    const angleDeg = i * angleStep
    // Skip angles very close to prominent cardinal spikes
    if (cardinalAngles.some(ca => Math.abs(angleDeg - ca) < 1.6)) continue

    const rad = (angleDeg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)

    // Rich, well-proportioned length distribution with zero invisible stubs
    const randVal = random()
    let len: number

    if (randVal > 0.85) {
      len = 260 + random() * 80
    } else if (randVal > 0.6) {
      len = 195 + random() * 65
    } else if (randVal > 0.3) {
      len = 145 + random() * 50
    } else {
      len = 105 + random() * 40
    }

    // Add gentle organic variation while keeping rays distinctly visible
    const jitter = (random() - 0.5) * 24
    len = Math.max(90, len + jitter)

    const startR = rCore + 3 + random() * 6
    const endR = startR + len

    const x1 = Number((xc + startR * cos).toFixed(2))
    const y1 = Number((yc + startR * sin).toFixed(2))
    const x2 = Number((xc + endR * cos).toFixed(2))
    const y2 = Number((yc + endR * sin).toFixed(2))

    const strokeWidth = Number((0.75 + random() * 0.75).toFixed(2))
    const opacity = Number((0.55 + random() * 0.4).toFixed(2))

    rayList.push({
      id: `full-ray-${i}`,
      x1,
      y1,
      x2,
      y2,
      strokeWidth,
      opacity,
    })

    // Add cross-ticks on randomly chosen long rays
    if (len > 185 && random() > 0.45) {
      const tickPos = startR + len * (0.6 + random() * 0.3)
      const tx = xc + tickPos * cos
      const ty = yc + tickPos * sin
      const perpCos = -sin
      const perpSin = cos
      const half = 3 + random() * 2

      tickList.push({
        id: `full-tick-${i}`,
        x1: Number((tx - half * perpCos).toFixed(2)),
        y1: Number((ty - half * perpSin).toFixed(2)),
        x2: Number((tx + half * perpCos).toFixed(2)),
        y2: Number((ty + half * perpSin).toFixed(2)),
        strokeWidth: 0.8,
        opacity: opacity * 0.85,
      })
    }
  }

  // Radial spokes inside the full 360-degree core (every 15 deg)
  for (let deg = 0; deg < 360; deg += 15) {
    if (deg === 90 || deg === 270) continue
    const rad = (deg * Math.PI) / 180
    spokeList.push({
      id: `spoke-${deg}`,
      x1: xc,
      y1: yc,
      x2: Number((xc + rCore * Math.cos(rad)).toFixed(2)),
      y2: Number((yc + rCore * Math.sin(rad)).toFixed(2)),
      strokeWidth: deg % 30 === 0 ? 1.1 : 0.7,
      opacity: deg % 30 === 0 ? 0.75 : 0.45,
    })
  }

  return { xc, yc, rCore, rays: rayList, ticks: tickList, coreSpokes: spokeList }
}

const STATIC_SUN_DATA = generateStaticRayData()

export function ArtificialSun({
  theme = 'light',
  setTheme,
  onCycle,
  className = '',
  interactive = true,
}: ArtificialSunProps) {
  const { xc, yc, rCore, rays, ticks, coreSpokes } = useMemo(() => STATIC_SUN_DATA, [])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const wheelGroupRef = useRef<SVGGElement | null>(null)

  const themeRef = useRef(theme)
  themeRef.current = theme

  const setThemeRef = useRef(setTheme)
  setThemeRef.current = setTheme

  const onCycleRef = useRef(onCycle)
  onCycleRef.current = onCycle

  const angleRef = useRef<number>(THEME_ANGLES[theme] ?? 0)
  const velocityRef = useRef<number>(0)
  const isPointerDownRef = useRef<boolean>(false)
  const isDragConfirmedRef = useRef<boolean>(false)
  const isDraggingRef = useRef<boolean>(false)
  const dragStartPointerAngleRef = useRef<number>(0)
  const dragStartWheelAngleRef = useRef<number>(0)
  const dragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const lastPointerTimeRef = useRef<number>(0)
  const lastPointerAngleRef = useRef<number>(0)
  const currentSectorRef = useRef<'light' | 'grey' | 'dark'>(theme)
  const snappingTargetRef = useRef<number | null>(null)

  // Physics & animation loop (slow pace ambient spin + smooth programmatic ease)
  useEffect(() => {
    let raf = 0
    let lastTime = performance.now()
    let isPaused = false

    const motionQuery =
      typeof window !== 'undefined'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null
    let prefersReducedMotion = motionQuery?.matches ?? false

    const handleMotionChange = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches
    }
    motionQuery?.addEventListener?.('change', handleMotionChange)

    const handleVisibilityChange = () => {
      if (document.hidden) {
        isPaused = true
        cancelAnimationFrame(raf)
      } else {
        isPaused = false
        lastTime = performance.now()
        raf = requestAnimationFrame(tick)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    function tick(now: number) {
      if (isPaused) return
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now

      const ambientSpeed = prefersReducedMotion ? 0 : 2.4 // deg/sec slow pace ambient spin

      if (!isDraggingRef.current) {
        if (snappingTargetRef.current !== null) {
          const diff = snappingTargetRef.current - angleRef.current
          if (Math.abs(diff) < 0.2) {
            angleRef.current = snappingTargetRef.current
            snappingTargetRef.current = null
            velocityRef.current = 0
          } else {
            // Smooth ease-out into target angle
            angleRef.current += diff * Math.min(1, dt * 9)
          }
        } else if (Math.abs(velocityRef.current) > 0.1) {
          angleRef.current += velocityRef.current * dt
          velocityRef.current *= Math.pow(0.88, dt * 60)
        } else {
          angleRef.current += ambientSpeed * dt
        }
      }

      // Direct 60fps native SVG rotation around exact viewBox center (400, 400)
      if (wheelGroupRef.current) {
        wheelGroupRef.current.setAttribute(
          'transform',
          `rotate(${angleRef.current.toFixed(2)}, 400, 400)`
        )
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      motionQuery?.removeEventListener?.('change', handleMotionChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  // Sync if theme changes externally: calculate shortest path without backward flip
  useEffect(() => {
    const targetSector = THEME_ANGLES[theme] ?? 0
    const current = angleRef.current
    const norm = ((current % 360) + 360) % 360
    let diff = (targetSector - norm) % 360
    if (diff > 180) diff -= 360
    if (diff < -180) diff += 360
    snappingTargetRef.current = current + diff
    currentSectorRef.current = theme
  }, [theme])

  // Interactive Drag / Spin Gesture Handling - measure pivot dynamically from container bounding rect
  function getPointerAngle(clientX: number, clientY: number): number {
    let pivotX = 0
    let pivotY = 0
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      pivotX = rect.left + rect.width / 2
      pivotY = rect.top + rect.height / 2
    } else {
      pivotX = typeof window !== 'undefined' ? window.innerWidth / 2 : 400
      pivotY = 0
    }
    const dx = clientX - pivotX
    const dy = clientY - pivotY
    return (Math.atan2(dy, dx) * 180) / Math.PI
  }

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    isPointerDownRef.current = true
    isDragConfirmedRef.current = false
    snappingTargetRef.current = null
    velocityRef.current = 0

    const pointerAngle = getPointerAngle(e.clientX, e.clientY)
    dragStartPointerAngleRef.current = pointerAngle
    dragStartWheelAngleRef.current = angleRef.current
    lastPointerAngleRef.current = pointerAngle
    lastPointerTimeRef.current = performance.now()
    dragStartPosRef.current = { x: e.clientX, y: e.clientY }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!isPointerDownRef.current) return

    const dx = e.clientX - dragStartPosRef.current.x
    const dy = e.clientY - dragStartPosRef.current.y
    const dist = Math.hypot(dx, dy)

    // Gesture discrimination: require 6px horizontal movement to confirm spin intent
    if (!isDragConfirmedRef.current) {
      if (Math.abs(dy) > Math.abs(dx) * 1.3 && Math.abs(dy) >= 12) {
        // Vertical scroll intent: yield to vertical scrolling
        isPointerDownRef.current = false
        return
      }
      if (dist >= 6) {
        isDragConfirmedRef.current = true
        isDraggingRef.current = true
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {}
      } else {
        return
      }
    }

    const now = performance.now()
    const pointerAngle = getPointerAngle(e.clientX, e.clientY)

    let deltaAngle = pointerAngle - dragStartPointerAngleRef.current
    if (deltaAngle > 180) deltaAngle -= 360
    if (deltaAngle < -180) deltaAngle += 360

    angleRef.current = dragStartWheelAngleRef.current + deltaAngle

    const dt = Math.max(0.005, (now - lastPointerTimeRef.current) / 1000)
    let stepDelta = pointerAngle - lastPointerAngleRef.current
    if (stepDelta > 180) stepDelta -= 360
    if (stepDelta < -180) stepDelta += 360

    const instVelocity = stepDelta / dt
    velocityRef.current = velocityRef.current * 0.4 + instVelocity * 0.6

    lastPointerAngleRef.current = pointerAngle
    lastPointerTimeRef.current = now
  }

  function endDrag(e: React.PointerEvent<HTMLButtonElement>) {
    if (!isPointerDownRef.current && !isDraggingRef.current) return
    const wasConfirmedDrag = isDragConfirmedRef.current
    isPointerDownRef.current = false
    isDragConfirmedRef.current = false
    isDraggingRef.current = false

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch {}

    const dist = Math.hypot(
      e.clientX - dragStartPosRef.current.x,
      e.clientY - dragStartPosRef.current.y
    )

    // Regular click or tap: DO NOT switch theme. Only deliberate spinning (drag > 10px) switches theme!
    if (!wasConfirmedDrag || dist < 10) {
      return
    }

    // Momentum flick -> snap to nearest 120-deg daytime slot
    const projectedAngle = angleRef.current + velocityRef.current * 0.25
    const snapped = Math.round(projectedAngle / 120) * 120
    snappingTargetRef.current = snapped

    const finalNorm = ((snapped % 360) + 360) % 360
    const finalSector: 'light' | 'grey' | 'dark' =
      finalNorm >= 300 || finalNorm < 60
        ? 'light'
        : finalNorm >= 60 && finalNorm < 180
          ? 'grey'
          : 'dark'

    currentSectorRef.current = finalSector
    if (setThemeRef.current) {
      setThemeRef.current(finalSector)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const currentTh = themeRef.current
      const nextTheme: 'light' | 'grey' | 'dark' =
        currentTh === 'light' ? 'grey' : currentTh === 'grey' ? 'dark' : 'light'

      snappingTargetRef.current = angleRef.current + 120
      currentSectorRef.current = nextTheme

      if (onCycleRef.current) {
        onCycleRef.current()
      } else if (setThemeRef.current) {
        setThemeRef.current(nextTheme)
      }
    }
  }

  return (
    <>
      {/* 1. Near-invisible architectural watermark SVG: sits at z-index: 0 */}
      <div className={`artificial-sun-container ${className}`} ref={containerRef}>
        <svg
          className="artificial-sun-speedbump-svg"
          viewBox="0 0 800 800"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Full 360-degree rotating wheel group pivoting around exact center (400px, 400px) */}
          <g
            className="artificial-sun-rotating-wheel"
            ref={wheelGroupRef}
          >
            {/* Full 360-degree randomized straight rays */}
            <g className="artificial-sun-rays-group">
              {rays.map(ray => (
                <line
                  key={ray.id}
                  id={ray.id}
                  x1={ray.x1}
                  y1={ray.y1}
                  x2={ray.x2}
                  y2={ray.y2}
                  stroke="currentColor"
                  strokeWidth={ray.strokeWidth}
                  strokeLinecap="round"
                  opacity={ray.opacity}
                  className={ray.isSpike ? 'is-tall-spike' : undefined}
                />
              ))}
              {ticks.map(tick => (
                <line
                  key={tick.id}
                  x1={tick.x1}
                  y1={tick.y1}
                  x2={tick.x2}
                  y2={tick.y2}
                  stroke="currentColor"
                  strokeWidth={tick.strokeWidth}
                  strokeLinecap="round"
                  opacity={tick.opacity}
                />
              ))}
            </g>

            {/* Shrunken Full 360-degree Circular Core (rCore = 46) */}
            <g className="artificial-sun-speedbump-core">
              <circle
                cx={xc}
                cy={yc}
                r={46}
                stroke="currentColor"
                strokeWidth="1.4"
                opacity="0.85"
                fill="none"
              />
              <circle
                cx={xc}
                cy={yc}
                r={34}
                stroke="currentColor"
                strokeWidth="1.0"
                opacity="0.7"
                fill="none"
              />
              <circle
                cx={xc}
                cy={yc}
                r={20}
                stroke="currentColor"
                strokeWidth="1.1"
                opacity="0.75"
                fill="none"
              />

              {coreSpokes.map(spoke => (
                <line
                  key={spoke.id}
                  x1={spoke.x1}
                  y1={spoke.y1}
                  x2={spoke.x2}
                  y2={spoke.y2}
                  stroke="currentColor"
                  strokeWidth={spoke.strokeWidth}
                  strokeLinecap="round"
                  opacity={spoke.opacity}
                />
              ))}

              {/* Horizontal bisection diameter line through exact center */}
              <line
                x1={xc - 52}
                y1={yc}
                x2={xc + 52}
                y2={yc}
                stroke="currentColor"
                strokeWidth="1.5"
                opacity="0.85"
              />
            </g>
          </g>

          {/* Greek Daycycle Emblem: seated in visible speedbump core with silky smooth cross-fade */}
          <g className="artificial-sun-greek-daycycle-icon" aria-hidden="true">
            {/* Day (Light): Helios (Greek God of the Sun) */}
            <g className={`greek-icon-wrap greek-icon-helios ${theme === 'light' ? 'is-active' : ''}`}>
              <circle cx="400" cy="423" r="3.6" stroke="currentColor" strokeWidth="1.3" fill="none" />
              <line x1="400" y1="414" x2="400" y2="410.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="400" y1="432" x2="400" y2="435.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="391" y1="423" x2="387.5" y2="423" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="409" y1="423" x2="412.5" y2="423" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="393.8" y1="416.8" x2="391.2" y2="414.2" stroke="currentColor" strokeWidth="1.0" strokeLinecap="round" />
              <line x1="406.2" y1="416.8" x2="408.8" y2="414.2" stroke="currentColor" strokeWidth="1.0" strokeLinecap="round" />
              <line x1="393.8" y1="429.2" x2="391.2" y2="431.8" stroke="currentColor" strokeWidth="1.0" strokeLinecap="round" />
              <line x1="406.2" y1="429.2" x2="408.8" y2="431.8" stroke="currentColor" strokeWidth="1.0" strokeLinecap="round" />
            </g>

            {/* Dusk (Grey): Hesperus (Classical Greek Evening Star / Twilight) */}
            <g className={`greek-icon-wrap greek-icon-hesperus ${theme === 'grey' ? 'is-active' : ''}`}>
              <line x1="400" y1="412" x2="400" y2="434" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="389" y1="423" x2="411" y2="423" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="392.5" y1="415.5" x2="407.5" y2="430.5" stroke="currentColor" strokeWidth="1.0" strokeLinecap="round" />
              <line x1="407.5" y1="415.5" x2="392.5" y2="430.5" stroke="currentColor" strokeWidth="1.0" strokeLinecap="round" />
              <circle cx="400" cy="423" r="1.6" fill="currentColor" />
            </g>

            {/* Night (Black / OLED Dark): Selene (Greek Goddess of the Moon) */}
            <g className={`greek-icon-wrap greek-icon-selene ${theme === 'dark' ? 'is-active' : ''}`}>
              <path
                d="M 396.5 414 A 9 9 0 0 1 403.5 432 A 7.2 7.2 0 0 0 396.5 414 Z"
                fill="currentColor"
              />
              <line x1="406" y1="417" x2="406" y2="421" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
              <line x1="404" y1="419" x2="408" y2="419" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
            </g>
          </g>
        </svg>
      </div>

      {/* 2. Elevated interactive wheel spinner & theme switcher touch target over the speedbump */}
      {interactive && (
        <button
          type="button"
          className="artificial-sun-touch-target"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={handleKeyDown}
          aria-label={`Solar chronometer: Spin wheel to cycle daytime (${theme === 'light' ? 'Day (Helios)' : theme === 'grey' ? 'Dusk (Hesperus)' : 'Night (Selene)'}).`}
          title="Spin the wheel to cycle Day (Helios), Dusk (Hesperus), Night (Selene)"
        />
      )}
    </>
  )
}
