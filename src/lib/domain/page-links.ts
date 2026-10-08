/** Where a page is linked: a project and, inside it, at most one front. */
export interface PageLink {
  salesFunnelId: string | null
  frontId: string | null
}

export interface LinkProject {
  id: string
  name: string
  archived: boolean
  /** Own fronts only: a mirror front cannot own a page. */
  fronts: { id: string; name: string; archived: boolean }[]
}

export interface LinkOptionGroup {
  label: string
  options: { value: string; label: string }[]
}

/** One select value carries both columns, so project and front always change together. */
export function linkValue(link: PageLink): string {
  return `${link.salesFunnelId ?? ''}|${link.salesFunnelId ? (link.frontId ?? '') : ''}`
}

export function parseLinkValue(value: string): PageLink {
  const [salesFunnelId, frontId] = value.split('|')
  return { salesFunnelId: salesFunnelId || null, frontId: (salesFunnelId && frontId) || null }
}

/** "Projeto X › Frente Y", "Projeto X (sem frente)" or "Sem projeto". */
export function linkLabel(projects: LinkProject[], link: PageLink): string {
  const project = projects.find((item) => item.id === link.salesFunnelId)
  if (!project) return 'Sem projeto'
  const front = project.fronts.find((item) => item.id === link.frontId)
  return front ? `${project.name} › ${front.name}` : `${project.name} (sem frente)`
}

/** The "Ligar a" choices: one group per live project, its project-only option first, then its live fronts. */
export function linkOptionGroups(projects: LinkProject[]): LinkOptionGroup[] {
  return projects
    .filter((project) => !project.archived)
    .map((project) => ({
      label: project.name,
      options: [
        { value: linkValue({ salesFunnelId: project.id, frontId: null }), label: `${project.name} (sem frente)` },
        ...project.fronts
          .filter((front) => !front.archived)
          .map((front) => ({ value: linkValue({ salesFunnelId: project.id, frontId: front.id }), label: `${project.name} › ${front.name}` })),
      ],
    }))
}

/**
 * The pages that "Ligar página já cadastrada" offers for a front: first the ones in no front, then the
 * ones in another front, labeled with where they are now (choosing one moves it).
 */
export function pagesToLinkToFront<P extends PageLink & { id: string; label: string }>(
  pages: P[],
  frontId: string,
  projects: LinkProject[]
): LinkOptionGroup[] {
  const loose = pages.filter((page) => page.frontId === null)
  const elsewhere = pages.filter((page) => page.frontId !== null && page.frontId !== frontId)
  return [
    { label: 'Sem frente', options: loose.map((page) => ({ value: page.id, label: `${page.label} · ${linkLabel(projects, page)}` })) },
    { label: 'Em outra frente (muda de frente)', options: elsewhere.map((page) => ({ value: page.id, label: `${page.label} · hoje em ${linkLabel(projects, page)}` })) },
  ].filter((group) => group.options.length > 0)
}
