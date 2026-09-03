import Anthropic from '@anthropic-ai/sdk'

const TIMEOUT_MS = 20000

export function createAnthropicClient(): Anthropic {
  return new Anthropic({ timeout: TIMEOUT_MS })
}
