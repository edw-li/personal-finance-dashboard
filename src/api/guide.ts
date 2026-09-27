import { api } from './client'

export interface SetupEvidence { complete: boolean; evidence: string }
export interface SetupStatus { checked_at: string; year: number; steps: Record<string, SetupEvidence> }
export const fetchSetupStatus = () => api<SetupStatus>('/guide/setup')
