import { describe, it, expect } from 'vitest'
import { isKnownBot } from './bot-filter'

describe('isKnownBot', () => {
  it('flags common search/social crawlers', () => {
    expect(isKnownBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true)
    expect(isKnownBot('facebookexternalhit/1.1')).toBe(true)
    expect(isKnownBot('Facebot')).toBe(true)
    expect(isKnownBot('meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)')).toBe(true)
    expect(isKnownBot('meta-externalfetcher/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)')).toBe(true)
    expect(isKnownBot('Mozilla/5.0 (compatible; bingbot/2.0)')).toBe(true)
    expect(isKnownBot('Slackbot-LinkExpanding 1.0')).toBe(true)
    expect(isKnownBot('SomeBot/1.0 (+http://example.com/bot)')).toBe(true)
    expect(isKnownBot('AdsBot-Google (+http://www.google.com/adsbot.html)')).toBe(true)
    expect(isKnownBot('LinkedInBot/1.0 (compatible; Mozilla/5.0)')).toBe(true)
  })

  it('flags common scripting/monitoring clients', () => {
    expect(isKnownBot('curl/8.4.0')).toBe(true)
    expect(isKnownBot('python-requests/2.31.0')).toBe(true)
    expect(isKnownBot('Mozilla/5.0 (Windows NT 10.0) HeadlessChrome/120.0.0.0')).toBe(true)
    expect(isKnownBot('Pingdom.com_bot_version_1.4')).toBe(true)
    expect(isKnownBot('UptimeRobot/2.0')).toBe(true)
  })

  it('does not flag a real browser', () => {
    expect(
      isKnownBot(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
      )
    ).toBe(false)
  })

  it('does not flag a real Android device whose name contains "bot"', () => {
    expect(
      isKnownBot('Mozilla/5.0 (Linux; Android 10; CUBOT_NOTE_S) AppleWebKit/537.36 (KHTML, like Gecko)')
    ).toBe(false)
  })

  it('treats a missing user-agent as not a known bot', () => {
    expect(isKnownBot(null)).toBe(false)
  })
})
