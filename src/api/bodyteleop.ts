import { makeAthenaCall } from '~/api/athena'

interface SdpAnswer {
  sdp: string
  type: string
}

export const forwardSdpOffer = (dongleId: string, sdp: string) =>
  makeAthenaCall<{ sdp: string }, SdpAnswer>(dongleId, 'forwardSdpOffer', { sdp })
