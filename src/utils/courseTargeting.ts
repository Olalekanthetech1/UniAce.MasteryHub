import type { CourseScope, Department } from '../types';

export interface CourseGenerationTarget {
  department: string;
  selectedFaculties: string[];
  selectedDepartments: Department[];
}

/**
 * Resolves the single legacy department/group field and the scope-specific
 * targeting arrays from the selected course scope.
 *
 * Inactive-scope selections are intentionally discarded so stale UI state
 * can never override the active targeting mode.
 */
export function resolveCourseGenerationTarget(
  scope: CourseScope,
  selectedFaculties: readonly string[],
  selectedDepartments: readonly Department[]
): CourseGenerationTarget | null {
  switch (scope) {
    case 'GLOBAL':
      return {
        department: 'General Studies',
        selectedFaculties: [],
        selectedDepartments: []
      };

    case 'FACULTY': {
      const faculties = selectedFaculties.filter(faculty => faculty.trim().length > 0);
      if (faculties.length === 0) return null;

      return {
        department: faculties[0],
        selectedFaculties: faculties,
        selectedDepartments: []
      };
    }

    case 'DEPARTMENT': {
      const departments = selectedDepartments.filter(department => department.trim().length > 0);
      if (departments.length === 0) return null;

      return {
        department: departments[0],
        selectedFaculties: [],
        selectedDepartments: departments
      };
    }

    default:
      return null;
  }
}
