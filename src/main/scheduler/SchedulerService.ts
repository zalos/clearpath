import cron from 'node-cron'
import Store from 'electron-store'
import { randomUUID } from 'crypto'
import { getStoreEncryptionKey } from '../utils/storeEncryption'
import type { CLIManager } from '../cli/CLIManager'
import type { NotificationManager } from '../notifications/NotificationManager'
import type { ParsedOutput } from '../cli/types'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ScheduledJob {
  id: string
  name: string
  description: string
  prompt: string
  cronExpression: string
  cli: 'copilot' | 'claude'
  model?: string
  permissionMode?: string
  workingDirectory?: string
  flags: Record<string, string | boolean>
  enabled: boolean
  maxBudget?: number
  maxTurns?: number
  createdAt: number
  lastRunAt?: number
  executions: JobExecution[]
}

export interface JobExecution {
  id: string
  startedAt: number
  endedAt?: number
  duration?: number
  exitCode?: number
  output: string
  status: 'running' | 'success' | 'failed' | 'rate-limited' | 'timeout' | 'missed'
  estimatedCost?: number
}

interface SchedulerStoreSchema {
  jobs: ScheduledJob[]
}

// ── Built-in schedule templates ──────────────────────────────────────────────

export const SCHEDULE_TEMPLATES: Array<Omit<ScheduledJob, 'id' | 'createdAt' | 'executions'>> = [
  {
    name: 'Nightly Test Runner',
    description: 'Runs project tests every night and reports failures',
    prompt: 'Run the project test suite. Report any failures with file names, test names, and error messages. If all tests pass, confirm with a summary of tests run.',
    cronExpression: '0 0 * * *',
    cli: 'claude', enabled: false, permissionMode: 'acceptEdits',
    flags: {}, maxTurns: 10,
  },
  {
    name: 'Weekly Security Audit',
    description: 'Reviews codebase for security vulnerabilities every Monday',
    prompt: 'Perform a security audit of the codebase focusing on OWASP Top 10 vulnerabilities. Check for: injection attacks, broken auth, sensitive data exposure, XSS, and insecure dependencies. Rate each finding by severity.',
    cronExpression: '0 9 * * 1',
    cli: 'claude', model: 'opus', enabled: false, permissionMode: 'plan',
    flags: {}, maxBudget: 5,
  },
  {
    name: 'Daily Dependency Check',
    description: 'Checks for outdated or vulnerable dependencies every morning',
    prompt: 'Check all project dependencies for known vulnerabilities and outdated versions. Run the appropriate audit command (npm audit, pip audit, etc). Report any issues found with recommended update versions.',
    cronExpression: '0 8 * * 1-5',
    cli: 'claude', enabled: false, permissionMode: 'plan',
    flags: {}, maxTurns: 5,
  },
  {
    name: 'Friday Documentation Update',
    description: 'Generates or updates documentation every Friday',
    prompt: 'Review the codebase for undocumented or poorly documented modules. Update JSDoc/docstrings for any functions that have been modified since last week. Generate a changelog entry for this week\'s changes.',
    cronExpression: '0 17 * * 5',
    cli: 'claude', enabled: false, permissionMode: 'acceptEdits',
    flags: {}, maxTurns: 15,
  },
  {
    name: 'Hourly Build Verification',
    description: 'Runs build command every hour during work hours',
    prompt: 'Run the project build command. If the build fails, identify the error and report the file and line number. Do not fix the error, just report it.',
    cronExpression: '0 9-17 * * 1-5',
    cli: 'claude', enabled: false, permissionMode: 'plan',
    flags: {}, maxTurns: 3,
  },
]

// ── Store ────────────────────────────────────────────────────────────────────

const store = new Store<SchedulerStoreSchema>({
  name: 'clear-path-scheduler',
  defaults: { jobs: [] },
  encryptionKey: getStoreEncryptionKey(),
})

// ── Service ──────────────────────────────────────────────────────────────────

export class SchedulerService {
  private tasks = new Map<string, cron.ScheduledTask>()
  private cliManager: CLIManager
  private notificationManager: NotificationManager | null

  constructor(cliManager: CLIManager, notificationManager: NotificationManager | null) {
    this.cliManager = cliManager
    this.notificationManager = notificationManager
  }

