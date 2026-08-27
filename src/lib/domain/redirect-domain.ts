export type DomainStatus = 'unconfigured' | 'pending' | 'verified'

export interface ClientDomainInfo {
  customDomain: string | null
  domainStatus: DomainStatus
}

export function resolveRedirectDomain(client: ClientDomainInfo, defaultDomain: string): string {
  if (client.domainStatus === 'verified' && client.customDomain) {
    return client.customDomain
  }
  return defaultDomain
}

const EXPECTED_CNAME_TARGET = 'cname.vercel-dns.com'

export function isCnameVerified(records: string[]): boolean {
  return records.some((record) => record.toLowerCase().replace(/\.$/, '') === EXPECTED_CNAME_TARGET)
}
