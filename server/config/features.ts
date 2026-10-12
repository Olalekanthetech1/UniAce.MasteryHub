/**
 * UniAce Mastery Hub: Database & Migration Feature Flags
 *
 * All PostgreSQL flags MUST remain strictly false by default until
 * the respective Stage 5B entity verification gates are passed and authorized.
 */

export interface SystemFeatureFlags {
  /** Enables PostgreSQL for course catalog, modules, lessons, quizzes (Stage 5B pilot) */
  ENABLE_POSTGRES_CATALOG: boolean;

  /** Enables PostgreSQL for student study progress and quiz attempts (Stage 5B pilot) */
  ENABLE_POSTGRES_PROGRESS: boolean;

  /** Enables PostgreSQL for background course generation jobs queue (Stage 5B pilot) */
  ENABLE_POSTGRES_GENERATION_JOBS: boolean;

  /**
   * PROHIBITED: Permanent shadow-writes / dual-writes are strictly forbidden.
   * This flag must remain false to prevent split-brain states across databases.
   */
  ENABLE_POSTGRES_SHADOW_WRITE: boolean;
}

export const featureFlags: SystemFeatureFlags = {
  ENABLE_POSTGRES_CATALOG: process.env.ENABLE_POSTGRES_CATALOG === 'true',
  ENABLE_POSTGRES_PROGRESS: process.env.ENABLE_POSTGRES_PROGRESS === 'true',
  ENABLE_POSTGRES_GENERATION_JOBS: process.env.ENABLE_POSTGRES_GENERATION_JOBS === 'true',
  ENABLE_POSTGRES_SHADOW_WRITE: false // Strictly prohibited
};

/**
 * Returns the current runtime feature flag snapshot.
 */
export function getFeatureFlags(): Readonly<SystemFeatureFlags> {
  return Object.freeze({ ...featureFlags });
}
