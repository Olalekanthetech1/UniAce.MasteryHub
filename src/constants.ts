import { Department, Level, Semester } from './types';

export const DEPARTMENTS: Department[] = [
  'Aerospace Engineering', 'Agricultural Engineering', 'Anatomy', 'Biology', 'Biomedical Engineering', 
  'Chemical Engineering', 'Chemistry', 'Civil Engineering', 'Computer Engineering', 'Computer Science', 
  'Dentistry', 'Electrical Engineering', 'Material Science and Engineering', 'Mathematics', 
  'Mechanical Engineering', 'Mechatronics Engineering', 'Medical Laboratory Science', 'Medicine and Surgery', 
  'Nursing Science', 'Petroleum Engineering', 'Pharmacy', 'Physics', 'Physiology', 'Public Health', 
  'Software Engineering', 'Statistics', 'Zoology', 'General Studies', 'General Engineering', 'General Engineering Training'
];

export const LEVELS: Level[] = ['100', '200', '300', '400', '500', '600'];

export const SEMESTERS: Semester[] = ['1st Semester', '2nd Semester'];

export const FACULTIES = [
  'Engineering',
  'Science',
  'Medicine & Health Sciences',
  'General Studies'
];

export const DEPARTMENT_TO_FACULTY: Record<string, string> = {
  'Aerospace Engineering': 'Engineering',
  'Agricultural Engineering': 'Engineering',
  'Biomedical Engineering': 'Engineering',
  'Chemical Engineering': 'Engineering',
  'Civil Engineering': 'Engineering',
  'Computer Engineering': 'Engineering',
  'Electrical Engineering': 'Engineering',
  'Material Science and Engineering': 'Engineering',
  'Mechanical Engineering': 'Engineering',
  'Mechatronics Engineering': 'Engineering',
  'Petroleum Engineering': 'Engineering',
  'Software Engineering': 'Engineering',
  'Anatomy': 'Medicine & Health Sciences',
  'Dentistry': 'Medicine & Health Sciences',
  'Medical Laboratory Science': 'Medicine & Health Sciences',
  'Medicine and Surgery': 'Medicine & Health Sciences',
  'Nursing Science': 'Medicine & Health Sciences',
  'Pharmacy': 'Medicine & Health Sciences',
  'Physiology': 'Medicine & Health Sciences',
  'Public Health': 'Medicine & Health Sciences',
  'Biology': 'Science',
  'Chemistry': 'Science',
  'Computer Science': 'Science',
  'Mathematics': 'Science',
  'Physics': 'Science',
  'Statistics': 'Science',
  'Zoology': 'Science',
  'General Studies': 'General Studies',
  'General Engineering': 'Engineering',
  'General Engineering Training': 'Engineering'
};
