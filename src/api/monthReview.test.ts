import { describe, expect, it } from 'vitest'
import { REVIEW_LABELS } from './monthReview'

describe('REVIEW_LABELS', () => {
  it('reads as plain language, not review-system jargon (2026-09-13 polish spec §14)', () => {
    expect(REVIEW_LABELS).toEqual({
      not_started: 'Not started',
      in_progress: 'In progress',
      ready_to_review: 'Ready to review',
      closed: 'Reviewed',
      needs_review: 'Changed since review',
      unreviewed_history: 'Not yet reviewed',
    })
  })
})
