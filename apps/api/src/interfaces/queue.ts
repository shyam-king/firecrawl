/**
 * Queue Abstraction Interfaces
 * 
 * This file defines the abstraction layer for queue operations, allowing
 * the application to swap between different queue implementations (BullMQ, AWS SQS, etc.)
 * without changing the business logic.
 */

export type JobState = "completed" | "failed" | "active" | "waiting" | "delayed" | "paused" | "unknown";

export interface JobOptions {
  /**
   * Job priority (lower number = higher priority)
   */
  priority?: number;
  
  /**
   * Delay before job execution (in milliseconds)
   */
  delay?: number;
  
  /**
   * Job ID (if not provided, will be auto-generated)
   */
  jobId?: string;
  
  /**
   * Number of attempts before job is marked as failed
   */
  attempts?: number;
  
  /**
   * Backoff strategy for retries
   */
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  
  /**
   * Job removal options
   */
  removeOnComplete?: number | boolean | { age?: number; count?: number };
  removeOnFail?: number | boolean | { age?: number; count?: number };
  
  /**
   * Additional metadata for the job
   */
  [key: string]: any;
}

export interface QueueJobData {
  /**
   * Job payload data
   */
  [key: string]: any;
}

export interface JobInterface<T = QueueJobData> {
  /**
   * Unique job identifier
   */
  id: string;
  
  /**
   * Job data/payload
   */
  data: T;
  
  /**
   * Job return value (set when completed)
   */
  returnvalue?: any;
  
  /**
   * Reason for job failure
   */
  failedReason?: string;
  
  /**
   * Timestamp when job was created
   */
  timestamp: number;
  
  /**
   * Timestamp when job processing started
   */
  processedOn?: number;
  
  /**
   * Timestamp when job finished (completed or failed)
   */
  finishedOn?: number;
  
  /**
   * Number of attempts made to process this job
   */
  attemptsMade?: number;
  
  /**
   * Job priority
   */
  priority?: number;
  
  /**
   * Job name/type
   */
  name?: string;
  
  /**
   * Move job to completed state
   */
  moveToCompleted(result: any, token: string, fetchNext?: boolean): Promise<void>;
  
  /**
   * Move job to failed state
   */
  moveToFailed(error: Error | string, token: string, fetchNext?: boolean): Promise<void>;
  
  /**
   * Extend the job processing lock
   */
  extendLock(token: string, duration: number): Promise<void>;
  
  /**
   * Remove job from queue
   */
  remove(): Promise<void>;
  
  /**
   * Get current job state
   */
  getState(): Promise<JobState>;
  
  /**
   * Update job progress
   */
  updateProgress?(progress: number | object): Promise<void>;
  
  /**
   * Add log entry to job
   */
  log?(message: string): Promise<void>;
}

export interface QueueInterface<T = QueueJobData> {
  /**
   * Queue name
   */
  readonly name: string;
  
  /**
   * Add a job to the queue
   */
  add(jobId: string, data: T, options?: JobOptions): Promise<JobInterface<T>>;
  
  /**
   * Add a job to the queue with auto-generated ID
   */
  add(data: T, options?: JobOptions): Promise<JobInterface<T>>;
  
  /**
   * Add a named job to the queue
   */
  add(jobName: string, data: T, options?: JobOptions): Promise<JobInterface<T>>;
  
  /**
   * Get a specific job by ID
   */
  getJob(jobId: string): Promise<JobInterface<T> | null>;
  
  /**
   * Get multiple jobs by state
   */
  getJobs(
    states: JobState[], 
    start?: number, 
    end?: number, 
    asc?: boolean
  ): Promise<JobInterface<T>[]>;
  
  /**
   * Get jobs in a specific state
   */
  getJobs(
    state: JobState, 
    start?: number, 
    end?: number, 
    asc?: boolean
  ): Promise<JobInterface<T>[]>;
  
  /**
   * Remove a job from the queue
   */
  remove(jobId: string): Promise<void>;
  
  /**
   * Get job state by ID
   */
  getJobState(jobId: string): Promise<JobState>;
  
  /**
   * Get count of active jobs
   */
  getActiveCount(): Promise<number>;
  
  /**
   * Get count of waiting jobs
   */
  getWaitingCount(): Promise<number>;
  
  /**
   * Get count of prioritized jobs
   */
  getPrioritizedCount(): Promise<number>;
  
  /**
   * Get count of completed jobs
   */
  getCompletedCount(): Promise<number>;
  
  /**
   * Get count of failed jobs
   */
  getFailedCount(): Promise<number>;
  
  /**
   * Get count of delayed jobs
   */
  getDelayedCount(): Promise<number>;
  
  /**
   * Pause the queue
   */
  pause(): Promise<void>;
  
  /**
   * Resume the queue
   */
  resume(): Promise<void>;
  
  /**
   * Check if queue is paused
   */
  isPaused(): Promise<boolean>;
  
  /**
   * Clean jobs from the queue
   */
  clean(
    gracePeriod: number, 
    states?: JobState[], 
    limit?: number
  ): Promise<JobInterface<T>[]>;
  
