export type SystemType = 'lma' | 'can' | 'charge'

export function isSystemType(value: unknown): value is SystemType {
  return value === 'lma' || value === 'can' || value === 'charge'
}
