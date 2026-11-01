import { Level, Semester } from './types';

// Supported academic level and semester values are validation enums, not institution catalogue data.
// Departments, faculties and their relationships are loaded from the live institution configuration.
export const LEVELS: Level[] = ['100', '200', '300', '400', '500', '600'];
export const SEMESTERS: Semester[] = ['1st Semester', '2nd Semester'];
