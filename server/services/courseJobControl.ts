export const activeCancelledJobs = new Set<string>();
export const activeRunningCourseJobs = new Set<string>();
export const activeCoordinatedJobSnapshots = new Map<string, Record<string, any>>();

export function markCourseJobCancelled(courseId: string): void {
  if (courseId.trim()) activeCancelledJobs.add(courseId);
}

export function clearCourseJobCancellation(courseId: string): void {
  activeCancelledJobs.delete(courseId);
}

