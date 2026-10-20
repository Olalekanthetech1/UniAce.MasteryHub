import { auth } from '../firebase';

export type LogLevel = 'info' | 'warning' | 'error' | 'success';
export type LogCategory = 'user' | 'admin' | 'system' | 'ai';

export interface SystemLog {
  id?: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: any;
  userId?: string;
  userEmail?: string;
  timestamp: any;
}

const clientLogDedupeMap = new Map<string, number>();
const CLIENT_LOG_DEDUPE_MS = 10 * 60 * 1000;
const clientMemoryLogs: SystemLog[] = [];
const MAX_CLIENT_MEMORY_LOGS = 100;

export const LogService = {
  async log(level: LogLevel, category: LogCategory, message: string, details?: any) {
    try {
      const user = auth.currentUser;
      const safeDetails = details ? JSON.parse(JSON.stringify(details)) : null;

      clientMemoryLogs.unshift({
        id: `local_${Date.now()}`,
        level,
        category,
        message,
        details: safeDetails,
        userId: user?.uid || 'system',
        userEmail: user?.email || 'system',
        timestamp: new Date().toISOString()
      });
      if (clientMemoryLogs.length > MAX_CLIENT_MEMORY_LOGS) {
        clientMemoryLogs.pop();
      }

      if (level !== 'error' && category !== 'admin') {
        return;
      }

      const dedupeKey = `${level}:${category}:${message.slice(0, 120)}`;
      const now = Date.now();
      const lastSent = clientLogDedupeMap.get(dedupeKey) || 0;
      if (now - lastSent < CLIENT_LOG_DEDUPE_MS) {
        return;
      }
      clientLogDedupeMap.set(dedupeKey, now);

      const token = user ? await user.getIdToken(false) : null;

      const response = await fetch('/api/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          level,
          category,
          message,
          details: safeDetails,
          userId: user?.uid || 'system',
          userEmail: user?.email || 'system'
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to log: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to write system log via API:', error);
    }
  },

  async getLogs(count: number = 50, category?: string): Promise<SystemLog[]> {
    try {
      const user = auth.currentUser;
      const token = user ? await user.getIdToken(false) : null;
      if (!token) return clientMemoryLogs.slice(0, count);

      const url = `/api/logs?limit=${count}${category ? `&category=${encodeURIComponent(category)}` : ''}`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.logs)) {
          return json.logs;
        }
      }
      return clientMemoryLogs.slice(0, count);
    } catch (error) {
      console.error('Failed to fetch system logs:', error);
      return clientMemoryLogs.slice(0, count);
    }
  },

  subscribeToLogs(callback: (logs: SystemLog[]) => void, count: number = 50, category?: string) {
    let isActive = true;
    const poll = async () => {
      if (!isActive) return;
      const logs = await this.getLogs(count, category);
      if (isActive) callback(logs);
    };

    poll();
    const interval = setInterval(poll, 10000);

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }
};
