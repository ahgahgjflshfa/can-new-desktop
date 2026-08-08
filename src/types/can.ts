export type CanAccessScope = 'station' | 'region' | 'global'
export type CanRegion = 'north' | 'central' | 'south'
export type CanSystem = 'can' | 'admin'

export interface CanAuthUser {
  account: string
  name: string
  station: string | null
  accessScope: CanAccessScope
  region: CanRegion | null
  topic: string | null
  system: CanSystem
}

export interface CanLoginResponse {
  token: string
  user: CanAuthUser
}

export interface CanTask {
  serialNumber: number
  station: string
  trashBin: string
  isDone: boolean
  cleanAt: string | null
  informTime: number
  resolutionType: number
  visitorID: string | null
  isDisable: boolean
  createdAt: string
  updatedAt: string
}
