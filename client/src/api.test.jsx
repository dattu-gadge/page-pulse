import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { StrictMode } from 'react'
import App from './App'
import { normalizeWebsiteUrl } from './api'

beforeEach(() => { vi.stubGlobal('IntersectionObserver', class { constructor(callback) { this.callback = callback } observe(target) { this.callback([{ isIntersecting: true, target }], this) } unobserve() {} disconnect() {} }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

const report = { id: 'f614075e-bb72-4ab1-9c76-29cbb58a37b1', scannedAt: new Date().toISOString(), submittedUrl: 'https://alpha.example.com', finalUrl: 'https://alpha.example.com/', status: 'completed', httpStatus: 200, score: { value: 82, breakdown: [], formula: 'Weighted average' }, scoreBreakdown: [], responseTimeMs: 120, metrics: { title: { present: true, text: 'Alpha page', characters: 10 }, description: { present: false, text: '', characters: 0 }, headings: {}, images: {}, links: {} }, issues: [], recommendations: [], limitations: [] }
function mockResponse(payload, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => payload } }

describe('website URL validation', () => {
  it('normalizes a hostname and rejects unsupported protocols or credentials', () => {
    expect(normalizeWebsiteUrl('example.com')).toBe('https://example.com/')
    expect(() => normalizeWebsiteUrl('file:///private')).toThrow('public website')
    expect(() => normalizeWebsiteUrl('https://name:secret@example.com')).toThrow('public website')
  })
})

describe('Page Pulse public and workspace flow', () => {
  it('requires sign-in for protected production workspaces and opens the session after authentication', async () => {
    let authenticated = false
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url === '/api/health') return mockResponse({ status: 'ok', version: '1.0.0', storage: 'postgres', workspace: 'authenticated', authentication: true })
      if (url === '/api/auth/session') return mockResponse({ authenticated, user: authenticated ? { id: 'user-a', email: 'audit@example.test' } : null, csrfToken: authenticated ? 'user-csrf' : 'guest-csrf' })
      if (url === '/api/auth/sign-in') { authenticated = true; expect(options.headers['X-CSRF-Token']).toBe('guest-csrf'); return mockResponse({ authenticated: true, user: { id: 'user-a', email: 'audit@example.test' }, csrfToken: 'user-csrf' }) }
      if (url === '/api/reports') return mockResponse({ reports: [report], storage: 'postgres' })
      return mockResponse(report)
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/app')
    render(<BrowserRouter><App /></BrowserRouter>)
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'audit@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-test-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByText('audit@example.test')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/reports', expect.objectContaining({ credentials: 'include' }))
  })

  it('renders the landing page with a clearly labeled illustrative sample', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ reports: [], storage: 'sqlite' })))
    render(<BrowserRouter><App /></BrowserRouter>)
    expect(screen.getByRole('heading', { name: /make every page.?work harder/i })).toBeInTheDocument()
    expect(screen.getByText(/illustrative data/i)).toBeInTheDocument()
  })

  it('submits an audit and opens its saved report', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url, options = {}) => {
      if (options.method === 'POST') return mockResponse(report, 201)
      if (url === '/api/health') return mockResponse({ status: 'ok', version: '1.0.0', storage: 'sqlite' })
      if (url === `/api/reports/${report.id}`) return mockResponse(report)
      return mockResponse({ reports: [report], storage: 'sqlite' })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BrowserRouter><App /></BrowserRouter>)
    fireEvent.change(screen.getByLabelText(/website url/i), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /analyze website/i }))
    fireEvent.click(await screen.findByRole('button', { name: /analyze this page/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/analyze', expect.objectContaining({ method: 'POST' })))
    expect(await screen.findByText(/overall seo score/i)).toBeInTheDocument()
    expect(screen.getAllByText(/alpha\.example\.com/).length).toBeGreaterThan(0)
  })

  it('opens a saved failure report when the target could not be fetched', async () => {
    const failed = { ...report, status: 'failed', finalUrl: null, httpStatus: null, responseTimeMs: null, score: { value: 0, formula: 'No score was calculated.' }, error: { code: 'ANALYSIS_FAILED', message: 'The website could not be reached or timed out.' }, metrics: {}, issues: [], scoreBreakdown: [] }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, options = {}) => {
      if (options.method === 'POST') return mockResponse({ error: failed.error, report: failed }, 422)
      if (url === '/api/health') return mockResponse({ status: 'ok', version: '1.0.0', storage: 'sqlite' })
      if (url === `/api/reports/${failed.id}`) return mockResponse(failed)
      return mockResponse({ reports: [failed], storage: 'sqlite' })
    }))
    window.history.pushState({}, '', '/app/analyze')
    render(<BrowserRouter><App /></BrowserRouter>)
    fireEvent.change(await screen.findByLabelText(/website url/i), { target: { value: 'alpha.example.com' } })
    fireEvent.click(await screen.findByRole('button', { name: /analyze this page/i }))
    expect(await screen.findByRole('heading', { name: 'Audit failed' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be reached or timed out/i)
  })

  it('shows empty states instead of fabricated dashboard values', async () => {
    window.history.pushState({}, '', '/app')
    vi.stubGlobal('fetch', vi.fn(async (url) => url === '/api/health'
      ? mockResponse({ status: 'ok', version: '1.0.0', storage: 'sqlite' })
      : mockResponse({ reports: [], storage: 'sqlite' })))
    render(<BrowserRouter><App /></BrowserRouter>)
    expect(await screen.findByText('No audit yet')).toBeInTheDocument()
    expect(screen.getByText('Available after your first scan')).toBeInTheDocument()
  })

  it('keeps the overview score SVG inside its bounded score ring', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => url === '/api/health'
      ? mockResponse({ status: 'ok', version: '1.0.0', storage: 'sqlite' })
      : mockResponse({ reports: [report], storage: 'sqlite' })))
    window.history.pushState({}, '', '/app')
    render(<BrowserRouter><App /></BrowserRouter>)

    const ring = await screen.findByRole('img', { name: 'SEO score 82 out of 100' })
    const svg = ring.querySelector('svg.score-ring-svg')
    expect(ring).toHaveStyle({ position: 'relative', width: '102px', height: '102px' })
    expect(svg).toHaveAttribute('viewBox', '0 0 100 100')
    expect(svg.parentElement).toBe(ring)
  })

  it('filters saved reports by URL text', async () => {
    window.history.pushState({}, '', '/app/reports')
    vi.stubGlobal('fetch', vi.fn(async (url) => url === '/api/health'
      ? mockResponse({ status: 'ok', version: '1.0.0', storage: 'sqlite' })
      : mockResponse({ reports: [report], storage: 'sqlite' })))
    render(<BrowserRouter><App /></BrowserRouter>)
    expect(await screen.findByText(/alpha\.example\.com/)).toBeInTheDocument()
    const search = screen.getByRole('textbox', { name: /search reports/i })
    fireEvent.change(search, { target: { value: 'not-here.test' } })
    expect(screen.getByText('No matching reports')).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'alpha' } })
    expect(screen.getByText(/alpha\.example\.com/)).toBeInTheDocument()
  })

  it('closes the workspace navigation drawer with Escape', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => url === '/api/health'
      ? mockResponse({ status: 'ok', version: '1.0.0', storage: 'sqlite' })
      : mockResponse({ reports: [], storage: 'sqlite' })))
    window.history.pushState({}, '', '/app')
    render(<BrowserRouter><App /></BrowserRouter>)

    fireEvent.click(await screen.findByRole('button', { name: 'Open menu' }))
    expect(document.querySelector('.sidebar')).toHaveClass('sidebar-open')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('.sidebar')).not.toHaveClass('sidebar-open'))
  })

  it('opens a saved report from the list using the report ID in its detail API path', async () => {
    const saved = { ...report, issues: [{ issueId: 'metadata.title-missing', title: 'Add a page title', evidence: 'No title found', suggestedFix: 'Add a title.' }] }
    const fetchMock = vi.fn(async (url) => {
      if (url === '/api/health') return mockResponse({ status: 'ok', version: '1.0.0', storage: 'sqlite' })
      if (url === '/api/reports') return mockResponse({ reports: [saved], storage: 'sqlite' })
      if (url === `/api/reports/${saved.id}`) return mockResponse(saved)
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/app/reports')
    render(<BrowserRouter><App /></BrowserRouter>)

    fireEvent.click(await screen.findByRole('link', { name: /alpha\.example\.com/i }))

    expect(await screen.findByText('Add a page title')).toBeInTheDocument()
    expect(screen.getByText('Add a title.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/reports/${saved.id}`, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('ignores the StrictMode cleanup abort and renders the succeeding report request', async () => {
    let detailRequests = 0
    const fetchMock = vi.fn((url, options = {}) => {
      if (url === '/api/health') return Promise.resolve(mockResponse({ status: 'ok', version: '1.0.0', storage: 'sqlite' }))
      if (url === '/api/reports') return Promise.resolve(mockResponse({ reports: [report], storage: 'sqlite' }))
      if (url === `/api/reports/${report.id}`) {
        detailRequests += 1
        if (detailRequests === 1) return new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
        })
        return Promise.resolve(mockResponse({ ...report, issues: [{ issueId: 'metadata.title-missing', title: 'Add a page title', evidence: 'No title found', suggestedFix: 'Add a title.' }] }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', `/app/reports/${report.id}`)
    render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)

    expect(await screen.findByText('Alpha page')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Could not load report' })).not.toBeInTheDocument()
    expect(detailRequests).toBeGreaterThanOrEqual(2)
    expect(fetchMock).toHaveBeenCalledWith(`/api/reports/${report.id}`, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('shows a not-found state for an HTTP 404 report response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/health') return mockResponse({ status: 'ok', version: '1.0.0', storage: 'sqlite' })
      if (url === '/api/reports') return mockResponse({ reports: [], storage: 'sqlite' })
      if (url === `/api/reports/${report.id}`) return mockResponse({ error: { code: 'REPORT_NOT_FOUND', message: 'No report was found for this ID.' } }, 404)
      throw new Error(`Unexpected request: ${url}`)
    }))
    window.history.pushState({}, '', `/app/reports/${report.id}`)
    render(<BrowserRouter><App /></BrowserRouter>)

    expect(await screen.findByRole('heading', { name: 'Report not found' })).toBeInTheDocument()
    expect(screen.getByText('No report was found for this ID.')).toBeInTheDocument()
  })

  it('shows a load failure rather than a not-found state for other API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/health') return mockResponse({ status: 'ok', version: '1.0.0', storage: 'sqlite' })
      if (url === '/api/reports') return mockResponse({ reports: [], storage: 'sqlite' })
      if (url === `/api/reports/${report.id}`) return mockResponse({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } }, 500)
      throw new Error(`Unexpected request: ${url}`)
    }))
    window.history.pushState({}, '', `/app/reports/${report.id}`)
    render(<BrowserRouter><App /></BrowserRouter>)

    expect(await screen.findByRole('heading', { name: 'Could not load report' })).toBeInTheDocument()
    expect(screen.getByText('The request could not be completed.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Report not found' })).not.toBeInTheDocument()
  })
})