  /** Load all enabled jobs and register them with node-cron. */
  start(): void {
    const jobs = store.get('jobs')
    for (const job of jobs) {
      if (job.enabled) this.registerCronTask(job)
    }
    // Check for missed runs
    this.checkMissedRuns()
  }

  stop(): void {
    for (const task of this.tasks.values()) task.stop()
    this.tasks.clear()
  }

  private registerCronTask(job: ScheduledJob): void {
    if (this.tasks.has(job.id)) {
      this.tasks.get(job.id)!.stop()
    }

    if (!cron.validate(job.cronExpression)) {
      console.error(`[Scheduler] Invalid cron expression for job ${job.name}: ${job.cronExpression}`)
      return
    }

    const task = cron.schedule(job.cronExpression, () => {
      void this.executeJob(job.id)
    })

    this.tasks.set(job.id, task)
  }

  private unregisterCronTask(id: string): void {
    const task = this.tasks.get(id)
    if (task) { task.stop(); this.tasks.delete(id) }
  }

  async executeJob(jobId: string): Promise<JobExecution | null> {
    const jobs = store.get('jobs')
    const job = jobs.find((j) => j.id === jobId)
    if (!job) return null

    const execution: JobExecution = {
      id: randomUUID(),
      startedAt: Date.now(),
      output: '',
      status: 'running',
    }

    // Add execution to job
    job.executions.push(execution)
    job.lastRunAt = Date.now()
    if (job.executions.length > 50) job.executions.splice(0, job.executions.length - 50)
    store.set('jobs', jobs)

    try {
      const info = await this.cliManager.spawnSubAgent({
        name: `Scheduled: ${job.name}`,
        cli: job.cli,
        prompt: job.prompt,
        model: job.model,
        workingDirectory: job.workingDirectory,
        permissionMode: job.permissionMode,
        maxBudget: job.maxBudget,
        maxTurns: job.maxTurns,
      })

      // Wait for completion by polling
      const maxWait = 600_000 // 10 minutes
      const startTime = Date.now()
      let finalStatus: string = 'running'

      while (Date.now() - startTime < maxWait) {
        await new Promise((r) => setTimeout(r, 2000))
        const agents = this.cliManager.listSubAgents()
        const agent = agents.find((a) => a.id === info.id)
        if (!agent || agent.status !== 'running') {
          finalStatus = agent?.status ?? 'failed'
          break
        }
      }

      if (finalStatus === 'running') finalStatus = 'timeout'

      // Collect output
      const outputLog = this.cliManager.getSubAgentOutput(info.id)
      const outputText = outputLog.map((o) => o.content).join('\n')

      execution.endedAt = Date.now()
      execution.duration = execution.endedAt - execution.startedAt
      execution.output = outputText.slice(0, 50000)
      execution.status = finalStatus as JobExecution['status']

      // Update store
      const updatedJobs = store.get('jobs')
      const updatedJob = updatedJobs.find((j) => j.id === jobId)
      if (updatedJob) {
        const execIdx = updatedJob.executions.findIndex((e) => e.id === execution.id)
        if (execIdx >= 0) updatedJob.executions[execIdx] = execution
        store.set('jobs', updatedJobs)
      }

      // Emit notification — keep it simple
      const isOk = execution.status === 'success' || execution.status === 'completed'
      this.notificationManager?.emit({
        type: 'schedule-result',
        severity: isOk ? 'info' : 'warning',
        title: isOk ? `${job.name} completed` : `${job.name} failed`,
        message: isOk ? 'Scheduled task finished successfully.' : 'Scheduled task did not complete. Check execution history for details.',
        source: 'scheduler',
        action: { label: 'View Scheduler', ipcChannel: '', navigate: '/configure', tab: 'scheduler' },
      })

      return execution
    } catch (err) {
      execution.endedAt = Date.now()
      execution.duration = execution.endedAt - execution.startedAt
      execution.status = 'failed'
      execution.output = String(err)

      const updatedJobs = store.get('jobs')
      const updatedJob = updatedJobs.find((j) => j.id === jobId)
      if (updatedJob) {
        const execIdx = updatedJob.executions.findIndex((e) => e.id === execution.id)
        if (execIdx >= 0) updatedJob.executions[execIdx] = execution
        store.set('jobs', updatedJobs)
      }

      return execution
    }
  }

