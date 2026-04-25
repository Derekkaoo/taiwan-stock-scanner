import type { CompanyProfile } from '../types'

interface Props {
  profile?: CompanyProfile
}

export function CompanyProfilePanel({ profile }: Props) {
  if (!profile?.business) return null

  return (
    <details className="group">
      <summary
        className="cursor-pointer list-none select-none"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <span className="text-[11px] inline-flex items-center gap-1">
          <span
            className="inline-block transition-transform duration-200 group-open:rotate-90"
            style={{ fontSize: 10 }}
          >
            ▶
          </span>
          主要經營業務
        </span>
      </summary>
      <div
        className="text-xs leading-relaxed whitespace-pre-line break-words mt-1.5"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {profile.business}
      </div>
    </details>
  )
}
