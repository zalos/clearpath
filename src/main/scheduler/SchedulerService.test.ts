import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Shared store data via globalThis (same reference across scopes) ──────────

const STORE_KEY = '__schedulerTestStoreData' as const
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any)[STORE_KEY] = {} as Record<string, unknown>

// ── vi.hoisted mocks ────────────────────────────────────────────────────────

const {
  mockSchedule,
  mockValidate,
  mockRandomUUID,
  mockSpawnSubAgent,
  mockListSubAgents,
  mockGetSubAgentOutput,
  mockNotificationEmit,
} = vi.hoisted(() => ({
  mockSchedule: vi.fn(),
  mockValidate: vi.fn(),
  mockRandomUUID: vi.fn(),
  mockSpawnSubAgent: vi.fn(),
  mockListSubAgents: vi.fn(),
  mockGetSubAgentOutput: vi.fn(),
  mockNotificationEmit: vi.fn(),
}))

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('node-cron', () => ({
  default: { schedule: mockSchedule, validate: mockValidate },
  schedule: mockSchedule,
  validate: mockValidate,
}))

vi.mock('crypto', () => ({
  randomUUID: mockRandomUUID,
}))

vi.mock('electron-store', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sd = (globalThis as any)['__schedulerTestStoreData'] as Record<string, unknown>
  return {
    default: class MockStore {
      constructor(opts?: { defaults?: Record<string, unknown> }) {
        if (opts?.defaults) {
          for (const [k, v] of Object.entries(opts.defaults)) {
            if (!(k in sd)) {
              sd[k] = JSON.parse(JSON.stringify(v))
            }
          }
        }
      }

      get(key: string): unknown {
        const val = sd[key]
        return val !== undefined ? JSON.parse(JSON.stringify(val)) : undefined
      }

      set(key: string, value: unknown): void {
        sd[key] = JSON.parse(JSON.stringify(value))
      }

      has(key: string): boolean {
        return key in sd
      }

      delete(key: string): void {
        delete sd[key]
      }
    },
  }
})

