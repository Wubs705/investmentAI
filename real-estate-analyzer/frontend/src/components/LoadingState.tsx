interface LoadingStateProps {
  steps: string[]
  stepIndex: number
}

export default function LoadingState({ steps, stepIndex }: LoadingStateProps) {
  if (!steps?.length) return null

  return (
    <div className="bg-white border border-border rounded-xl p-8 flex flex-col items-center justify-center gap-6 shadow-sm">
      <div className="w-12 h-12 rounded-full border-4 border-gray-200 border-t-primary animate-spin" />

      <div className="flex flex-col gap-2.5 w-full max-w-xs">
        {steps.slice(0, -1).map((step, i) => {
          const done = i < stepIndex
          const active = i === stepIndex
          return (
            <div key={step} className="flex items-center gap-3">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${
                  done
                    ? 'bg-accent text-white'
                    : active
                    ? 'bg-primary text-white animate-pulse'
                    : 'bg-gray-100 text-text-muted'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              <span
                className={`text-sm transition-colors ${
                  done ? 'text-text-muted line-through' : active ? 'text-primary font-medium' : 'text-text-muted'
                }`}
              >
                {step}
              </span>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-text-muted">This may take 10–20 seconds…</p>
    </div>
  )
}
