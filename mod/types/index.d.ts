export type NuuTask = { id: number; title: string; status: string; note: string }

export type NuuQuestion = {
  id: number
  question: string
  default: string
  answer: string
}

export type NuuReview = {
  kind: string
  number: number | null
  title: string
  url: string
  state: string
}

export type NuuDashboard = {
  path: string
  html: string
  project: string
  slug: string
  title: string
  summary: string
  cwd: string
  status: string
  updatedAt: number
  tasks: NuuTask[]
  questions: NuuQuestion[]
  blockers: string[]
  reviews: NuuReview[]
}

declare module 'claude-code' {
  interface PluginState {
    nuu: {
      dashboards: NuuDashboard[]
      selected: string | null
      isBandHidden: boolean
      accent: string
      everything: NuuDashboard[]
      isAll: boolean
    }
  }
}
