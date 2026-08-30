import Anthropic from '@anthropic-ai/sdk'

export function createAnthropicClient(): Anthropic {
  return new Anthropic()
}
