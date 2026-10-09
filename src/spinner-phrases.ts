/**
 * Collection 1: Initial phrases used right after the user sends a message (0 tools).
 * Reflects reading, understanding, pondering, analyzing, and early formulation.
 */
export const INITIAL_SPINNER_PHRASES = [
  'Digesting',
  'Reading prompt',
  'Pondering',
  'Gathering thoughts',
  'Analyzing',
  'Looking into it',
  'Making sense',
  'Formulating',
  'Brewing',
  'Thinking',
] as const

/**
 * Collection 2: Progressive phrases used after X tool calls have been triggered/executed.
 * Reflects deep work, synthesis, connecting information, and refinement.
 */
export const PROGRESSIVE_SPINNER_PHRASES = [
  'Connecting dots',
  'Piecing together',
  'Synthesizing',
  'Crunching',
  'Cooking',
  'Handling it',
  'Crafting',
  'Untangling',
  'Sharpening',
  'Polishing',
  'In the zone',
  'Almost there',
  'Simmering',
] as const

/**
 * Backwards-compatible union of all spinner phrases.
 */
export const SPINNER_PHRASES = [
  ...INITIAL_SPINNER_PHRASES,
  ...PROGRESSIVE_SPINNER_PHRASES,
] as const

/**
 * Returns a randomized initial spinner phrase (Collection 1) with an ellipsis ('…').
 */
export function getInitialSpinnerPhrase(): string {
  const index = Math.floor(Math.random() * INITIAL_SPINNER_PHRASES.length)
  return `${INITIAL_SPINNER_PHRASES[index]}…`
}

/**
 * Returns a randomized progressive spinner phrase (Collection 2) with an ellipsis ('…').
 */
export function getProgressiveSpinnerPhrase(current?: string): string {
  if (PROGRESSIVE_SPINNER_PHRASES.length <= 1) return `${PROGRESSIVE_SPINNER_PHRASES[0]}…`
  let phrase = PROGRESSIVE_SPINNER_PHRASES[Math.floor(Math.random() * PROGRESSIVE_SPINNER_PHRASES.length)]
  let candidate = `${phrase}…`
  let attempts = 0
  while (candidate === current && attempts < 5) {
    phrase = PROGRESSIVE_SPINNER_PHRASES[Math.floor(Math.random() * PROGRESSIVE_SPINNER_PHRASES.length)]
    candidate = `${phrase}…`
    attempts++
  }
  return candidate
}

/**
 * Generates a random tool count threshold between minTools and maxTools (default 1 to 2).
 */
export function getRandomToolThreshold(minTools = 1, maxTools = 2): number {
  return Math.floor(minTools + Math.random() * (maxTools - minTools + 1))
}

/**
 * Backward compatibility alias for initial phrase.
 */
export function getRandomSpinnerPhrase(): string {
  return getInitialSpinnerPhrase()
}