  private checkMissedRuns(): void {
    const jobs = store.get('jobs')
    const now = Date.now()

    for (const job of jobs) {
      if (!job.enabled || !job.lastRunAt) continue

      // Simple check: if last run was more than 2× the interval ago, it's missed
      const interval = this.estimateIntervalMs(job.cronExpression)
      if (interval && now - job.lastRunAt > interval * 2) {
        const missedExec: JobExecution = {
          id: randomUUID(),
          startedAt: job.lastRunAt + interval,
          endedAt: job.lastRunAt + interval,
          status: 'missed',
          output: 'App was closed during scheduled run time.',
        }
        job.executions.push(missedExec)

        this.notificationManager?.emit({
          type: 'schedule-result',
          severity: 'warning',
          title: `Missed run: ${job.name}`,
          message: `Scheduled task "${job.name}" missed its run while the app was closed.`,
          source: 'scheduler',
          action: { label: 'View Scheduler', ipcChannel: 'scheduler:run-now', args: { id: job.id }, navigate: '/configure', tab: 'scheduler' },
        })
      }
    }

    store.set('jobs', jobs)
  }

  private estimateIntervalMs(cronExpr: string): number | null {
    // Rough estimation for common cron patterns
    const parts = cronExpr.split(' ')
    if (parts.length < 5) return null

    // Weekly must be checked before daily — patterns like "0 9 * * 1"
    // have minute=0 and a specific hour, but parts[4] reveals the weekly DOW
    if (parts[4] !== '*') return 604_800_000 // weekly

    if (parts[0] === '0' && parts[1] === '*') return 3_600_000 // every hour

    // Stepped hour patterns like "0 */2 * * *" or "0 */3 * * *"
    const stepMatch = parts[1].match(/^\*\/(\d+)$/)
    if (parts[0] === '0' && stepMatch) {
      const step = parseInt(stepMatch[1], 10)
      return step > 0 ? step * 3_600_000 : 3_600_000
    }

    if (parts[0] === '0' && parts[1] !== '*') return 86_400_000 // daily
    return 86_400_000 // default daily
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  listJobs(): ScheduledJob[] {
    return store.get('jobs')
  }

  getJob(id: string): ScheduledJob | null {
    return store.get('jobs').find((j) => j.id === id) ?? null
  }

  saveJob(job: Omit<ScheduledJob, 'id' | 'createdAt' | 'executions'> & { id?: string }): ScheduledJob {
    const jobs = store.get('jobs')
    const existing = job.id ? jobs.findIndex((j) => j.id === job.id) : -1

    const saved: ScheduledJob = {
      ...job,
      id: job.id ?? randomUUID(),
      createdAt: existing >= 0 ? jobs[existing].createdAt : Date.now(),
      executions: existing >= 0 ? jobs[existing].executions : [],
    }

    if (existing >= 0) {
      jobs[existing] = saved
    } else {
      jobs.push(saved)
    }
    store.set('jobs', jobs)

    // Update cron registration
    if (saved.enabled) this.registerCronTask(saved)
    else this.unregisterCronTask(saved.id)

    return saved
  }

  deleteJob(id: string): void {
    this.unregisterCronTask(id)
    store.set('jobs', store.get('jobs').filter((j) => j.id !== id))
  }

  toggleJob(id: string, enabled: boolean): void {
    const jobs = store.get('jobs')
    const job = jobs.find((j) => j.id === id)
    if (!job) return
    job.enabled = enabled
    store.set('jobs', jobs)

    if (enabled) this.registerCronTask(job)
    else this.unregisterCronTask(id)
  }

  duplicateJob(id: string): ScheduledJob | null {
    const job = this.getJob(id)
    if (!job) return null
    return this.saveJob({
      ...job,
      id: undefined,
      name: `${job.name} (copy)`,
      enabled: false,
    })
  }

  getTemplates(): typeof SCHEDULE_TEMPLATES {
    return SCHEDULE_TEMPLATES
  }
}
