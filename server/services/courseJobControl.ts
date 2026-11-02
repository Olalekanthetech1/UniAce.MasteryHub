export const activeCancelledJobs = new Set<string>();

export function markCourseJobCancelled(courseId: string): void {
  if (courseId.trim()) activeCancelledJobs.add(courseId);
}

export function clearCourseJobCancellation(courseId: string): void {
  activeCancelledJobs.delete(courseId);
}
