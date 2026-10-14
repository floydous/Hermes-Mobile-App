import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { ErrorBoundary } from './components/ErrorBoundary'

describe('ErrorBoundary component and onError callback', () => {
  it('delegates caught errors to onError callback with error and errorInfo', () => {
    const onError = vi.fn()
    const error = new Error('Test crash in chat view')
    const errorInfo = { componentStack: '\n    in CrashingChild' }

    const boundary = new ErrorBoundary({
      children: React.createElement('div', null, 'content'),
      onError,
    })

    // Simulate error caught by componentDidCatch
    boundary.componentDidCatch(error, errorInfo)

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(error, errorInfo)
  })

  it('renders children when no error exists and fallback UI when state has error', () => {
    const boundary = new ErrorBoundary({
      children: React.createElement('div', { className: 'normal-child' }, 'Normal content'),
    })

    // Normal render: children
    const normalHtml = renderToString(boundary.render() as React.ReactElement)
    expect(normalHtml).toContain('normal-child')
    expect(normalHtml).toContain('Normal content')

    // Error state render: default fallback
    boundary.state = { error: new Error('Render crash') }
    const errorHtml = renderToString(boundary.render() as React.ReactElement)
    expect(errorHtml).toContain('COULD NOT DISPLAY SESSION')
    expect(errorHtml).toContain('Render crash')
    expect(errorHtml).toContain('Return to Sessions')

    // Custom fallback render
    const onCustomReset = vi.fn()
    let receivedResetFn: (() => void) | null = null
    const customBoundary = new ErrorBoundary({
      children: React.createElement('div', null, 'content'),
      onReset: onCustomReset,
      fallback: (err, resetFn) => {
        receivedResetFn = resetFn
        return React.createElement('div', { className: 'custom-fallback' }, err.message)
      },
    })
    customBoundary.setState = vi.fn((patch) => {
      customBoundary.state = typeof patch === 'function' ? patch(customBoundary.state) : patch
    })
    customBoundary.state = { error: new Error('Custom crash message') }
    const customHtml = renderToString(customBoundary.render() as React.ReactElement)
    expect(customHtml).toContain('custom-fallback')
    expect(customHtml).toContain('Custom crash message')
    expect(typeof receivedResetFn).toBe('function')

    // Invoke the custom fallback reset callback and verify state clearing and callback invocation
    receivedResetFn!()
    expect(onCustomReset).toHaveBeenCalledTimes(1)
    expect(customBoundary.setState).toHaveBeenCalledWith({ error: null })
    expect(customBoundary.state.error).toBeNull()
  })

  it('correctly updates state via getDerivedStateFromError and cleans error in reset()', () => {
    const testErr = new Error('Static derivation error')
    const derived = ErrorBoundary.getDerivedStateFromError(testErr)
    expect(derived).toEqual({ error: testErr })

    const onReset = vi.fn()
    const boundary = new ErrorBoundary({
      children: React.createElement('div', null, 'child'),
      onReset,
    })
    boundary.setState = vi.fn((patch) => {
      boundary.state = typeof patch === 'function' ? patch(boundary.state) : patch
    })
    boundary.state = { error: testErr }
    boundary.reset()

    expect(boundary.setState).toHaveBeenCalledWith({ error: null })
    expect(boundary.state.error).toBeNull()
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
