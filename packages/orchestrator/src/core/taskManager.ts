/** Task management and distribution. */
import { getLogger } from "@ai-orchestrator/shared";

export enum TaskStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export class Task {
  status: TaskStatus = TaskStatus.PENDING;
  readonly createdAt: Date = new Date();
  startedAt: Date | null = null;
  completedAt: Date | null = null;
  assignedAgent: string | null = null;
  result: unknown = null;
  error: string | null = null;

  constructor(
    readonly id: string,
    readonly description: string,
    readonly metadata: Record<string, unknown> = {},
  ) {}

  start(agent: string): void {
    this.status = TaskStatus.IN_PROGRESS;
    this.startedAt = new Date();
    this.assignedAgent = agent;
  }

  complete(result: unknown): void {
    this.status = TaskStatus.COMPLETED;
    this.completedAt = new Date();
    this.result = result;
  }

  fail(error: string): void {
    this.status = TaskStatus.FAILED;
    this.completedAt = new Date();
    this.error = error;
  }

  duration(): number | null {
    if (this.startedAt && this.completedAt) {
      return (this.completedAt.getTime() - this.startedAt.getTime()) / 1000;
    }
    return null;
  }
}

export interface TaskStatistics {
  totalTasks: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  averageDuration: number;
}

export class TaskManager {
  private readonly logger = getLogger("task_manager");
  readonly tasks = new Map<string, Task>();
  private taskCounter = 0;

  createTask(description: string, metadata: Record<string, unknown> = {}): Task {
    this.taskCounter += 1;
    const taskId = `task_${this.taskCounter}`;
    const task = new Task(taskId, description, metadata);
    this.tasks.set(taskId, task);
    this.logger.info(`Created task: ${taskId}`);
    return task;
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    return [...this.tasks.values()].filter((t) => t.status === status);
  }

  getPendingTasks(): Task[] {
    return this.getTasksByStatus(TaskStatus.PENDING);
  }

  getActiveTasks(): Task[] {
    return this.getTasksByStatus(TaskStatus.IN_PROGRESS);
  }

  getCompletedTasks(): Task[] {
    return this.getTasksByStatus(TaskStatus.COMPLETED);
  }

  getStatistics(): TaskStatistics {
    const all = [...this.tasks.values()];
    if (!all.length) {
      return { totalTasks: 0, pending: 0, inProgress: 0, completed: 0, failed: 0, averageDuration: 0 };
    }
    const completed = all.filter((t) => t.status === TaskStatus.COMPLETED);
    const durations = completed.map((t) => t.duration()).filter((d): d is number => d !== null);

    return {
      totalTasks: all.length,
      pending: all.filter((t) => t.status === TaskStatus.PENDING).length,
      inProgress: all.filter((t) => t.status === TaskStatus.IN_PROGRESS).length,
      completed: completed.length,
      failed: all.filter((t) => t.status === TaskStatus.FAILED).length,
      averageDuration: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    };
  }

  clearCompleted(): void {
    for (const [id, task] of this.tasks) {
      if (task.status === TaskStatus.COMPLETED) this.tasks.delete(id);
    }
    this.logger.info("Cleared completed tasks");
  }

  cleanupStale(maxAgeSeconds = 3600): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, task] of this.tasks) {
      if (
        (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED) &&
        task.completedAt &&
        (now - task.completedAt.getTime()) / 1000 > maxAgeSeconds
      ) {
        this.tasks.delete(id);
        removed += 1;
      }
    }
    if (removed) this.logger.info(`Cleaned up ${removed} stale tasks`);
    return removed;
  }

  clearAll(): void {
    this.tasks.clear();
    this.taskCounter = 0;
    this.logger.info("Cleared all tasks");
  }
}
