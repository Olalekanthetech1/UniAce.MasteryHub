import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { getPostgresPool } from './postgresPool';
import { logger } from './logger';

export interface ArenaActionEvent {
  questionIndex: number;
  selectedOption: string;
  correct: boolean;
  elapsedMs: number;
  timestamp: string;
}

export interface ArenaPresenceUser {
  uid: string;
  name: string;
  courseId: string | null;
  status: 'lobby' | 'matching' | 'in_battle';
  connectedAt: string;
  lastHeartbeatMs: number;
}

class ArenaRealtimeManager {
  public wss: WebSocketServer;
  private battleRooms = new Map<string, Set<WebSocket>>();
  private socketMeta = new Map<WebSocket, { uid: string; name: string; battleId: string | null; courseId: string | null }>();
  private onlineUsers = new Map<string, ArenaPresenceUser>();
  private activeBattleTimers = new Map<string, {
    expiresAtEpochMs: number;
    scheduledTimeouts: NodeJS.Timeout[];
  }>();
  private clockInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
    this.setupServer();
  }

  private setupServer() {
    this.wss.on('error', (err) => {
      logger.error({ err: err.message }, '[ArenaWSS] WebSocket server error');
    });

    // Authoritative 1-second real-time clock pulse for active battles
    this.clockInterval = setInterval(() => {
      void this.tickAuthoritativeClock();
    }, 1000);
    this.clockInterval.unref?.();
  }

  public async handleConnection(ws: WebSocket, req: IncomingMessage, getAdminApp: () => any) {
    try {
      const host = req.headers.host || 'localhost:3000';
      const url = new URL(req.url || '', `http://${host}`);
      const token = url.searchParams.get('token');
      const initialCourseId = url.searchParams.get('courseId') || null;
      const initialBattleId = url.searchParams.get('battleId') || null;

      if (!token) {
        ws.close(1008, 'Authentication token required');
        return;
      }

      const app = getAdminApp();
      if (!app) {
        ws.close(1011, 'Authentication service unavailable');
        return;
      }

      let decoded: any;
      try {
        decoded = await app.auth().verifyIdToken(token);
      } catch (err: any) {
        ws.close(1008, 'Invalid authentication token');
        return;
      }

      const uid = decoded.uid;
      const name = decoded.name || decoded.email?.split('@')[0] || 'Scholar';
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      this.socketMeta.set(ws, {
        uid,
        name,
        battleId: initialBattleId,
        courseId: initialCourseId
      });

      this.onlineUsers.set(uid, {
        uid,
        name,
        courseId: initialCourseId,
        status: initialBattleId ? 'in_battle' : 'lobby',
        connectedAt: nowIso,
        lastHeartbeatMs: nowMs
      });

      if (initialBattleId) {
        this.joinBattleRoom(ws, initialBattleId);
        await this.sendAuthoritativeBattleState(ws, initialBattleId);
      }

      // Send initial clock sync and live presence
      this.sendJson(ws, {
        type: 'clock:sync',
        serverNow: Date.now(),
        serverIsoTime: new Date().toISOString(),
        onlineCount: this.onlineUsers.size
      });

      this.broadcastLobbyPresence();

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          const meta = this.socketMeta.get(ws);
          if (!meta) return;

          const currentNow = Date.now();
          const presence = this.onlineUsers.get(meta.uid);
          if (presence) {
            presence.lastHeartbeatMs = currentNow;
          }

          if (msg.type === 'ping' || msg.type === 'clock:sync') {
            this.sendJson(ws, {
              type: 'clock:sync',
              clientSentAt: msg.clientSentAt || null,
              serverNow: currentNow,
              serverIsoTime: new Date(currentNow).toISOString(),
              onlineCount: this.onlineUsers.size
            });
            return;
          }

          if (msg.type === 'presence:update') {
            if (msg.courseId !== undefined) meta.courseId = msg.courseId;
            if (presence) {
              if (msg.courseId !== undefined) presence.courseId = msg.courseId;
              if (msg.status) presence.status = msg.status;
            }
            this.broadcastLobbyPresence();
            return;
          }

          if (msg.type === 'battle:subscribe' && typeof msg.battleId === 'string') {
            if (meta.battleId && meta.battleId !== msg.battleId) {
              this.leaveBattleRoom(ws, meta.battleId);
            }
            meta.battleId = msg.battleId;
            if (presence) presence.status = 'in_battle';
            this.joinBattleRoom(ws, msg.battleId);
            await this.sendAuthoritativeBattleState(ws, msg.battleId);
            return;
          }

          if (msg.type === 'battle:unsubscribe' && typeof msg.battleId === 'string') {
            this.leaveBattleRoom(ws, msg.battleId);
            if (meta.battleId === msg.battleId) meta.battleId = null;
            if (presence) presence.status = 'lobby';
            return;
          }
        } catch (err: any) {
          logger.warn({ err: err.message }, '[ArenaWSS] Failed to handle client message');
        }
      });

      ws.on('close', () => {
        this.cleanupSocket(ws);
      });

      ws.on('error', () => {
        this.cleanupSocket(ws);
      });
    } catch (err: any) {
      logger.error({ err: err.message }, '[ArenaWSS] Connection setup failed');
      try { ws.close(1011, 'Internal server error'); } catch {}
    }
  }

  private joinBattleRoom(ws: WebSocket, battleId: string) {
    let set = this.battleRooms.get(battleId);
    if (!set) {
      set = new Set();
      this.battleRooms.set(battleId, set);
    }
    set.add(ws);
  }

  private leaveBattleRoom(ws: WebSocket, battleId: string) {
    const set = this.battleRooms.get(battleId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        this.battleRooms.delete(battleId);
      }
    }
  }

  private cleanupSocket(ws: WebSocket) {
    const meta = this.socketMeta.get(ws);
    if (meta) {
      if (meta.battleId) {
        this.leaveBattleRoom(ws, meta.battleId);
      }
      this.socketMeta.delete(ws);
      // Only remove online user if no other open socket belongs to that uid
      const stillConnected = Array.from(this.socketMeta.values()).some((m) => m.uid === meta.uid);
      if (!stillConnected) {
        this.onlineUsers.delete(meta.uid);
      }
      this.broadcastLobbyPresence();
    }
  }

  private sendJson(ws: WebSocket, payload: Record<string, any>) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
      } catch {}
    }
  }

  public getOnlinePresenceSummary() {
    const now = Date.now();
    const activeUsers = Array.from(this.onlineUsers.values()).filter(
      (u) => now - u.lastHeartbeatMs < 5 * 60 * 1000
    );
    return {
      onlineCount: activeUsers.length,
      users: activeUsers,
      serverNow: now,
      serverIsoTime: new Date(now).toISOString()
    };
  }

  public broadcastLobbyPresence() {
    const summary = this.getOnlinePresenceSummary();
    const payload = {
      type: 'presence:snapshot',
      ...summary
    };
    for (const ws of this.socketMeta.keys()) {
      this.sendJson(ws, payload);
    }
  }

  public broadcastLobbyQueueUpdate(waitingBattles: any[]) {
    const now = Date.now();
    const payload = {
      type: 'lobby:queue_updated',
      waitingBattles,
      serverNow: now,
      serverIsoTime: new Date(now).toISOString()
    };
    for (const ws of this.socketMeta.keys()) {
      this.sendJson(ws, payload);
    }
  }

  public broadcastToBattle(battleId: string, eventType: string, battleData: any) {
    const set = this.battleRooms.get(battleId);
    const now = Date.now();
    const payload = {
      type: eventType,
      battleId,
      battle: battleData,
      serverNow: now,
      serverIsoTime: new Date(now).toISOString()
    };

    if (set) {
      for (const ws of set) {
        this.sendJson(ws, payload);
      }
    }

    // Also notify any socket belonging to player1 or player2 even if they haven't sent battle:subscribe yet
    const p1Uid = battleData?.player1?.uid;
    const p2Uid = battleData?.player2?.uid;
    for (const [ws, meta] of this.socketMeta.entries()) {
      if ((p1Uid && meta.uid === p1Uid) || (p2Uid && meta.uid === p2Uid)) {
        if (!set || !set.has(ws)) {
          this.joinBattleRoom(ws, battleId);
          meta.battleId = battleId;
          this.sendJson(ws, payload);
        }
      }
    }
  }

  private async sendAuthoritativeBattleState(ws: WebSocket, battleId: string) {
    const pool = getPostgresPool();
    if (!pool) return;
    try {
      const res = await pool.query(`SELECT id, data FROM arena_battles WHERE id = $1`, [battleId]);
      if ((res.rowCount ?? 0) > 0) {
        const battle = { ...res.rows[0].data, id: res.rows[0].id };
        this.sendJson(ws, {
          type: 'battle:state',
          battleId,
          battle,
          serverNow: Date.now(),
          serverIsoTime: new Date().toISOString()
        });
      }
    } catch (err: any) {
      logger.warn({ battleId, err: err.message }, '[ArenaWSS] Failed to fetch battle state');
    }
  }

  /**
   * Registers an active battle with the authoritative server timer and optional scheduled
   * replay/challenger actions so the server executes every state change in real time.
   */
  public registerActiveBattleSchedule(
    battleId: string,
    expiresAtEpochMs: number,
    scheduledActions: Array<{ delayMs: number; execute: () => Promise<void> }> = []
  ) {
    this.clearBattleSchedule(battleId);
    const timeouts: NodeJS.Timeout[] = [];

    for (const item of scheduledActions) {
      const safeDelay = Math.max(500, item.delayMs);
      const t = setTimeout(() => {
        void item.execute().catch((err) => {
          logger.warn({ battleId, err: err?.message }, '[ArenaWSS] Scheduled battle action error');
        });
      }, safeDelay);
      timeouts.push(t);
    }

    this.activeBattleTimers.set(battleId, {
      expiresAtEpochMs,
      scheduledTimeouts: timeouts
    });
  }

  public clearBattleSchedule(battleId: string) {
    const existing = this.activeBattleTimers.get(battleId);
    if (existing) {
      for (const t of existing.scheduledTimeouts) {
        clearTimeout(t);
      }
      this.activeBattleTimers.delete(battleId);
    }
  }

  private async tickAuthoritativeClock() {
    const now = Date.now();
    for (const [battleId, timerInfo] of this.activeBattleTimers.entries()) {
      if (now >= timerInfo.expiresAtEpochMs) {
        this.clearBattleSchedule(battleId);
        await this.settleExpiredBattle(battleId, now);
      }
    }
  }

  public async settleExpiredBattle(battleId: string, nowMs = Date.now()) {
    const pool = getPostgresPool();
    if (!pool) return null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(`SELECT id, data FROM arena_battles WHERE id = $1 FOR UPDATE`, [battleId]);
      if ((res.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const data = { ...(res.rows[0].data || {}), id: battleId };
      if (data.status === 'finished') {
        await client.query('COMMIT');
        return data;
      }

      const p1 = data.player1 || { score: 0, health: 100, uid: '' };
      const p2 = data.player2 || { score: 0, health: 100, uid: '' };

      let winnerId = 'draw';
      if (p1.health <= 0 && p2.health > 0) {
        winnerId = p2.uid;
      } else if (p2.health <= 0 && p1.health > 0) {
        winnerId = p1.uid;
      } else if (p1.score > p2.score) {
        winnerId = p1.uid;
      } else if (p2.score > p1.score) {
        winnerId = p2.uid;
      } else if (p1.health > p2.health) {
        winnerId = p1.uid;
      } else if (p2.health > p1.health) {
        winnerId = p2.uid;
      }

      data.status = 'finished';
      data.winner = winnerId;
      data.finishedAt = new Date(nowMs).toISOString();
      data.finishedAtEpochMs = nowMs;

      await client.query(
        `UPDATE arena_battles
         SET status = 'finished', winner_id = $1, data = $2::jsonb, updated_at = NOW()
         WHERE id = $3`,
        [winnerId, JSON.stringify(data), battleId]
      );

      if (!data.statsSettled) {
        await this.settlePlayersArenaStatsInTx(client, data);
        data.statsSettled = true;
        await client.query(
          `UPDATE arena_battles SET data = $1::jsonb WHERE id = $2`,
          [JSON.stringify(data), battleId]
        );
      }

      await client.query('COMMIT');
      this.broadcastToBattle(battleId, 'battle:finished', data);
      return data;
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ battleId, err: err.message }, '[ArenaWSS] Failed to settle expired battle');
      return null;
    } finally {
      client.release();
    }
  }

  public async settlePlayersArenaStatsInTx(client: any, battleData: any) {
    const winnerId = battleData.winner;
    const players = [battleData.player1, battleData.player2].filter(
      (p) => p && p.uid && !String(p.uid).startsWith('ghost_') && !String(p.uid).startsWith('ai_challenger_')
    );

    for (const p of players) {
      const isWinner = winnerId === p.uid;
      const isDraw = winnerId === 'draw';
      const xpEarned = isWinner ? 100 : isDraw ? 25 : 10;

      const userRow = await client.query(
        `SELECT learning_profile FROM users WHERE uid = $1 FOR UPDATE`,
        [p.uid]
      );
      if ((userRow.rowCount ?? 0) > 0) {
        const lp = { ...(userRow.rows[0].learning_profile || {}) };
        const prevXp = Number(lp.xp || 0);
        const nextXp = prevXp + xpEarned;
        const nextLevel = Math.max(1, Math.floor(nextXp / 1000) + 1);
        const prevWins = Number(lp.arenaWins || 0);
        const prevLosses = Number(lp.arenaLosses || 0);
        const prevWinStreak = Number(lp.arenaWinStreak || 0);

        lp.xp = nextXp;
        lp.level = nextLevel;
        if (isWinner) {
          lp.arenaWins = prevWins + 1;
          lp.arenaWinStreak = prevWinStreak + 1;
          lp.bestArenaWinStreak = Math.max(Number(lp.bestArenaWinStreak || 0), lp.arenaWinStreak);
        } else if (!isDraw) {
          lp.arenaLosses = prevLosses + 1;
          lp.arenaWinStreak = 0;
        }
        lp.lastArenaBattleAt = new Date().toISOString();

        await client.query(
          `UPDATE users SET learning_profile = $1::jsonb, updated_at = NOW() WHERE uid = $2`,
          [JSON.stringify(lp), p.uid]
        );
      }
    }
  }
}

export const arenaRealtime = new ArenaRealtimeManager();
