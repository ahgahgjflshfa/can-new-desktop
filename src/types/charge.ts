export interface ChargeAuthUser {
  account: string
  name: string
  station: string
  system: 'charge'
  topic?: string
}

export interface ChargeLoginResponse {
  token: string
  user: ChargeAuthUser
}

export interface ChargeTask {
  serialNumber: number
  deviceCode: string
  station: string
  isDone: boolean
  cleanAt: string | null
  informTime: number
  isDisable: boolean
  createdAt: string
  updatedAt: string
}

export interface ChargeHttpError { status: number; message: string }
