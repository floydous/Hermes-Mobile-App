import { describe, expect, it } from 'vitest'
import { describeSchedule, runLabel } from './components/TasksView'

describe('task schedule wording', () => {
  it('describes the cadences the app and the gateway produce', () => {
    expect(describeSchedule('0 23 * * *')).toBe('Every day')
    expect(describeSchedule('0 9 * * 1-5')).toBe('Weekdays')
    expect(describeSchedule('0 9 * * 0,6')).toBe('Weekends')
    expect(describeSchedule('30 8 * * 1')).toBe('Every Monday')
    expect(describeSchedule('0 9 * * 7')).toBe('Every Sunday')
    expect(describeSchedule('0 * * * *')).toBe('Every hour')
    expect(describeSchedule('*/15 * * * *')).toBe('Every 15 minutes')
    expect(describeSchedule('0 */6 * * *')).toBe('Every 6 hours')
    expect(describeSchedule('every 1440m')).toBe('Every day')
    expect(describeSchedule('every 90m')).toBe('Every 90 minutes')
    expect(describeSchedule('every 2h')).toBe('Every 2 hours')
    expect(describeSchedule('every 3 days')).toBe('Every 3 days')
  })

  it('shows anything it does not understand exactly as written', () => {
    expect(describeSchedule('0 9 1 * *')).toBe('0 9 1 * *')
    expect(describeSchedule('weekdays at 9am')).toBe('weekdays at 9am')
    expect(describeSchedule('every 0m')).toBe('every 0m')
    expect(describeSchedule(undefined)).toBe('No schedule')
  })

  it('names nearby runs relative to today and leaves the rest as dates', () => {
    const now = new Date(2026, 9, 30, 15, 0)
    const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).valueOf() / 1000
    expect(runLabel(at(30, 18), now)).toMatch(/^Today, /)
    expect(runLabel(at(31, 0), now)).toMatch(/^Tomorrow, /)
    expect(runLabel(at(29, 9), now)).toMatch(/^Yesterday, /)
    expect(runLabel(at(25, 9), now)).not.toMatch(/^(Today|Tomorrow|Yesterday)/)
    expect(runLabel(undefined, now)).toBe('—')
  })
})