  /**
   * Drain the queue (remove all jobs)
   */
  drain(delayed?: boolean): Promise<void>;
  
  /**
   * Get queue metrics
   */
  getJobCounts(): Promise<{
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    waiting: number;
    paused: number;
  }>;
  
  /**
   * Close the queue connection
   */
  close(): Promise<void>;
}

export interface WorkerOptions {
  /**
   * Connection configuration
   */
  connection?: any;
  
  /**
   * Maximum time a job can be locked
   */
  lockDuration?: number;
  
  /**
   * Interval for checking stalled jobs
   */
  stalledInterval?: number;
  
  /**
   * Maximum number of stalled jobs before considering worker stalled
   */
  maxStalledCount?: number;
  
  /**
   * Number of concurrent jobs to process
   */
  concurrency?: number;
  
  /**
   * Rate limiter configuration
   */
  limiter?: {
    max: number;
    duration: number;
  };
  
  /**
   * Additional worker settings
   */
  settings?: {
    stalledInterval?: number;
    maxStalledCount?: number;
    retryProcessDelay?: number;
  };
}

export type JobProcessor<T = QueueJobData> = (
  job: JobInterface<T>,
  token?: string
) => Promise<any>;

export interface WorkerInterface<T = QueueJobData> {
  /**
   * Worker ID
   */
  readonly id: string;
  
  /**
   * Queue name this worker processes
   */
  readonly queueName: string;
  
  /**
   * Get the next job to process
   */
  getNextJob(token: string): Promise<JobInterface<T> | null>;
  
  /**
   * Start the stalled job check timer
   */
  startStalledCheckTimer(): void;
  
  /**
   * Stop the stalled job check timer
   */
  stopStalledCheckTimer(): void;
  
  /**
   * Process jobs with the given processor function
   */
  process(processor: JobProcessor<T>): void;
  
  /**
   * Process named jobs with the given processor function
   */
  process(jobName: string, processor: JobProcessor<T>): void;
  
  /**
   * Process jobs with concurrency limit
   */
  process(concurrency: number, processor: JobProcessor<T>): void;
  
  /**
   * Process named jobs with concurrency limit
   */
  process(jobName: string, concurrency: number, processor: JobProcessor<T>): void;
  
  /**
   * Pause the worker
   */
  pause(): Promise<void>;
  
  /**
   * Resume the worker
   */
  resume(): Promise<void>;
  
  /**
   * Check if worker is paused
   */
  isPaused(): boolean;
  
  /**
   * Check if worker is running
   */
  isRunning(): boolean;
  
  /**
   * Close the worker
   */
  close(): Promise<void>;
  
  /**
   * Event handlers
   */
  on(event: 'completed', handler: (job: JobInterface<T>, result: any) => void): void;
  on(event: 'failed', handler: (job: JobInterface<T>, error: Error) => void): void;
  on(event: 'progress', handler: (job: JobInterface<T>, progress: number | object) => void): void;
  on(event: 'stalled', handler: (jobId: string) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: string, handler: (...args: any[]) => void): void;
  
  /**
   * Remove event handlers
   */
  off(event: string, handler: (...args: any[]) => void): void;
  
  /**
   * Remove all event handlers for an event
   */
  removeAllListeners(event?: string): void;
}

export interface QueueConfig {
  /**
   * Queue name
   */
  name: string;
  
  /**
   * Connection configuration
   */
  connection?: any;
  
  /**
   * Default job options
   */
  defaultJobOptions?: JobOptions;
  
  /**
   * Queue-specific settings
   */
  settings?: {
    stalledInterval?: number;
    maxStalledCount?: number;
    retryProcessDelay?: number;
  };
}

export interface QueueFactoryInterface {
  /**
   * Create a new queue instance
   */
  createQueue<T = QueueJobData>(config: QueueConfig): QueueInterface<T>;
  
  /**
   * Create a new worker instance
   */
  createWorker<T = QueueJobData>(
    queueName: string, 
    processor: JobProcessor<T> | null, 
    options?: WorkerOptions
  ): WorkerInterface<T>;
  
  /**
   * Get an existing queue by name
   */
  getQueue<T = QueueJobData>(name: string): QueueInterface<T> | null;
  
  /**
   * Close all queues and workers
   */
  closeAll(): Promise<void>;
  
  /**
   * Get queue implementation type
   */
  getImplementationType(): string;
}

/**
 * Queue implementation types
 */
export enum QueueImplementationType {
  BULLMQ = 'bullmq',
  AWS_SQS = 'aws-sqs',
  GOOGLE_CLOUD_TASKS = 'google-cloud-tasks',
  REDIS_SIMPLE = 'redis-simple',
  MEMORY = 'memory'
}

/**
 * Queue connection interface
 */
export interface QueueConnection {
  /**
   * Test the connection
   */
  ping(): Promise<boolean>;
  
  /**
   * Close the connection
   */
  close(): Promise<void>;
  
  /**
   * Get connection status
   */
  isConnected(): boolean;
  
  /**
   * Get connection configuration
   */
  getConfig(): any;
}

