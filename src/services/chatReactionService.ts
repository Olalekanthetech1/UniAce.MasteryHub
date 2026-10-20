import { auth } from '../firebase';

export interface ReactionState {
  tallies: { [emoji: string]: number };
  userReactions: string[];
}

/**
 * Toggles a reaction for a given message and student via Neon API.
 */
export async function toggleMessageReaction(
  messageId: string,
  emoji: string,
  userId: string,
  courseId?: string
): Promise<{ active: boolean; tallies: { [emoji: string]: number }; userReactions: string[] }> {
  if (!messageId || !emoji || !userId) {
    throw new Error('Message ID, emoji, and User ID are required to react.');
  }

  if (auth.currentUser) {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/chat/reaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messageId,
        emoji,
        action: 'toggle',
        courseId
      })
    });
    if (res.ok) {
      const data = await res.json();
      return {
        active: Boolean(data.active),
        tallies: data.tallies || {},
        userReactions: data.userReactions || []
      };
    }
  }

  return { active: false, tallies: {}, userReactions: [] };
}

/**
 * Retrieves all reactions for a given message ID and current user via Neon API.
 */
export async function getMessageReactions(
  messageId: string, 
  userId?: string
): Promise<ReactionState> {
  if (!messageId) {
    return { tallies: {}, userReactions: [] };
  }

  try {
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    if (!token) return { tallies: {}, userReactions: [] };

    const res = await fetch(`/api/chat/reactions?messageId=${encodeURIComponent(messageId)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      return {
        tallies: data.tallies || {},
        userReactions: data.userReactions || []
      };
    }
  } catch (error) {
    console.warn('Error fetching message reactions via API:', error);
  }

  return { tallies: {}, userReactions: [] };
}

/**
 * Polling subscription for reactions on a specific message.
 */
export function subscribeToMessageReactions(
  messageId: string,
  userId: string | undefined,
  callback: (state: ReactionState) => void
): () => void {
  if (!messageId) {
    callback({ tallies: {}, userReactions: [] });
    return () => {};
  }

  let isActive = true;
  const poll = async () => {
    if (!isActive) return;
    const res = await getMessageReactions(messageId, userId);
    if (isActive) callback(res);
  };

  poll();
  const interval = setInterval(poll, 10000);

  return () => {
    isActive = false;
    clearInterval(interval);
  };
}
