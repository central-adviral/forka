// "Aprendizado parecido": while a new hypothesis is written, the decided tests that already looked
// at the same thing, so the team does not run a test whose answer is known.

export interface Learning {
  code: string
  title: string
  learning: string
  result: string | null
}

// Words too common in test titles to say two tests are about the same thing.
const STOP = new Set(['para', 'como', 'mais', 'menos', 'pagina', 'teste', 'versao', 'nova', 'novo', 'antes', 'depois', 'acima', 'abaixo', 'sobre', 'entre', 'com', 'sem', 'das', 'dos', 'uma', 'que'])

function words(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !STOP.has(word))
  )
}

/** The decided tests sharing at least one meaningful word with the new title, most shared first. */
export function similarLearnings(title: string, learnings: Learning[], limit = 2): Learning[] {
  const wanted = words(title)
  if (wanted.size === 0) return []
  return learnings
    .map((learning) => {
      const theirs = words(`${learning.title} ${learning.learning} ${learning.result ?? ''}`)
      return { learning, shared: [...wanted].filter((word) => theirs.has(word)).length }
    })
    .filter((match) => match.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, limit)
    .map((match) => match.learning)
}