vi.mock('../utils/storeEncryption', () => ({
  getStoreEncryptionKey: () => 'test-encryption-key',
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const storeData = (globalThis as any)[STORE_KEY] as Record<string, unknown>

// ── Import types + dynamic import helper ─────────────────────────────────────

import type { ScheduledJob, JobExecution } from './SchedulerService'

let SchedulerService: typeof import('./SchedulerService').SchedulerService
let SCHEDULE_TEMPLATES: typeof import('./SchedulerService').SCHEDULE_TEMPLATES

async function loadModule(): Promise<void> {
  vi.resetModules()
  // Re-seed store defaults before import triggers module-level `new Store`
  if (!storeData.jobs) storeData.jobs = []
  const mod = await import('./SchedulerService')
  SchedulerService = mod.SchedulerService
  SCHEDULE_TEMPLATES = mod.SCHEDULE_TEMPLATES
}

// ── Factories ────────────────────────────────────────────────────────────────

let uuidCounter = 0

function nextUUID(): string {
  uuidCounter++
  return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, '0')}`
}

function makeJob(overrides?: Partial<ScheduledJob>): ScheduledJob {
  return {
    id: 'job-1',
    name: 'Test Job',
    description: 'A test scheduled job',
    prompt: 'Run tests',
    cronExpression: '0 0 * * *',
    cli: 'copilot',
    flags: {},
    enabled: true,
    createdAt: 1000,
    executions: [],
    ...overrides,
  }
}

function makeCLIManager(): any {
  return {
    spawnSubAgent: mockSpawnSubAgent,
    listSubAgents: mockListSubAgents,
    getSubAgentOutput: mockGetSubAgentOutput,
  }
}

function makeNotificationManager(): any {
  return {
    emit: mockNotificationEmit,
  }
}

function createService(cliMgr?: any, notifMgr?: any): InstanceType<typeof SchedulerService> {
  return new SchedulerService(cliMgr ?? makeCLIManager(), notifMgr ?? makeNotificationManager())
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(async () => {
  // Reset store
  for (const key of Object.keys(storeData)) delete storeData[key]
  storeData.jobs = []

  // Reset mocks
  uuidCounter = 0
  mockRandomUUID.mockImplementation(nextUUID)
  mockValidate.mockReturnValue(true)
  mockSchedule.mockReturnValue({ stop: vi.fn() })
  mockSpawnSubAgent.mockResolvedValue({ id: 'agent-1' })
  mockListSubAgents.mockReturnValue([])
  mockGetSubAgentOutput.mockReturnValue([])
  mockNotificationEmit.mockReset()

  await loadModule()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('SchedulerService', () => {
  // ── CRUD: saveJob ────────────────────────────────────────────────────────

  describe('saveJob()', () => {
    it('creates a new job with generated id and createdAt', () => {
      const svc = createService()
      const saved = svc.saveJob({
        name: 'My Job',
        description: 'desc',
        prompt: 'do stuff',
        cronExpression: '0 0 * * *',
        cli: 'copilot',
        flags: {},
        enabled: false,
      })

      expect(saved.id).toBe('00000000-0000-0000-0000-000000000001')
      expect(saved.name).toBe('My Job')
      expect(saved.createdAt).toBeGreaterThan(0)
      expect(saved.executions).toEqual([])

      const stored = storeData.jobs as ScheduledJob[]
      expect(stored).toHaveLength(1)
      expect(stored[0].id).toBe(saved.id)
    })

    it('updates an existing job preserving createdAt and executions', () => {
      const existing = makeJob({
        id: 'existing-1',
        createdAt: 5000,
        executions: [
          { id: 'exec-1', startedAt: 6000, output: 'ok', status: 'success' },
        ],
      })
      storeData.jobs = [existing]

      const svc = createService()
      const updated = svc.saveJob({
        id: 'existing-1',
        name: 'Updated Name',
        description: 'new desc',
        prompt: 'new prompt',
        cronExpression: '0 9 * * 1',
        cli: 'claude',
        flags: { verbose: true },
        enabled: true,
      })

      expect(updated.id).toBe('existing-1')
      expect(updated.name).toBe('Updated Name')
      expect(updated.createdAt).toBe(5000) // preserved
      expect(updated.executions).toHaveLength(1) // preserved
      expect(updated.executions[0].id).toBe('exec-1')
    })

    it('registers cron task when job is enabled', () => {
      const svc = createService()
      mockSchedule.mockClear()

      svc.saveJob({
        name: 'Enabled Job',
        description: '',
        prompt: 'hello',
        cronExpression: '0 0 * * *',
        cli: 'copilot',
        flags: {},
        enabled: true,
      })

      expect(mockSchedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function))
    })

    it('unregisters cron task when job is disabled', () => {
      const mockStop = vi.fn()
      mockSchedule.mockReturnValue({ stop: mockStop })

      const svc = createService()

      // First save enabled
      const job = svc.saveJob({
        name: 'Toggle Job',
        description: '',
        prompt: 'hello',
        cronExpression: '0 0 * * *',
        cli: 'copilot',
        flags: {},
        enabled: true,
      })

      // Then update disabled
      svc.saveJob({
        ...job,
        enabled: false,
      })

      expect(mockStop).toHaveBeenCalled()
    })

    it('does not register cron for invalid expression', () => {
      mockValidate.mockReturnValue(false)
      const svc = createService()
      mockSchedule.mockClear()

      svc.saveJob({
        name: 'Bad Cron',
        description: '',
        prompt: 'hello',
        cronExpression: 'not-valid',
        cli: 'copilot',
        flags: {},
        enabled: true,
      })

      expect(mockSchedule).not.toHaveBeenCalled()
    })
  })

  // ── CRUD: deleteJob ──────────────────────────────────────────────────────

  describe('deleteJob()', () => {
    it('removes job from store', () => {
      storeData.jobs = [makeJob({ id: 'del-1' }), makeJob({ id: 'del-2', name: 'Keep' })]
      const svc = createService()

      svc.deleteJob('del-1')

      const stored = storeData.jobs as ScheduledJob[]
      expect(stored).toHaveLength(1)
      expect(stored[0].id).toBe('del-2')
    })

    it('stops cron task when deleting', () => {
      const mockStop = vi.fn()
      mockSchedule.mockReturnValue({ stop: mockStop })

      const svc = createService()
      const job = svc.saveJob({
        name: 'Will Delete',
        description: '',
        prompt: 'hello',
        cronExpression: '0 0 * * *',
        cli: 'copilot',
        flags: {},
        enabled: true,
      })

      svc.deleteJob(job.id)
      expect(mockStop).toHaveBeenCalled()
    })

    it('handles deleting non-existent job gracefully', () => {
      storeData.jobs = []
      const svc = createService()

      expect(() => svc.deleteJob('nonexistent')).not.toThrow()
    })
  })

  // ── CRUD: listJobs / getJob ──────────────────────────────────────────────

  describe('listJobs() / getJob()', () => {
    it('returns all jobs from store', () => {
      storeData.jobs = [makeJob({ id: 'a' }), makeJob({ id: 'b' })]
      const svc = createService()

      const jobs = svc.listJobs()
      expect(jobs).toHaveLength(2)
    })

    it('returns specific job by id', () => {
      storeData.jobs = [makeJob({ id: 'target', name: 'Target Job' })]
      const svc = createService()

      const job = svc.getJob('target')
      expect(job).not.toBeNull()
      expect(job!.name).toBe('Target Job')
    })

    it('returns null for missing job', () => {
      storeData.jobs = []
      const svc = createService()

      expect(svc.getJob('nope')).toBeNull()
    })
  })

  // ── toggleJob ────────────────────────────────────────────────────────────

  describe('toggleJob()', () => {
    it('enables a disabled job and registers cron', () => {
      const job = makeJob({ id: 'toggle-1', enabled: false })
      storeData.jobs = [job]
      mockSchedule.mockClear()

      const svc = createService()
      svc.toggleJob('toggle-1', true)

      const stored = (storeData.jobs as ScheduledJob[])[0]
      expect(stored.enabled).toBe(true)
      expect(mockSchedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function))
    })

    it('disables an enabled job and unregisters cron', () => {
      const mockStop = vi.fn()
      mockSchedule.mockReturnValue({ stop: mockStop })

      const job = makeJob({ id: 'toggle-2', enabled: true })
      storeData.jobs = [job]

      const svc = createService()
      // first register via toggle or start
      svc.toggleJob('toggle-2', true) // registers the task
      svc.toggleJob('toggle-2', false)

      const stored = (storeData.jobs as ScheduledJob[])[0]
      expect(stored.enabled).toBe(false)
      expect(mockStop).toHaveBeenCalled()
    })

    it('does nothing for non-existent job', () => {
      storeData.jobs = []
      const svc = createService()

      expect(() => svc.toggleJob('nope', true)).not.toThrow()
    })
  })

  // ── duplicateJob ─────────────────────────────────────────────────────────

  describe('duplicateJob()', () => {
    it('creates a copy with (copy) suffix and disabled', () => {
      storeData.jobs = [makeJob({ id: 'orig', name: 'Original', enabled: true })]
      const svc = createService()

      const dup = svc.duplicateJob('orig')
      expect(dup).not.toBeNull()
      expect(dup!.name).toBe('Original (copy)')
      expect(dup!.enabled).toBe(false)
      expect(dup!.id).not.toBe('orig') // new id

      const stored = storeData.jobs as ScheduledJob[]
      expect(stored).toHaveLength(2)
    })

    it('returns null for non-existent job', () => {
      storeData.jobs = []
      const svc = createService()

      expect(svc.duplicateJob('nope')).toBeNull()
    })

    it('duplicate has fresh executions array', () => {
      storeData.jobs = [
        makeJob({
          id: 'with-execs',
          executions: [
            { id: 'e1', startedAt: 1000, output: 'done', status: 'success' },
          ],
        }),
      ]
      const svc = createService()

      const dup = svc.duplicateJob('with-execs')
      expect(dup!.executions).toEqual([])
    })
  })

  // ── getTemplates ─────────────────────────────────────────────────────────

  describe('getTemplates()', () => {
    it('returns built-in templates', () => {
      const svc = createService()
      const templates = svc.getTemplates()

      expect(templates.length).toBe(5)
    })

    it('includes expected template names', () => {
      const svc = createService()
      const names = svc.getTemplates().map((t) => t.name)

      expect(names).toContain('Nightly Test Runner')
      expect(names).toContain('Weekly Security Audit')
      expect(names).toContain('Daily Dependency Check')
      expect(names).toContain('Friday Documentation Update')
      expect(names).toContain('Hourly Build Verification')
    })

    it('each template has required fields', () => {
      const svc = createService()
      for (const t of svc.getTemplates()) {
        expect(t.name).toBeTruthy()
        expect(t.description).toBeTruthy()
        expect(t.prompt).toBeTruthy()
        expect(t.cronExpression).toBeTruthy()
        expect(t.cli).toBeTruthy()
        expect(typeof t.enabled).toBe('boolean')
      }
    })
  })

  // ── start / stop lifecycle ───────────────────────────────────────────────

  describe('start() / stop()', () => {
    it('registers cron tasks for all enabled jobs on start', () => {
      storeData.jobs = [
        makeJob({ id: 'e1', enabled: true, cronExpression: '0 0 * * *' }),
        makeJob({ id: 'e2', enabled: true, cronExpression: '0 9 * * 1' }),
        makeJob({ id: 'd1', enabled: false }),
      ]
      mockSchedule.mockClear()

      const svc = createService()
      svc.start()

      // 2 enabled jobs scheduled
      expect(mockSchedule).toHaveBeenCalledTimes(2)
    })

    it('stop() stops all registered cron tasks and clears the map', () => {
      const mockStop1 = vi.fn()
      const mockStop2 = vi.fn()
      let callCount = 0
      mockSchedule.mockImplementation(() => {
        callCount++
        return { stop: callCount === 1 ? mockStop1 : mockStop2 }
      })

      storeData.jobs = [
        makeJob({ id: 's1', enabled: true }),
        makeJob({ id: 's2', enabled: true }),
      ]

      const svc = createService()
      svc.start()
      svc.stop()

      expect(mockStop1).toHaveBeenCalled()
      expect(mockStop2).toHaveBeenCalled()
    })

    it('start() skips jobs with invalid cron expressions', () => {
      mockValidate.mockImplementation((expr: string) => expr !== 'bad-cron')
      storeData.jobs = [
        makeJob({ id: 'good', enabled: true, cronExpression: '0 0 * * *' }),
        makeJob({ id: 'bad', enabled: true, cronExpression: 'bad-cron' }),
      ]
      mockSchedule.mockClear()

      const svc = createService()
      svc.start()

      expect(mockSchedule).toHaveBeenCalledTimes(1)
      expect(mockSchedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function))
    })
  })

  // ── executeJob ───────────────────────────────────────────────────────────

  describe('executeJob()', () => {
    it('returns null for non-existent job', async () => {
      storeData.jobs = []
      const svc = createService()

      const result = await svc.executeJob('nonexistent')
      expect(result).toBeNull()
    })

    it('spawns a sub-agent with job configuration', async () => {
      storeData.jobs = [
        makeJob({
          id: 'exec-1',
          name: 'Build Job',
          prompt: 'run build',
          cli: 'claude',
          model: 'opus',
          workingDirectory: '/tmp/project',
          permissionMode: 'plan',
          maxBudget: 5,
          maxTurns: 10,
        }),
      ]

      // Sub-agent completes immediately
      mockListSubAgents.mockReturnValue([{ id: 'agent-1', status: 'completed' }])
      mockGetSubAgentOutput.mockReturnValue([{ content: 'Build succeeded' }])

      const svc = createService()
      const result = await svc.executeJob('exec-1')

      expect(mockSpawnSubAgent).toHaveBeenCalledWith({
        name: 'Scheduled: Build Job',
        cli: 'claude',
        prompt: 'run build',
        model: 'opus',
        workingDirectory: '/tmp/project',
        permissionMode: 'plan',
        maxBudget: 5,
        maxTurns: 10,
      })

      expect(result).not.toBeNull()
      expect(result!.output).toBe('Build succeeded')
    })

    it('records execution in job history', async () => {
      storeData.jobs = [makeJob({ id: 'hist-1' })]
      mockListSubAgents.mockReturnValue([{ id: 'agent-1', status: 'completed' }])
      mockGetSubAgentOutput.mockReturnValue([{ content: 'done' }])

      const svc = createService()
      await svc.executeJob('hist-1')

      const stored = storeData.jobs as ScheduledJob[]
      expect(stored[0].executions).toHaveLength(1)
      expect(stored[0].executions[0].status).not.toBe('running')
    })

    it('handles job execution failure', async () => {
      storeData.jobs = [makeJob({ id: 'fail-1' })]
      mockSpawnSubAgent.mockRejectedValue(new Error('CLI not found'))

      const svc = createService()
      const result = await svc.executeJob('fail-1')

      expect(result).not.toBeNull()
      expect(result!.status).toBe('failed')
      expect(result!.output).toContain('CLI not found')
    })

    it('emits notification on successful execution', async () => {
      storeData.jobs = [makeJob({ id: 'notif-1', name: 'Notif Job' })]
      mockListSubAgents.mockReturnValue([{ id: 'agent-1', status: 'success' }])
      mockGetSubAgentOutput.mockReturnValue([{ content: 'ok' }])

      const svc = createService()
      await svc.executeJob('notif-1')

      expect(mockNotificationEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'schedule-result',
          severity: 'info',
          title: 'Notif Job completed',
          source: 'scheduler',
        })
      )
    })

    it('emits warning notification on failed execution', async () => {
      storeData.jobs = [makeJob({ id: 'notif-2', name: 'Fail Job' })]
      mockListSubAgents.mockReturnValue([{ id: 'agent-1', status: 'failed' }])
      mockGetSubAgentOutput.mockReturnValue([{ content: 'error' }])

      const svc = createService()
      await svc.executeJob('notif-2')

      expect(mockNotificationEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'schedule-result',
          severity: 'warning',
          title: 'Fail Job failed',
        })
      )
    })

    it('caps executions at 50 per job', async () => {
      const executions: JobExecution[] = Array.from({ length: 50 }, (_, i) => ({
        id: `old-exec-${i}`,
        startedAt: 1000 + i,
        output: `run ${i}`,
        status: 'success' as const,
      }))

      storeData.jobs = [makeJob({ id: 'cap-1', executions })]
      mockListSubAgents.mockReturnValue([{ id: 'agent-1', status: 'completed' }])
      mockGetSubAgentOutput.mockReturnValue([{ content: 'newest' }])

      const svc = createService()
      await svc.executeJob('cap-1')

      const stored = storeData.jobs as ScheduledJob[]
      // Should still be 50 (spliced the oldest)
      expect(stored[0].executions.length).toBeLessThanOrEqual(50)
    })

    it('truncates output to 50KB', async () => {
      storeData.jobs = [makeJob({ id: 'big-1' })]
      const bigOutput = 'x'.repeat(100_000)
      mockListSubAgents.mockReturnValue([{ id: 'agent-1', status: 'completed' }])
      mockGetSubAgentOutput.mockReturnValue([{ content: bigOutput }])

      const svc = createService()
      const result = await svc.executeJob('big-1')

      expect(result!.output.length).toBeLessThanOrEqual(50_000)
    })

    it('handles timeout when sub-agent runs too long', async () => {
      storeData.jobs = [makeJob({ id: 'timeout-1' })]
      // Sub-agent always "running" — but we need to avoid actual 10-min wait
      mockListSubAgents.mockReturnValue([{ id: 'agent-1', status: 'running' }])
      mockGetSubAgentOutput.mockReturnValue([])

      // Replace setTimeout to speed up the polling loop
      vi.useFakeTimers({ shouldAdvanceTime: true })

      const svc = createService()
      const execPromise = svc.executeJob('timeout-1')

      // Fast-forward past the 10 minute timeout
      // The polling loop sleeps 2s each iteration, up to 600s
      // We need to advance past 600_000 ms total
      await vi.advanceTimersByTimeAsync(610_000)

      const result = await execPromise
      expect(result).not.toBeNull()
      expect(result!.status).toBe('timeout')

      vi.useRealTimers()
    })

    it('updates lastRunAt on the job', async () => {
      storeData.jobs = [makeJob({ id: 'lr-1', lastRunAt: undefined })]
      mockListSubAgents.mockReturnValue([{ id: 'agent-1', status: 'completed' }])
      mockGetSubAgentOutput.mockReturnValue([])

      const before = Date.now()
      const svc = createService()
      await svc.executeJob('lr-1')

      const stored = storeData.jobs as ScheduledJob[]
      expect(stored[0].lastRunAt).toBeGreaterThanOrEqual(before)
    })
  })

  // ── checkMissedRuns (called via start()) ─────────────────────────────────

  describe('checkMissedRuns()', () => {
    it('detects a missed daily job', () => {
      const twoDaysAgo = Date.now() - 2 * 86_400_000 - 1000
      storeData.jobs = [
        makeJob({
          id: 'missed-1',
          name: 'Daily Task',
          enabled: true,
          lastRunAt: twoDaysAgo,
          cronExpression: '0 0 * * *', // daily
        }),
      ]

      const svc = createService()
      svc.start()

      const stored = storeData.jobs as ScheduledJob[]
      const missedExecs = stored[0].executions.filter((e) => e.status === 'missed')
      expect(missedExecs).toHaveLength(1)
      expect(missedExecs[0].output).toContain('App was closed')
    })

    it('emits notification for missed run', () => {
      const twoDaysAgo = Date.now() - 2 * 86_400_000 - 1000
      storeData.jobs = [
        makeJob({
          id: 'missed-n1',
          name: 'Notify Missed',
          enabled: true,
          lastRunAt: twoDaysAgo,
          cronExpression: '0 0 * * *',
        }),
      ]

      const svc = createService()
      svc.start()

      expect(mockNotificationEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'schedule-result',
          severity: 'warning',
          title: 'Missed run: Notify Missed',
        })
      )
    })

    it('does not flag jobs without lastRunAt', () => {
      storeData.jobs = [
        makeJob({ id: 'no-lr', enabled: true, lastRunAt: undefined }),
      ]

      const svc = createService()
      svc.start()

      const stored = storeData.jobs as ScheduledJob[]
      expect(stored[0].executions).toHaveLength(0)
    })

    it('does not flag disabled jobs', () => {
      const twoDaysAgo = Date.now() - 2 * 86_400_000 - 1000
      storeData.jobs = [
        makeJob({ id: 'disabled-1', enabled: false, lastRunAt: twoDaysAgo }),
      ]

      const svc = createService()
      svc.start()

      const stored = storeData.jobs as ScheduledJob[]
      expect(stored[0].executions).toHaveLength(0)
    })

    it('does not flag a job that ran recently', () => {
      const oneHourAgo = Date.now() - 3_600_000
      storeData.jobs = [
        makeJob({
          id: 'recent-1',
          enabled: true,
          lastRunAt: oneHourAgo,
          cronExpression: '0 0 * * *', // daily — one hour ago is within 2× daily
        }),
      ]

      const svc = createService()
      svc.start()

      const stored = storeData.jobs as ScheduledJob[]
      expect(stored[0].executions).toHaveLength(0)
    })
  })

  // ── estimateIntervalMs (tested via checkMissedRuns) ──────────────────────

  describe('estimateIntervalMs() — via checkMissedRuns', () => {
    // Helper: set a job with a specific cron and lastRunAt far enough in the past,
    // then observe whether a missed run is detected (interval × 2 threshold).
    //
    // If interval = X, setting lastRunAt = now - (2*X + 1000) should flag a miss.
    // If interval = X, setting lastRunAt = now - (X + 1000) should NOT flag.

    function testIntervalDetection(
      cronExpr: string,
      expectedIntervalMs: number,
      description: string
    ): void {
      it(`${description}: detects missed when beyond 2× interval`, () => {
        const lastRunAt = Date.now() - expectedIntervalMs * 2 - 5000
        storeData.jobs = [
          makeJob({ id: 'iv-test', enabled: true, lastRunAt, cronExpression: cronExpr }),
        ]

        const svc = createService()
        svc.start()

        const stored = storeData.jobs as ScheduledJob[]
        const missed = stored[0].executions.filter((e) => e.status === 'missed')
        expect(missed.length).toBeGreaterThanOrEqual(1)
      })

      it(`${description}: no miss when within interval`, () => {
        const lastRunAt = Date.now() - Math.floor(expectedIntervalMs * 0.5)
        storeData.jobs = [
          makeJob({ id: 'iv-test2', enabled: true, lastRunAt, cronExpression: cronExpr }),
        ]

        const svc = createService()
        svc.start()

        const stored = storeData.jobs as ScheduledJob[]
        expect(stored[0].executions).toHaveLength(0)
      })
    }

    // Hourly (minute=0, hour=*)
    testIntervalDetection('0 * * * *', 3_600_000, 'hourly (0 * * * *)')

    // Daily (minute=0, hour=specific)
    testIntervalDetection('0 9 * * *', 86_400_000, 'daily (0 9 * * *)')

    // Weekly with non-zero minute (falls through to parts[4] check)
    testIntervalDetection('30 9 * * 1', 604_800_000, 'weekly with minute!=0 (30 9 * * 1)')

    // ── FIX BUG-009: weekly with minute=0 now correctly classified as weekly ──
    describe('FIX BUG-009: weekly cron with minute=0 and specific hour correctly classified', () => {
      it('"0 9 * * 1" correctly returns weekly (604_800_000), no false positive miss', () => {
        // 3 days ago — within 2× weekly (14 days), so no missed run
        const threeDaysAgo = Date.now() - 3 * 86_400_000
        storeData.jobs = [
          makeJob({
            id: 'weekly-bug-1',
            enabled: true,
            lastRunAt: threeDaysAgo,
            cronExpression: '0 9 * * 1', // weekly Monday 9am
          }),
        ]

        const svc = createService()
        svc.start()

        const stored = storeData.jobs as ScheduledJob[]
        // Fixed: interval is weekly (604_800_000), 3 days < 2× weekly → no false positive
        const missed = stored[0].executions.filter((e) => e.status === 'missed')
        expect(missed).toHaveLength(0)
      })

      it('"0 17 * * 5" (Friday 5pm) correctly classified as weekly, no false positive', () => {
        const threeDaysAgo = Date.now() - 3 * 86_400_000
        storeData.jobs = [
          makeJob({
            id: 'weekly-bug-2',
            enabled: true,
            lastRunAt: threeDaysAgo,
            cronExpression: '0 17 * * 5',
          }),
        ]

        const svc = createService()
        svc.start()

        const stored = storeData.jobs as ScheduledJob[]
        const missed = stored[0].executions.filter((e) => e.status === 'missed')
        expect(missed).toHaveLength(0) // Fixed: no false positive
      })

      it('"0 9 * * 1" correctly detects miss when beyond 2× weekly', () => {
        // 15 days ago — beyond 2× weekly (14 days), so missed run detected
        const fifteenDaysAgo = Date.now() - 15 * 86_400_000
        storeData.jobs = [
          makeJob({
            id: 'weekly-bug-3',
            enabled: true,
            lastRunAt: fifteenDaysAgo,
            cronExpression: '0 9 * * 1',
          }),
        ]

        const svc = createService()
        svc.start()

        const stored = storeData.jobs as ScheduledJob[]
        const missed = stored[0].executions.filter((e) => e.status === 'missed')
        expect(missed).toHaveLength(1)
      })
    })

    // ── FIX BUG-004: Stepped hours now return correct interval ──────────

    describe('FIX BUG-004: stepped hour patterns correctly classified', () => {
      // 0 */2 * * * = every 2 hours = 7_200_000 ms
      // 0 */3 * * * = every 3 hours = 10_800_000 ms

      it('"0 */2 * * *" (every 2h): no miss when within 2× interval (3h < 4h)', () => {
        // Correct interval = 7_200_000 (2h), threshold = 2× = 14_400_000 (4h)
        // 3 hours = 10_800_000 < 14_400_000 → no missed run
        const threeHoursAgo = Date.now() - 3 * 3_600_000
        storeData.jobs = [
          makeJob({
            id: 'bug4-1',
            enabled: true,
            lastRunAt: threeHoursAgo,
            cronExpression: '0 */2 * * *',
          }),
        ]

        const svc = createService()
        svc.start()

        const stored = storeData.jobs as ScheduledJob[]
        expect(stored[0].executions).toHaveLength(0)
      })

      it('"0 */2 * * *" (every 2h): detects miss when beyond 2× interval (5h > 4h)', () => {
        // Correct interval = 7_200_000 (2h), threshold = 2× = 14_400_000 (4h)
        // 5 hours = 18_000_000 > 14_400_000 → missed run detected
        const fiveHoursAgo = Date.now() - 5 * 3_600_000
        storeData.jobs = [
          makeJob({
            id: 'bug4-1b',
            enabled: true,
            lastRunAt: fiveHoursAgo,
            cronExpression: '0 */2 * * *',
          }),
        ]

        const svc = createService()
        svc.start()

        const stored = storeData.jobs as ScheduledJob[]
        const missed = stored[0].executions.filter((e) => e.status === 'missed')
        expect(missed).toHaveLength(1)
      })

      it('"0 */3 * * *" (every 3h): detects miss when beyond 2× interval (7h > 6h)', () => {
        // Correct interval = 10_800_000 (3h), threshold = 2× = 21_600_000 (6h)
        // 7 hours = 25_200_000 > 21_600_000 → missed run detected
        const sevenHoursAgo = Date.now() - 7 * 3_600_000
        storeData.jobs = [
          makeJob({
            id: 'bug4-2',
            enabled: true,
            lastRunAt: sevenHoursAgo,
            cronExpression: '0 */3 * * *',
          }),
        ]

        const svc = createService()
        svc.start()

        const stored = storeData.jobs as ScheduledJob[]
        const missed = stored[0].executions.filter((e) => e.status === 'missed')
        expect(missed).toHaveLength(1)
      })

      it('"0 */3 * * *" (every 3h): no miss when within 2× interval (5h < 6h)', () => {
        // Correct interval = 10_800_000 (3h), threshold = 2× = 21_600_000 (6h)
        // 5 hours = 18_000_000 < 21_600_000 → no missed run
        const fiveHoursAgo = Date.now() - 5 * 3_600_000
        storeData.jobs = [
          makeJob({
            id: 'bug4-2b',
            enabled: true,
            lastRunAt: fiveHoursAgo,
            cronExpression: '0 */3 * * *',
          }),
        ]

        const svc = createService()
        svc.start()

        const stored = storeData.jobs as ScheduledJob[]
        expect(stored[0].executions).toHaveLength(0)
      })

      it('"0 */6 * * *" (every 6h): detects miss at correct threshold', () => {
        // Correct interval = 21_600_000 (6h), threshold = 2× = 43_200_000 (12h)
        // 13 hours > 12 hours → missed run detected
        const thirteenHoursAgo = Date.now() - 13 * 3_600_000
        storeData.jobs = [
          makeJob({
            id: 'bug4-3',
            enabled: true,
            lastRunAt: thirteenHoursAgo,
            cronExpression: '0 */6 * * *',
          }),
        ]

        const svc = createService()
        svc.start()

        const stored = storeData.jobs as ScheduledJob[]
        const missed = stored[0].executions.filter((e) => e.status === 'missed')
        expect(missed).toHaveLength(1)
      })
    })
  })

  // ── Constructor & null notificationManager ───────────────────────────────

  describe('null notificationManager', () => {
    it('handles null notificationManager without error during execution', async () => {
      storeData.jobs = [makeJob({ id: 'null-nm-1' })]
      mockListSubAgents.mockReturnValue([{ id: 'agent-1', status: 'completed' }])
      mockGetSubAgentOutput.mockReturnValue([{ content: 'ok' }])

      const svc = createService(makeCLIManager(), null)
      const result = await svc.executeJob('null-nm-1')

      // Should complete without throwing even though notif manager is null
      expect(result).not.toBeNull()
      expect(result!.status).not.toBe('running')
    })

    it('handles null notificationManager during missed run check', () => {
      const twoDaysAgo = Date.now() - 2 * 86_400_000 - 1000
      storeData.jobs = [
        makeJob({ id: 'null-nm-2', enabled: true, lastRunAt: twoDaysAgo }),
      ]

      const svc = createService(makeCLIManager(), null)
      expect(() => svc.start()).not.toThrow()
    })
  })

  // ── SCHEDULE_TEMPLATES constant ──────────────────────────────────────────

  describe('SCHEDULE_TEMPLATES export', () => {
    it('all templates have valid-looking cron expressions (5 parts)', () => {
      for (const t of SCHEDULE_TEMPLATES) {
        const parts = t.cronExpression.split(' ')
        expect(parts.length).toBe(5)
      }
    })

    it('all templates default to disabled', () => {
      for (const t of SCHEDULE_TEMPLATES) {
        expect(t.enabled).toBe(false)
      }
    })

    it('all templates use claude as cli', () => {
      for (const t of SCHEDULE_TEMPLATES) {
        expect(t.cli).toBe('claude')
      }
    })
  })

  // ── Cron task re-registration edge cases ─────────────────────────────────

  describe('cron task management edge cases', () => {
    it('re-registering a job stops the old cron before starting new', () => {
      const mockStop = vi.fn()
      mockSchedule.mockReturnValue({ stop: mockStop })

      const svc = createService()
      const job = svc.saveJob({
        name: 'Re-register',
        description: '',
        prompt: 'hello',
        cronExpression: '0 0 * * *',
        cli: 'copilot',
        flags: {},
        enabled: true,
      })

      // Save again (update) — should stop old task
      svc.saveJob({ ...job, prompt: 'updated prompt' })

      expect(mockStop).toHaveBeenCalled()
    })

    it('cron callback invokes executeJob', () => {
      let cronCallback: (() => void) | undefined
      mockSchedule.mockImplementation((_expr: string, cb: () => void) => {
        cronCallback = cb
        return { stop: vi.fn() }
      })

      storeData.jobs = [makeJob({ id: 'cron-cb-1', enabled: true })]

      // Spy on executeJob by creating the service and checking behavior
      const svc = createService()
      svc.start()

      expect(cronCallback).toBeDefined()

      // Mock the sub-agent for when cron fires
      mockListSubAgents.mockReturnValue([{ id: 'agent-1', status: 'completed' }])
      mockGetSubAgentOutput.mockReturnValue([{ content: 'triggered' }])

      // Trigger the cron callback
      cronCallback!()

      // executeJob is async, so it fires and forgets via `void`
      // Just verify spawnSubAgent was called
      expect(mockSpawnSubAgent).toHaveBeenCalled()
    })
  })
})
