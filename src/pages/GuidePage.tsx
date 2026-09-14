import { useLocation } from 'react-router-dom'
import PageFrame from '../components/shell/PageFrame'
import { LocalSectionNav, LocalSectionPanel, useLocalSections } from '../components/shell/LocalSections'
import { chapterOf } from '../guide/anchors'
import CardSelector, { selectedCardId } from '../guide/CardSelector'
import { GUIDE } from '../guide/content'
import GuideCard from '../guide/GuideCard'
import type { GuideChapter, GuideChapterId } from '../guide/types'
import '../components/panels.css'
import './GuidePage.css'

// Through PageFrame like every other page (2026-09-03 shell spec §5), permanently ready: the
// guide has nothing to load. Chapters are the house tab strip (?section=), and a bare #id —
// a card or a task — resolves to its chapter through the anchor index, so a palette hit or a
// pointer task can address any anchor without naming the chapter (2026-09-14 guide spec §3.1).
// A selector chapter (Pages, Reference) shows one card at a time, the hash carrying the card
// (2026-09-15 polish spec §3).
const CHAPTERS: readonly { id: GuideChapterId; label: string }[] = GUIDE.map((chapter) => ({
  id: chapter.id,
  label: chapter.label,
}))

function SelectorChapter({ chapter }: { chapter: GuideChapter }) {
  const { hash } = useLocation()
  if (chapter.cards.length === 0) return null
  const id = selectedCardId(chapter, hash)
  const card = chapter.cards.find((c) => c.id === id) ?? chapter.cards[0]
  return (
    <>
      <CardSelector chapter={chapter} selectedId={card.id} />
      <GuideCard key={card.id} card={card} />
    </>
  )
}

export default function GuidePage() {
  const views = useLocalSections<GuideChapterId>(CHAPTERS, 'start', {
    resolveLegacy: ({ hash }) => {
      const target = hash.slice(1)
      if (!target) return null
      const chapter = chapterOf(target)
      return chapter ? { section: chapter, targetId: target } : null
    },
  })
  return (
    <div className="page guide-page">
      <PageFrame
        title="Guide"
        sections={<LocalSectionNav state={views} label="Guide chapters" />}
        resource={{ status: 'ready' }}
      >
        {GUIDE.map((chapter) => (
          <LocalSectionPanel key={chapter.id} state={views} section={chapter.id} className="card-grid">
            {chapter.selector ? (
              <SelectorChapter chapter={chapter} />
            ) : (
              chapter.cards.map((card) => <GuideCard key={card.id} card={card} />)
            )}
          </LocalSectionPanel>
        ))}
      </PageFrame>
    </div>
  )
}
