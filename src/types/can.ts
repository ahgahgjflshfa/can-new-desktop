export interface CanAuthUser {
  name: string
  station: string
  topic: string
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
