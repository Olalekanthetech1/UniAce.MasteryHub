import { Curriculum, UserProfile, CourseId } from '../types';
import { LogService } from './logService';

export interface IntegrityIssue {
  id?: string;
  userId: string;
  userEmail: string;
  userName?: string;
  department?: string;
  level?: string;
  type: 'MISSING_COURSE' | 'EXTRA_COURSE' | 'LEVEL_MISMATCH' | 'DEPT_MISMATCH' | 'EMPTY_CURRICULUM';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  details: string;
  expectedCourseIds?: string[];
  actualCourseIds?: string[];
  metadata?: any;
  resolved?: boolean;
  timestamp?: any;
}

import { CourseService } from './courseService';
import { isCourseEligibleForUser } from '../utils/courseEligibility';

export class CurriculumIntegrityService {
  /**
   * Fetches the canonical curriculum for a specific cohort from PostgreSQL catalog
   */
  static async getCanonicalCurriculum(dept: string, level: string, sem: string): Promise<Curriculum | null> {
    const cleanLevel = level.replace(/\D/g, '') || '100';
    try {
      const allCourses = await CourseService.getFullCatalog();
      if (!allCourses || allCourses.length === 0) return null;

      const profileStub: Partial<UserProfile> = {
        department: dept,
        academic_level: cleanLevel as any,
        semester: sem as any
      };

      const matchedCourses = allCourses.filter(c => isCourseEligibleForUser(c, profileStub as UserProfile, sem));
      if (matchedCourses.length === 0) return null;

      const courseIds = matchedCourses.map(c => c.id);
      return {
        id: this.generateCurriculumId(dept, level, sem),
        department: dept as any,
        level: level as any,
        semester: sem as any,
        courseIds: courseIds as any,
        lastUpdated: new Date().toISOString(),
        updatedBy: 'system'
      };
    } catch (e) {
      console.warn('Failed to fetch canonical curriculum from Neon:', e);
      return null;
    }
  }

  /**
   * Generates a consistent ID for curriculum documents
   */
  static generateCurriculumId(dept: string, level: string, sem: string): string {
    const cleanDept = dept.toUpperCase().replace(/\s+/g, '_');
    const cleanLevel = level.replace(/\D/g, '');
    const cleanSem = sem.includes('1') ? '1' : '2';
    return `${cleanDept}_${cleanLevel}_${cleanSem}`;
  }

  /**
   * Validates a user's curriculum against the canonical source
   */
  static async validateUserCurriculum(
    userId: string, 
    profile: UserProfile, 
    actualCourseIds: CourseId[]
  ): Promise<IntegrityIssue[]> {
    if (!profile.department || !profile.academic_level || !profile.semester) {
      return [];
    }

    const canonical = await this.getCanonicalCurriculum(
      profile.department,
      profile.academic_level,
      profile.semester
    );

    const issues: IntegrityIssue[] = [];

    if (!canonical) {
      return [];
    }

    const expectedIds = canonical.courseIds || [];

    // 1. Check for missing courses
    const missing = expectedIds.filter(id => !actualCourseIds.includes(id as CourseId));
    if (missing.length > 0) {
      issues.push({
        userId,
        userEmail: profile.email,
        userName: profile.displayName,
        department: profile.department,
        level: profile.academic_level,
        type: 'MISSING_COURSE',
        severity: missing.length > 2 ? 'HIGH' : 'MEDIUM',
        details: `User is missing ${missing.length} expected courses: ${missing.join(', ')}`,
        expectedCourseIds: expectedIds,
        actualCourseIds: actualCourseIds,
        metadata: { missing }
      });
    }

    // 2. Check for extra courses
    const extra = actualCourseIds.filter(id => !expectedIds.includes(id));
    if (extra.length > 0) {
      issues.push({
        userId,
        userEmail: profile.email,
        userName: profile.displayName,
        department: profile.department,
        level: profile.academic_level,
        type: 'EXTRA_COURSE',
        severity: 'LOW',
        details: `User has ${extra.length} extra courses not in canonical curriculum: ${extra.join(', ')}`,
        expectedCourseIds: expectedIds,
        actualCourseIds: actualCourseIds,
        metadata: { extra }
      });
    }

    // 3. Check for empty curriculum
    if (actualCourseIds.length === 0 && expectedIds.length > 0) {
      issues.push({
        userId,
        userEmail: profile.email,
        userName: profile.displayName,
        department: profile.department,
        level: profile.academic_level,
        type: 'EMPTY_CURRICULUM',
        severity: 'CRITICAL',
        details: `User has 0 courses but should have ${expectedIds.length}`,
        expectedCourseIds: expectedIds,
        actualCourseIds: actualCourseIds
      });
    }

    for (const issue of issues) {
      await this.logIntegrityIssue(issue);
    }

    return issues;
  }

