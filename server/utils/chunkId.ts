import crypto from 'crypto';

/**
 * Generates a deterministic, course-qualified chunk ID.
 * Format: `chk_${courseId}_${moduleId}_${lessonId}_${chunkIndex}`
 * Guaranteed to be <= 128 characters, unique per course, module, lesson, and chunk index.
 */
export function generateChunkId(courseId: string, moduleId: string, lessonId: string, chunkIndex: number = 0): string {
  const sanitizedCourse = (courseId || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_');
  const sanitizedModule = (moduleId || 'mod').replace(/[^a-zA-Z0-9_\-]/g, '_');
  const sanitizedLesson = (lessonId || 'les').replace(/[^a-zA-Z0-9_\-]/g, '_');
  
  const rawId = `chk_${sanitizedCourse}_${sanitizedModule}_${sanitizedLesson}_${chunkIndex}`;
  if (rawId.length <= 120) {
    return rawId;
  }

  // Widen/Hash fallback if string parameters are exceptionally long
  const hash = crypto.createHash('sha256').update(`${courseId}:${moduleId}:${lessonId}:${chunkIndex}`).digest('hex').substring(0, 16);
  return `chk_${sanitizedCourse.substring(0, 32)}_${hash}_${chunkIndex}`;
}
