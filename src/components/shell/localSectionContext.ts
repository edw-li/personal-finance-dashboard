import { createContext, useContext } from 'react'

export const LocalSectionVisibility = createContext(true)
export function useLocalSectionVisible(): boolean { return useContext(LocalSectionVisibility) }
