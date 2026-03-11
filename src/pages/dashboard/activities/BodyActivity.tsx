import { createResource, createSignal, onCleanup, onMount, Show, type VoidComponent } from 'solid-js'
import { createStore } from 'solid-js/store'
import clsx from 'clsx'
import { A } from '@solidjs/router'

import { getDevice } from '~/api/devices'
import { getDeviceName } from '~/utils/device'
import Button from '~/components/material/Button'
import Icon from '~/components/material/Icon'
import IconButton from '~/components/material/IconButton'
import TopAppBar from '~/components/material/TopAppBar'
import { BodyTeleopConnection, type ConnectionState } from '~/utils/bodyteleop'

const glass = (bg = 'rgba(0,0,0,0.4)') => ({ background: bg, 'backdrop-filter': 'blur(8px)' }) as const

const statusDot = (s: ConnectionState) =>
  clsx('rounded-full', {
    'bg-gray-400': s === 'disconnected',
    'bg-yellow-400 animate-pulse': s === 'connecting',
    'bg-green-400': s === 'connected',
    'bg-red-400': s === 'failed',
  })

const BodyActivity: VoidComponent<{ dongleId: string }> = (props) => {
  const [device] = createResource(() => props.dongleId, getDevice)
  const deviceName = () => (device.latest ? getDeviceName(device.latest) : '')
  const isMobile = () => /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

  const [connectionState, setConnectionState] = createSignal<ConnectionState>('disconnected')
  const [batteryLevel, setBatteryLevel] = createSignal<number | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [isLandscape, setIsLandscape] = createSignal(false)

  let videoRef: HTMLVideoElement | undefined
  let audioRef: HTMLAudioElement | undefined
  let joystickAreaRef: HTMLDivElement | undefined

  const connection = new BodyTeleopConnection({
    onConnectionState: setConnectionState,
    onBatteryLevel: setBatteryLevel,
    onVideoTrack: (stream) => {
      if (videoRef) videoRef.srcObject = stream
    },
    onAudioTrack: (stream) => {
      if (audioRef) audioRef.srcObject = stream
    },
  })

  const [keys, setKeys] = createStore({ w: false, a: false, s: false, d: false })
  type WasdKey = 'w' | 'a' | 's' | 'd'
  const isWasd = (k: string): k is WasdKey => 'wasd'.includes(k)

  const setKey = (key: WasdKey, pressed: boolean) => {
    setKeys(key, pressed)
    const n = { ...keys, [key]: pressed }
    connection.setJoystick(-(n.w ? 1 : 0) + (n.s ? 1 : 0), -(n.d ? 1 : 0) + (n.a ? 1 : 0))
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    if (isWasd(k)) {
      e.preventDefault()
      setKey(k, true)
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    if (isWasd(k)) {
      e.preventDefault()
      setKey(k, false)
    }
  }

  const [thumbPos, setThumbPos] = createSignal<{ x: number; y: number } | null>(null)

  const applyJoystick = (clientX: number, clientY: number) => {
    if (!joystickAreaRef) return
    const rect = joystickAreaRef.getBoundingClientRect()
    const radius = rect.width / 2
    let dx = (clientX - rect.left - radius) / radius
    let dy = (clientY - rect.top - rect.height / 2) / radius
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > 1) {
      dx /= dist
      dy /= dist
    }
    setThumbPos({ x: dx, y: dy })
    connection.setJoystick(dy, -dx)
  }

  const resetJoystick = () => {
    setThumbPos(null)
    connection.setJoystick(0, 0)
  }

  let touchId: number | null = null
  const handleTouchStart = (e: TouchEvent) => {
    e.preventDefault()
    if (touchId !== null) return
    const t = e.changedTouches[0]
    touchId = t.identifier
    applyJoystick(t.clientX, t.clientY)
  }
  const handleTouchMove = (e: TouchEvent) => {
    e.preventDefault()
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]
      if (t.identifier === touchId) applyJoystick(t.clientX, t.clientY)
    }
  }
  const handleTouchEnd = (e: TouchEvent) => {
    e.preventDefault()
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        touchId = null
        resetJoystick()
      }
    }
  }

  let mouseDragging = false
  const handleMouseMove = (e: MouseEvent) => {
    if (mouseDragging) applyJoystick(e.clientX, e.clientY)
  }
  const handleMouseUp = () => {
    mouseDragging = false
    resetJoystick()
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }
  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault()
    mouseDragging = true
    applyJoystick(e.clientX, e.clientY)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const landscapeQuery = window.matchMedia('(orientation: landscape)')
  const onLandscapeChange = (e: MediaQueryListEvent | MediaQueryList) => setIsLandscape(e.matches)

  onMount(() => {
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    landscapeQuery.addEventListener('change', onLandscapeChange)
    setIsLandscape(landscapeQuery.matches)
  })

  onCleanup(() => {
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('keyup', onKeyUp)
    landscapeQuery.removeEventListener('change', onLandscapeChange)
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    connection.disconnect()
  })

  const handleConnect = async () => {
    setError(null)
    try {
      await connection.connect(props.dongleId)
    } catch (err) {
      setError((err as Error).message)
    }
  }
  const handleDisconnect = () => {
    setError(null)
    connection.disconnect()
  }
  const connected = () => connectionState() === 'connected'

  const thumbStyle = {
    background: 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.4), rgba(255,255,255,0.1))',
    'box-shadow': 'inset 0 1px 4px rgba(255,255,255,0.3), 0 2px 8px rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.25)',
  }

  const JoystickOverlay = () => (
    <div
      ref={joystickAreaRef}
      class="absolute bottom-4 right-4 z-10 size-32 rounded-full md:size-36"
      style={{
        background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.25), rgba(255,255,255,0.05))',
        'box-shadow': 'inset 0 0 20px rgba(255,255,255,0.1), 0 4px 20px rgba(0,0,0,0.4)',
        border: '1.5px solid rgba(255,255,255,0.2)',
        'backdrop-filter': 'blur(12px)',
        '-webkit-backdrop-filter': 'blur(12px)',
        'touch-action': 'none',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onMouseDown={handleMouseDown}
    >
      <div class="absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 bg-white/10" />
      <div class="absolute top-1/2 left-2 right-2 h-px -translate-y-1/2 bg-white/10" />
      <div class="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/30" />
      <Show
        when={thumbPos()}
        fallback={
          <div class="absolute left-1/2 top-1/2 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full md:size-14" style={thumbStyle} />
        }
      >
        {(pos) => (
          <div
            class="absolute size-12 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left,top] duration-[16ms] md:size-14"
            style={{
              left: `${50 + pos().x * 35}%`,
              top: `${50 + pos().y * 35}%`,
              ...thumbStyle,
              background: 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.6), rgba(255,255,255,0.15))',
              'box-shadow': 'inset 0 1px 4px rgba(255,255,255,0.4), 0 2px 12px rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.35)',
            }}
          />
        )}
      </Show>
    </div>
  )

  const VideoHud = () => (
    <>
      <Show when={isLandscape()}>
        <div class="absolute left-2 top-2 z-20 flex items-center gap-1">
          <A href={`/${props.dongleId}`} class="flex size-8 items-center justify-center rounded-full text-white" style={glass()}>
            <Icon name="arrow_back" size="20" />
          </A>
          <div class="rounded-full px-3 py-1 text-xs font-medium text-white" style={glass()}>
            {deviceName() || 'Body'}
          </div>
        </div>
      </Show>

      <div class="absolute right-2 top-2 z-10 flex items-center gap-2">
        <div class="flex items-center gap-1.5 rounded-full px-3 py-1" style={glass()}>
          <div class={clsx('size-1.5', statusDot(connectionState()))} />
          <span class="text-xs text-white/80">{connectionState()}</span>
        </div>
        <Show when={batteryLevel() !== null}>
          <div class="flex items-center gap-1 rounded-full px-2.5 py-1" style={glass()}>
            <Icon name="battery_full" size="20" />
            <span class="text-xs text-white/80">{batteryLevel()}%</span>
          </div>
        </Show>
      </div>

      <Show when={isLandscape() && !connected()}>
        <div class="absolute inset-0 z-10 flex items-center justify-center">
          <div class="flex flex-col items-center gap-3">
            <button
              class={clsx(
                'flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium text-white transition-all',
                connectionState() === 'connecting' && 'animate-pulse',
              )}
              style={{
                background: connectionState() === 'failed' ? 'rgba(220,38,38,0.6)' : 'rgba(255,255,255,0.15)',
                'box-shadow': '0 4px 24px rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.2)',
                'backdrop-filter': 'blur(12px)',
              }}
              onClick={connectionState() === 'connecting' ? undefined : handleConnect}
              disabled={connectionState() === 'connecting'}
            >
              <Icon name={connectionState() === 'failed' ? 'refresh' : 'wifi'} size="20" />
              {connectionState() === 'connecting' ? 'Connecting...' : connectionState() === 'failed' ? 'Retry' : 'Connect'}
            </button>
            <Show when={error()}>
              <div class="max-w-xs rounded-lg px-3 py-1.5 text-center text-xs text-red-200" style={glass('rgba(220,38,38,0.4)')}>
                {error()}
              </div>
            </Show>
            <div class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-white/60" style={glass('rgba(0,0,0,0.3)')}>
              <Icon name="info" size="20" />
              <span>Body must be powered on and in joystick mode</span>
            </div>
          </div>
        </div>
      </Show>

      <Show when={connected()}>
        <Show when={!isMobile()}>
          <div class="absolute bottom-4 left-4 z-10">
            <div class="flex flex-col items-center gap-0.5 rounded-xl p-2" style={glass('rgba(0,0,0,0.3)')}>
              <WasdKey label="W" active={keys.w} onPress={() => setKey('w', true)} onRelease={() => setKey('w', false)} />
              <div class="flex gap-0.5">
                <WasdKey label="A" active={keys.a} onPress={() => setKey('a', true)} onRelease={() => setKey('a', false)} />
                <WasdKey label="S" active={keys.s} onPress={() => setKey('s', true)} onRelease={() => setKey('s', false)} />
                <WasdKey label="D" active={keys.d} onPress={() => setKey('d', true)} onRelease={() => setKey('d', false)} />
              </div>
            </div>
          </div>
        </Show>
        <Show when={isLandscape()}>
          <div class="absolute bottom-4 left-4 z-10 md:hidden">
            <button
              class="flex size-10 items-center justify-center rounded-full text-white/70"
              style={glass('rgba(220,38,38,0.4)')}
              onClick={handleDisconnect}
            >
              <Icon name="wifi_off" size="20" />
            </button>
          </div>
        </Show>
        <div class="absolute bottom-4 left-1/2 z-10 hidden -translate-x-1/2 md:block">
          <button
            class="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium text-white/80 transition-colors hover:text-white"
            style={{ ...glass('rgba(220,38,38,0.4)'), border: '1px solid rgba(255,255,255,0.1)' }}
            onClick={handleDisconnect}
          >
            <Icon name="wifi_off" size="20" />
            Disconnect
          </button>
        </div>
        <JoystickOverlay />
      </Show>
    </>
  )

  return (
    <>
      <Show when={!isLandscape()}>
        <TopAppBar leading={<IconButton name="arrow_back" href={`/${props.dongleId}`} />}>{deviceName() || 'Body Teleop'}</TopAppBar>
      </Show>
      <div
        class={clsx(
          isLandscape() ? 'relative flex h-full items-center justify-center overflow-hidden bg-black' : 'flex flex-col gap-4 px-4 pb-4',
        )}
      >
        <div
          class={clsx('relative overflow-hidden bg-black', isLandscape() ? 'flex h-full w-full items-center justify-center' : 'rounded-lg')}
        >
          <video
            ref={videoRef}
            autoplay
            playsinline
            muted
            class={clsx(isLandscape() ? 'h-full w-full object-contain' : 'w-full')}
            style={isLandscape() ? undefined : { 'aspect-ratio': '4/3' }}
          />
          <audio ref={audioRef} autoplay />
          <VideoHud />
        </div>
        <Show when={!isLandscape() && !connected()}>
          <div class="flex items-center justify-between rounded-lg bg-surface-container-low p-3">
            <div class="flex items-center gap-2">
              <div class={clsx('size-2', statusDot(connectionState()))} />
              <span class="text-sm capitalize">{connectionState()}</span>
            </div>
            <Show when={batteryLevel() !== null}>
              <div class="flex items-center gap-1">
                <Icon name="battery_full" size="20" />
                <span class="text-sm">{batteryLevel()}%</span>
              </div>
            </Show>
          </div>
          <Show when={error()}>
            <div class="rounded-lg bg-error/10 p-3 text-sm text-error">{error()}</div>
          </Show>
          <Button
            color="primary"
            leading={<Icon name="wifi" />}
            onClick={handleConnect}
            loading={connectionState() === 'connecting'}
            disabled={connectionState() === 'connecting'}
          >
            Connect
          </Button>
        </Show>
        <Show when={!isLandscape() && connected()}>
          <Button color="error" onClick={handleDisconnect}>
            Disconnect
          </Button>
        </Show>
        <Show when={!isLandscape()}>
          <div class="flex flex-col gap-2 rounded-lg bg-surface-container-low p-3 text-xs text-on-surface-variant">
            <div class="flex items-center gap-2">
              <Icon name="info" size="20" />
              <span>The comma body must be powered on and in joystick mode to connect.</span>
            </div>
            <div class="flex items-center gap-2 md:hidden">
              <Icon name="screen_rotation_alt" size="20" />
              <span>Rotate your device to landscape for the best experience.</span>
            </div>
          </div>
        </Show>
      </div>
    </>
  )
}

const WasdKey: VoidComponent<{ label: string; active: boolean; onPress: () => void; onRelease: () => void }> = (props) => (
  <div
    class={clsx(
      'flex size-9 cursor-pointer select-none items-center justify-center rounded-md text-xs font-bold transition-colors',
      props.active ? 'bg-white/30 text-white' : 'bg-white/10 text-white/60',
    )}
    onMouseDown={props.onPress}
    onMouseUp={props.onRelease}
    onMouseLeave={() => props.active && props.onRelease()}
  >
    {props.label}
  </div>
)

export default BodyActivity
