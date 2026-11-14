import { createContext } from 'react'
import type { ApiMode } from './index'
import type { Api } from './types'

export const ApiContext = createContext<{ api: Api; mode: ApiMode } | null>(null)