  /**
   * Logs an integrity issue to Neon system_alerts
   */
  static async logIntegrityIssue(issue: IntegrityIssue) {
    try {
      const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
      await fetch('/api/system/alert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          type: 'CURRICULUM_INTEGRITY_ISSUE',
          department: issue.department,
          academicLevel: issue.level,
          status: 'pending',
          details: {
            issueType: issue.type,
            severity: issue.severity,
            details: issue.details,
            userId: issue.userId,
            userEmail: issue.userEmail,
            expectedCourseIds: issue.expectedCourseIds,
            actualCourseIds: issue.actualCourseIds,
            metadata: issue.metadata
          }
        })
      });
      
      LogService.log('error', 'system', `Integrity Issue [${issue.type}] for ${issue.userEmail}: ${issue.details}`);
    } catch (error) {
      console.error('Failed to log integrity issue to Neon:', error);
    }
  }

  /**
   * Fetches all unresolved integrity issues from Neon
   */
  static async getUnresolvedIssues(): Promise<IntegrityIssue[]> {
    try {
      const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
      const res = await fetch('/api/admin/system-alerts?type=CURRICULUM_INTEGRITY_ISSUE&status=pending', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) return [];
      const json = await res.json();
      return (json.alerts || []).map((a: any) => {
        const details = typeof a.details === 'object' ? a.details : {};
        return {
          id: a.id,
          userId: details.userId || a.requested_by,
          userEmail: details.userEmail || a.user_email,
          userName: details.userName || 'Scholar',
          department: a.department,
          level: a.academic_level,
          type: details.issueType || 'MISSING_COURSE',
          severity: details.severity || 'MEDIUM',
          details: details.details || a.course_title || 'Curriculum discrepancy',
          expectedCourseIds: details.expectedCourseIds || [],
          actualCourseIds: details.actualCourseIds || [],
          metadata: details.metadata || {},
          resolved: a.status === 'resolved',
          timestamp: a.created_at
        };
      });
    } catch (error) {
      console.error('Error fetching unresolved issues from Neon:', error);
      return [];
    }
  }

  /**
   * Remediates a single integrity issue via Neon
   */
  static async remediateIssue(issue: IntegrityIssue): Promise<boolean> {
    if (!issue.id) return false;
    try {
      const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/admin/system-alerts/${encodeURIComponent(issue.id)}/resolve`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) return false;
      LogService.log('success', 'admin', `Remediated ${issue.type} for ${issue.userEmail}`);
      return true;
    } catch (error) {
      console.error('Remediation failed:', error);
      return false;
    }
  }

  /**
   * Bulk remediates multiple issues
   */
  static async bulkRemediate(issues: IntegrityIssue[]): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const issue of issues) {
      const ok = await this.remediateIssue(issue);
      if (ok) success++;
      else failed++;
    }

    LogService.log('success', 'admin', `Bulk remediation complete: ${success} fixed, ${failed} failed`);
    return { success, failed };
  }
}
