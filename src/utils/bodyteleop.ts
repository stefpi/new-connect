import { forwardSdpOffer } from '~/api/bodyteleop'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'failed'

export interface BodyTeleopCallbacks {
  onConnectionState: (state: ConnectionState) => void
  onBatteryLevel: (level: number) => void
  onVideoTrack: (stream: MediaStream) => void
  onAudioTrack: (stream: MediaStream) => void
}

export class BodyTeleopConnection {
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private joystickInterval: ReturnType<typeof setInterval> | null = null
  private joystickX = 0
  private joystickY = 0
  private callbacks: BodyTeleopCallbacks

  constructor(callbacks: BodyTeleopCallbacks) {
    this.callbacks = callbacks
  }

  async connect(dongleId: string): Promise<void> {
    this.callbacks.onConnectionState('connecting')
    try {
      this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })

      this.pc.addEventListener('track', (evt) => {
        if (evt.track.kind === 'video') this.callbacks.onVideoTrack(evt.streams[0])
        else if (evt.track.kind === 'audio') this.callbacks.onAudioTrack(evt.streams[0])
      })

      this.pc.addEventListener('connectionstatechange', () => {
        if (!this.pc) return
        const state = this.pc.connectionState
        if (state === 'connected') this.callbacks.onConnectionState('connected')
        else if (state === 'failed' || state === 'closed') this.callbacks.onConnectionState('failed')
      })

      this.dc = this.pc.createDataChannel('data', { ordered: true })
      this.dc.onopen = () => {
        this.joystickInterval = setInterval(() => this.sendJoystick(), 50)
        this.sendJoystick()
      }
      this.dc.onclose = () => {
        if (this.joystickInterval) {
          clearInterval(this.joystickInterval)
          this.joystickInterval = null
        }
      }
      this.dc.onmessage = (evt) => {
        try {
          const msg = JSON.parse(typeof evt.data === 'string' ? evt.data : new TextDecoder().decode(evt.data))
          if (msg.type === 'carState') this.callbacks.onBatteryLevel(Math.round(msg.data.fuelGauge * 100))
        } catch {
          /* ignore */
        }
      }

      const offer = await this.pc.createOffer({ offerToReceiveVideo: true })
      await this.pc.setLocalDescription(offer)

      await new Promise<void>((resolve) => {
        if (this.pc!.iceGatheringState === 'complete') return resolve()
        const check = () => {
          if (this.pc!.iceGatheringState === 'complete') {
            this.pc!.removeEventListener('icegatheringstatechange', check)
            resolve()
          }
        }
        this.pc!.addEventListener('icegatheringstatechange', check)
      })

      const resp = await forwardSdpOffer(dongleId, this.pc.localDescription!.sdp)
      if (resp.error || resp.queued || !resp.result) {
        throw new Error(resp.queued ? 'Device offline' : resp.error || 'No response')
      }
      await this.pc.setRemoteDescription({ type: 'answer', sdp: resp.result.sdp })
    } catch (err) {
      this.cleanup()
      this.callbacks.onConnectionState('failed')
      throw err
    }
  }

  setJoystick(x: number, y: number): void {
    this.joystickX = x
    this.joystickY = y
  }

  private sendJoystick(): void {
    if (this.dc?.readyState === 'open') {
      this.dc.send(JSON.stringify({ type: 'testJoystick', data: { axes: [this.joystickX, this.joystickY], buttons: [false] } }))
    }
  }

  disconnect(): void {
    this.cleanup()
    this.callbacks.onConnectionState('disconnected')
  }

  private cleanup(): void {
    if (this.joystickInterval) {
      clearInterval(this.joystickInterval)
      this.joystickInterval = null
    }
    if (this.dc) {
      this.dc.close()
      this.dc = null
    }
    if (this.pc) {
      this.pc.getTransceivers?.().forEach((t) => {
        t.stop?.()
      })
      this.pc.getSenders().forEach((s) => {
        s.track?.stop()
      })
      this.pc.close()
      this.pc = null
    }
  }
}
