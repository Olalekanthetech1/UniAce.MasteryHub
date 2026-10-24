import { Department, Level, Semester } from '../types';

export const DEPARTMENTS: Department[] = [
  'Aerospace Engineering', 'Agricultural Engineering', 'Anatomy', 'Biology', 
  'Biomedical Engineering', 'Chemical Engineering', 'Chemistry', 'Civil Engineering', 
  'Computer Engineering', 'Computer Science', 'Dentistry', 'Electrical Engineering', 
  'Material Science and Engineering', 'Mathematics', 'Mechanical Engineering', 
  'Mechatronics Engineering', 'Medical Laboratory Science', 'Medicine and Surgery', 
  'Nursing Science', 'Petroleum Engineering', 'Pharmacy', 'Physics', 'Physiology', 
  'Public Health', 'Software Engineering', 'General Studies', 'General Engineering Training', 'Zoology'
];

export const LEVELS: Level[] = ['100', '200', '300', '400', '500', '600'];
export const SEMESTERS: Semester[] = ['1st Semester', '2nd Semester'];

const DEPT_MAPPINGS: Record<string, Department> = {
  'MSE': 'Material Science and Engineering',
  'Material Science': 'Material Science and Engineering',
  'Materials Science': 'Material Science and Engineering',
  'Materials Science and Engineering': 'Material Science and Engineering',
  'MECH': 'Mechanical Engineering',
  'Mechanical Eng': 'Mechanical Engineering',
  'ELECT': 'Electrical Engineering',
  'Electrical Eng': 'Electrical Engineering',
  'CIVIL': 'Civil Engineering',
  'Civil Eng': 'Civil Engineering',
  'COMP': 'Computer Engineering',
  'Computer Eng': 'Computer Engineering',
  'CS': 'Computer Science',
  'BME': 'Biomedical Engineering',
  'Biomedical Eng': 'Biomedical Engineering',
  'SE': 'Software Engineering',
  'Software Eng': 'Software Engineering',
  'GST': 'General Studies',
  'GET': 'General Engineering Training',
};

export const normalizeDepartment = (input: string): Department | null => {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  
  // Direct match
  if (DEPARTMENTS.includes(trimmed as Department)) {
    return trimmed as Department;
  }
  
  // Mapping match
  if (DEPT_MAPPINGS[trimmed]) {
    return DEPT_MAPPINGS[trimmed];
  }
  
  // Case-insensitive search
  const lower = trimmed.toLowerCase();
  const found = DEPARTMENTS.find(d => d.toLowerCase() === lower);
  if (found) return found;
  
  // Pluralization / variant search (e.g. 'materials science' -> 'material science')
  const depluralized = lower.replace(/\bmaterials\b/g, 'material');
  const foundDepluralized = DEPARTMENTS.find(d => d.toLowerCase() === depluralized);
  if (foundDepluralized) return foundDepluralized;

  // Word-boundary match search in mappings (avoids false substring matches like "Robotics" matching "CS")
  for (const [key, value] of Object.entries(DEPT_MAPPINGS)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|\\b|\\s)${escaped}(\\b|\\s|$)`, 'i');
    if (regex.test(trimmed)) {
      return value;
    }
  }

  // Future-proof fallback: dynamically preserve and return trimmed department name
  return trimmed as Department;
};

/**
 * Returns a stable, canonical slug ID for a department string.
 * e.g., 'Materials Science & Engineering' -> 'material-science-and-engineering'
 */
export const normalizeDeptId = (input: string): string => {
  if (!input) return '';
  const canonicalName = normalizeDepartment(input) || input;
  return canonicalName
    .toLowerCase()
    .replace(/\bmaterials\b/g, 'material')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

/**
 * Compares two department strings for equivalence regardless of formatting, casing, or pluralization.
 */
export const isSameDepartment = (deptA: string, deptB: string): boolean => {
  if (!deptA || !deptB) return false;
  return normalizeDeptId(deptA) === normalizeDeptId(deptB);
};

export const normalizeLevel = (input: string): Level | null => {
  if (!input) return null;
  const match = String(input).match(/\d+/);
  if (match) {
    const num = match[0];
    if (LEVELS.includes(num as Level)) {
      return num as Level;
    }
    if (num.length === 3) {
      return num as Level;
    }
  }
  return null;
};

export const normalizeSemester = (input: string): Semester | null => {
  if (!input) return null;
  const lower = String(input).toLowerCase();
  if (lower.includes('1') || lower.includes('first')) return '1st Semester';
  if (lower.includes('2') || lower.includes('second')) return '2nd Semester';
  return null;
};

export interface NormalizedObjective {
  text: string;
  bloomLevel?: 'remembering' | 'understanding' | 'applying' | 'analyzing' | 'evaluating' | 'creating';
  outcomeId?: string;
}

export const normalizeCourseObjective = (item: any): NormalizedObjective | null => {
  if (!item) return null;
  if (typeof item === 'string') {
    const trimmed = item.trim();
    if (!trimmed) return null;
    return { text: trimmed };
  }
  if (typeof item === 'object') {
    const text = item.text || item.outcome || item.title || item.description || item.objective || '';
    if (!text || typeof text !== 'string') return null;
    return {
      text: text.trim(),
      bloomLevel: item.bloomLevel || item.bloom || item.level || undefined,
      outcomeId: item.id || item.outcomeId || undefined,
    };
  }
  return null;
};
