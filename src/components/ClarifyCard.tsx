import React, { useState } from 'react'
import { Check, ArrowRight, ChevronDown } from 'lucide-react'

export type ClarifyQuestion = {
  qid: string
  question: string
  choices?: string[] | null
  multi_select?: boolean
}

export type ClarifyRequest = {
  requestId: string
  sessionId: string
  questions: ClarifyQuestion[]
}

export type ClarifyHistoryResponse = {
  question: string
  choices_offered?: string[] | null
  status: 'answered' | 'skipped' | 'unanswered'
  user_response?: string | null
}

type Props = {
  request: ClarifyRequest
  onSubmit: (answers: Record<string, string | null>) => void
  onSkip: () => void
}

/**
 * Clean, theme-aligned bottom replacement container for Composer during clarify turns.
 * Replaces the input field and send button with an uncluttered decision UI.
 */
export const ClarifyCard: React.FC<Props> = ({ request, onSubmit, onSkip }) => {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [customText, setCustomText] = useState<Record<string, string>>({})
  const [customActive, setCustomActive] = useState<Record<string, boolean>>({})

  const totalQuestions = request.questions.length
  const currentQuestion = request.questions[currentIdx] || request.questions[0]
  if (!currentQuestion) return null

  const isMulti = Boolean(currentQuestion.multi_select)
  const choices = Array.isArray(currentQuestion.choices) ? currentQuestion.choices : []
  const selectedForQ = answers[currentQuestion.qid] || []
  const isOtherActive = customActive[currentQuestion.qid]
  const typedText = customText[currentQuestion.qid] || ''

  const handleSelectChoice = (choice: string) => {
    if (isMulti) {
      setAnswers(prev => {
        const cur = prev[currentQuestion.qid] || []
        const exists = cur.includes(choice)
        return {
          ...prev,
          [currentQuestion.qid]: exists ? cur.filter(c => c !== choice) : [...cur, choice],
        }
      })
    } else {
      setCustomActive(prev => ({ ...prev, [currentQuestion.qid]: false }))
      setAnswers(prev => ({
        ...prev,
        [currentQuestion.qid]: [choice],
      }))
    }
  }

  const handleToggleOther = () => {
    setCustomActive(prev => ({ ...prev, [currentQuestion.qid]: !prev[currentQuestion.qid] }))
    if (!isMulti) {
      setAnswers(prev => ({ ...prev, [currentQuestion.qid]: [] }))
    }
  }

  const hasCurrentAnswer = isOtherActive
    ? typedText.trim().length > 0
    : choices.length > 0
      ? selectedForQ.length > 0
      : typedText.trim().length > 0

  const handleAdvanceOrSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!hasCurrentAnswer) return

    // If there are more questions, advance to the next question
    if (currentIdx < totalQuestions - 1) {
      setCurrentIdx(prev => prev + 1)
      return
    }

    // Final question answered: build final answers payload
    const finalPayload: Record<string, string | null> = {}
    for (const q of request.questions) {
      const qOther = customActive[q.qid]
      const qTyped = (customText[q.qid] || '').trim()
      const qChoices = answers[q.qid] || []

      if (qOther && qTyped) {
        finalPayload[q.qid] = q.multi_select && qChoices.length > 0 ? [...qChoices, qTyped].join(', ') : qTyped
      } else if (qChoices.length > 0) {
        finalPayload[q.qid] = qChoices.join(', ')
      } else if (qTyped) {
        finalPayload[q.qid] = qTyped
      } else {
        finalPayload[q.qid] = null
      }
    }

    onSubmit(finalPayload)
  }

  const handleSkip = () => {
    const emptyPayload: Record<string, string | null> = {}
    for (const q of request.questions) {
      emptyPayload[q.qid] = null
    }
    onSkip()
  }

  const isLastQuestion = currentIdx === totalQuestions - 1

  return (
    <div className="clarify-bottom-container" role="region" aria-label="Clarification needed">
      <div className="clarify-top-bar">
        <div className="clarify-title-group">
          <span className="clarify-main-title">Clarification</span>
          <span className="clarify-step-badge">
            {totalQuestions > 1 ? `${currentIdx + 1} of ${totalQuestions}` : '1 of 1'}
          </span>
        </div>
      </div>

      <div className="clarify-question-title">
        {currentQuestion.question}
        {isMulti && <span className="clarify-multi-tag">Select multiple</span>}
      </div>

      <div className="clarify-options-container">
        {choices.length > 0 ? (
          <div className="clarify-choices-stack">
            {choices.map((choice) => {
              const isSelected = selectedForQ.includes(choice)
              return (
                <button
                  key={choice}
                  type="button"
                  className={`clarify-option-pill ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleSelectChoice(choice)}
                >
                  <span className="clarify-option-label">{choice}</span>
                  <span className={`clarify-check-pip ${isSelected ? 'visible' : ''}`}>
                    {isSelected && <Check size={12} strokeWidth={3} />}
                  </span>
                </button>
              )
            })}

            {/* Custom "Other" toggle */}
            <button
              type="button"
              className={`clarify-option-pill clarify-other-pill ${isOtherActive ? 'selected' : ''}`}
              onClick={handleToggleOther}
            >
              <span className="clarify-option-label">Other / Custom…</span>
              <span className={`clarify-check-pip ${isOtherActive ? 'visible' : ''}`}>
                {isOtherActive && <Check size={12} strokeWidth={3} />}
              </span>
            </button>

            {isOtherActive && (
              <form onSubmit={handleAdvanceOrSubmit} className="clarify-custom-form">
                <input
                  type="text"
                  className="clarify-custom-input"
                  placeholder="Type custom answer…"
                  value={typedText}
                  onChange={e => setCustomText(prev => ({ ...prev, [currentQuestion.qid]: e.target.value }))}
                  autoFocus
                />
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={handleAdvanceOrSubmit} className="clarify-custom-form">
            <input
              type="text"
              className="clarify-custom-input"
              placeholder="Type your response…"
              value={typedText}
              onChange={e => setCustomText(prev => ({ ...prev, [currentQuestion.qid]: e.target.value }))}
              autoFocus
            />
          </form>
        )}
      </div>

      <div className="clarify-footer-row">
        <button type="button" className="clarify-skip-btn" onClick={handleSkip}>
          Skip
        </button>
        <div className="clarify-footer-right">
          {totalQuestions > 1 && currentIdx > 0 && (
            <button
              type="button"
              className="clarify-back-step-btn"
              onClick={() => setCurrentIdx(prev => prev - 1)}
            >
              Back
            </button>
          )}
          <button
            type="button"
            className="clarify-confirm-btn"
            disabled={!hasCurrentAnswer}
            onClick={() => handleAdvanceOrSubmit()}
          >
            <span>{isLastQuestion ? 'Confirm' : 'Next'}</span>
            <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Historical clarify summary card rendered inside past transcripts.
 */
export const ClarifyHistoryCard: React.FC<{
  responses: ClarifyHistoryResponse[]
  outcome?: string
}> = ({ responses, outcome: _outcome }) => {
  const [expanded, setExpanded] = useState(false)
  if (!responses || !responses.length) return null

  const summary = responses.length === 1 && responses[0]?.user_response
    ? responses[0].user_response
    : `${responses.length} decision${responses.length > 1 ? 's' : ''}`

  return (
    <div
      className={`clarify-history-bubble ${expanded ? 'expanded' : 'collapsed'}`}
      role="region"
      aria-expanded={expanded}
    >
      <button
        type="button"
        className="clarify-history-header-btn"
        onClick={() => setExpanded(prev => !prev)}
      >
        <div className="clarify-history-summary-wrap">
          <span className="clarify-history-title">Clarification</span>
          <span className="clarify-history-preview">· {summary}</span>
        </div>
        <ChevronDown
          size={13}
          className={`clarify-history-chevron ${expanded ? 'expanded' : ''}`}
        />
      </button>

      {expanded && (
        <div className="clarify-history-list enter">
          {responses.map((item, idx) => (
            <div key={idx} className="clarify-history-item">
              <span className="clarify-history-question">{item.question}</span>
              <span className="clarify-history-answer">
                {item.status === 'answered' && item.user_response ? item.user_response : 'Skipped'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
