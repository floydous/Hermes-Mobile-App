/**
 * Curated 1-2 word dynamic spinner phrases inspired by Claude Code spinner verbs:
 * https://github.com/wynandw87/claude-code-spinner-verbs
 */
export const SPINNER_PHRASES = [
  'Handling it',
  'Cooking',
  'Almost there',
  'On it',
  'Crafting',
  'Pondering',
  'Working on it',
  'Crunching',
  'Gathering thoughts',
  'Brewing',
  'Piecing together',
  'Connecting dots',
  'Polishing',
  'Digging in',
  'Making sense',
  'Simmering',
  'Looking into it',
  'Tuning',
  'Formulating',
  'Spinning up',
  'Sharpening',
  'Untangling',
  'Synthesizing',
  'In the zone',
] as const

/**
 * Returns a randomized spinner phrase with an ellipsis ('…').
 */
export function getRandomSpinnerPhrase(): string {
  const index = Math.floor(Math.random() * SPINNER_PHRASES.length)
  return `${SPINNER_PHRASES[index]}…`
}
