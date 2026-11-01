import { auth } from '../firebase';
import { safeFetchJson } from '../utils/safeFetch';

export interface SRSRecord {
  userId: string;
  topicId: string;
  courseId: string;
  easinessFactor: number;
  interval: number;
  repetitions: number;
  nextReviewDate: string;
  lastReviewed: string;
  topicTitle?: string;
  box?: number;
  repetitionCount?: number;
  easeFactor?: number;
  lastPerformanceScore?: number;
}

export const SRSService = {
  /**
   * Calculates the next review date based on the SM-2 algorithm.
   * @param quality Score from 0 (blackout) to 5 (perfect response)
   * @param currentRecord The existing SRS record (if any)
   */
  calculateNextReview(quality: number, currentRecord?: SRSRecord): Partial<SRSRecord> {
    let { easinessFactor = 2.5, interval = 0, repetitions = 0 } = currentRecord || {};

    if (quality >= 3) {
      if (repetitions === 0) {
        interval = 1;
      } else if (repetitions === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * easinessFactor);
      }
      repetitions += 1;
    } else {
      repetitions = 0;
      interval = 1;
    }

    easinessFactor = easinessFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easinessFactor < 1.3) easinessFactor = 1.3;

    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + interval);

    return {
      easinessFactor,
      interval,
      repetitions,
      nextReviewDate: nextReviewDate.toISOString(),
      lastReviewed: new Date().toISOString()
    };
  },

  /**
   * Updates or creates an SRS record for a specific topic/lesson after a quiz.
   */
  async updateSRS(courseId: string, topicId: string, topicTitle: string, scorePercentage: number) {
    const user = auth.currentUser;
    if (!user) throw new Error('An authenticated student session is required to update spaced repetition.');

    if (!Number.isFinite(scorePercentage) || scorePercentage < 0 || scorePercentage > 100) {
      throw new Error('A valid recorded quiz score is required to update spaced repetition.');
    }

    // Convert the actual quiz score to the configured SM-2 quality scale.
    let quality = 0;
    if (scorePercentage >= 95) quality = 5;
    else if (scorePercentage >= 80) quality = 4;
    else if (scorePercentage >= 60) quality = 3;
    else if (scorePercentage >= 40) quality = 2;
    else if (scorePercentage >= 20) quality = 1;

    const token = await user.getIdToken();
    const response = await fetch('/api/user/srs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        cardId: topicId,
        courseId,
        topicTitle,
        rating: quality
      })
    });
    if (!response.ok) {
      throw new Error(`Spaced-repetition update failed with HTTP ${response.status}.`);
    }
  },

  /**
   * Fetches an SRS record for a specific user and topic.
   */
  async getSRSRecord(userId: string, courseId: string, topicId: string): Promise<SRSRecord | null> {
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.uid !== userId) {
      throw new Error('The authenticated user does not match the requested spaced-repetition profile.');
    }

    const token = await currentUser.getIdToken();
    const res = await safeFetchJson<any>('/api/user/srs', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      throw new Error(`Spaced-repetition lookup failed with HTTP ${res.status}.`);
    }
    if (!res.data || !Array.isArray(res.data.cards)) {
      throw new Error('Spaced-repetition response did not contain a verified cards array.');
    }

    const match = res.data.cards.find((card: any) =>
      card.card_id === topicId && card.course_id === courseId
    );
    if (!match) return null;

    const repetitions = Number(match.review_count);
    const easinessFactor = Number(match.ease_factor);
    const nextReviewDate = match.next_review_at;
    const lastReviewed = match.updated_at;
    if (!Number.isFinite(repetitions) || repetitions < 0 ||
        !Number.isFinite(easinessFactor) || typeof nextReviewDate !== 'string' ||
        Number.isNaN(Date.parse(nextReviewDate)) || typeof lastReviewed !== 'string' ||
        Number.isNaN(Date.parse(lastReviewed))) {
      throw new Error('The persisted spaced-repetition record is incomplete or invalid.');
    }

    const nextReviewTime = Date.parse(nextReviewDate);
    const lastReviewedTime = Date.parse(lastReviewed);
    const interval = Math.max(0, Math.ceil((nextReviewTime - lastReviewedTime) / 86400000));
    return {
      userId,
      topicId: match.card_id,
      courseId: match.course_id,
      easinessFactor,
      interval,
      repetitions,
      nextReviewDate,
      lastReviewed
    };
  },

  /**
   * Fetches all topics that are currently due for review.
   */
  async getDueReviews(userId?: string): Promise<SRSRecord[]> {
    const user = auth.currentUser;
    const uid = userId || user?.uid;
    if (!uid) return [];

    try {
      const token = await user?.getIdToken();
      if (token) {
        const res = await safeFetchJson<any>('/api/user/srs', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok && res.data) {
          const json = res.data;
          if (Array.isArray(json.cards)) {
            const now = Date.now();
            return json.cards
              .filter((c: any) => !c.next_review_at || new Date(c.next_review_at).getTime() <= now)
              .map((c: any) => ({
                userId: uid,
                topicId: c.card_id,
                courseId: c.course_id,
                easinessFactor: c.ease_factor || 2.5,
                interval: 1,
                repetitions: c.review_count || 0,
                box: c.box,
                nextReviewDate: c.next_review_at,
                lastReviewed: c.updated_at || new Date().toISOString(),
                repetitionCount: c.review_count,
                easeFactor: c.ease_factor,
                lastPerformanceScore: 3
              }));
          }
        }
      }
    } catch (err) {
      console.warn('[SRSService] Failed to fetch due reviews:', err);
    }
    return [];
  }
};
