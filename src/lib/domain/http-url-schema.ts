import { z } from 'zod'

export const httpUrl = z.string().url().regex(/^https?:\/\//i, 'A URL deve começar com http:// ou https://')
