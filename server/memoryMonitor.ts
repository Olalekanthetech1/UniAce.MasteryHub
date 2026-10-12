import fs from 'fs';
import os from 'os';
import v8 from 'v8';
import admin from 'firebase-admin';
import { getAdminApp } from './firebaseAdmin';

export interface LiveMemoryStats {
  timestamp: string;
  rssMB: number;
  heapUsedMB: number;
  heapTotalMB: number;
  heapLimitMB: number;
  availableHeapMB: number;
  externalMB: number;
  arrayBuffersMB: number;
  hostTotalMB: number;
  hostFreeMB: number;
  cgroupCurrentMB: number | null;
  cgroupLimitMB: number | null;
  heapUtilizationPct: number;
  hostUtilizationPct: number;
  effectiveHeadroomRatio: number;
  cpuCount: number;
  loadAvg1m: number;
  uptimeSeconds: number;
  activeCourseJobs: number;
}

export type AuditLogLevel = 'info' | 'warning' | 'error' | 'success';
export type AuditLogCategory = 'user' | 'admin' | 'system' | 'ai';

function readCgroupByteValue(paths: string[]): number | null {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8').trim();
        if (raw && raw !== 'max') {
          const parsed = parseInt(raw, 10);
          if (!isNaN(parsed) && parsed > 0 && parsed < Number.MAX_SAFE_INTEGER) {
            return parsed;
          }
        }
      }
    } catch {
      // Ignore unreadable cgroup paths
    }
  }
  return null;
}

export function getLiveMemoryTelemetry(activeCourseJobs: number = 0): LiveMemoryStats {
  const memUsage = process.memoryUsage();
  const heapStats = v8.getHeapStatistics();

  const osTotalBytes = os.totalmem();
  const osFreeBytes = os.freemem();

  const cgroupLimitBytes = readCgroupByteValue([
    '/sys/fs/cgroup/memory.max',
    '/sys/fs/cgroup/memory/memory.limit_in_bytes'
  ]);
  const cgroupCurrentBytes = readCgroupByteValue([
    '/sys/fs/cgroup/memory.current',
    '/sys/fs/cgroup/memory/memory.usage_in_bytes'
  ]);

  const effectiveHostTotalBytes =
    cgroupLimitBytes && cgroupLimitBytes < osTotalBytes ? cgroupLimitBytes : osTotalBytes;
  const effectiveHostUsedBytes =
    cgroupCurrentBytes !== null ? cgroupCurrentBytes : Math.max(0, osTotalBytes - osFreeBytes);
  const effectiveHostFreeBytes = Math.max(0, effectiveHostTotalBytes - effectiveHostUsedBytes);

  const toMB = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 100) / 100;

  const rssMB = toMB(memUsage.rss);
  const heapUsedMB = toMB(heapStats.used_heap_size);
  const heapTotalMB = toMB(heapStats.total_heap_size);
  const heapLimitMB = toMB(heapStats.heap_size_limit);
  const availableHeapMB = toMB(Math.max(0, heapStats.heap_size_limit - heapStats.used_heap_size));
  const externalMB = toMB(memUsage.external);
  const arrayBuffersMB = toMB(memUsage.arrayBuffers || 0);
  const hostTotalMB = toMB(effectiveHostTotalBytes);
  const hostFreeMB = toMB(effectiveHostFreeBytes);

  const heapUtilizationPct =
    heapStats.heap_size_limit > 0
      ? Math.round((heapStats.used_heap_size / heapStats.heap_size_limit) * 10000) / 100
      : 0;
  const hostUtilizationPct =
    effectiveHostTotalBytes > 0
      ? Math.round((effectiveHostUsedBytes / effectiveHostTotalBytes) * 10000) / 100
      : 0;

  const heapHeadroom =
    heapStats.heap_size_limit > 0
      ? Math.max(0, (heapStats.heap_size_limit - heapStats.used_heap_size) / heapStats.heap_size_limit)
      : 0;
  const hostHeadroom =
    effectiveHostTotalBytes > 0
      ? Math.max(0, effectiveHostFreeBytes / effectiveHostTotalBytes)
      : heapHeadroom;

  const effectiveHeadroomRatio = Math.round(Math.min(heapHeadroom, hostHeadroom) * 1000) / 1000;
  const loadAvg = os.loadavg();

  return {
    timestamp: new Date().toISOString(),
    rssMB,
    heapUsedMB,
    heapTotalMB,
    heapLimitMB,
    availableHeapMB,
    externalMB,
    arrayBuffersMB,
    hostTotalMB,
    hostFreeMB,
    cgroupCurrentMB: cgroupCurrentBytes !== null ? toMB(cgroupCurrentBytes) : null,
    cgroupLimitMB: cgroupLimitBytes !== null && cgroupLimitBytes < osTotalBytes ? toMB(cgroupLimitBytes) : null,
    heapUtilizationPct,
    hostUtilizationPct,
    effectiveHeadroomRatio,
    cpuCount: Math.max(1, os.cpus()?.length || 1),
    loadAvg1m: Math.round((loadAvg[0] || 0) * 100) / 100,
    uptimeSeconds: Math.round(process.uptime()),
    activeCourseJobs
  };
}

import crypto from 'crypto';
import { dbTelemetry } from './dbTelemetry';

export interface BufferedBackendLogEntry {
  id: string;
  level: AuditLogLevel;
  category: AuditLogCategory;
  message: string;
  details: any;
  userId: string;
  userEmail: string;
  timestampIso: string;
}

const recentBackendLogsRingBuffer: BufferedBackendLogEntry[] = [];
const MAX_RING_BUFFER_LOGS = 200;
const recentFirestoreLogDedupeMap = new Map<string, number>();
const LOG_DEDUPE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes deduplication per signature

export function getBufferedBackendSystemLogs(limit: number = 100): BufferedBackendLogEntry[] {
  return recentBackendLogsRingBuffer.slice(0, Math.max(1, Math.min(limit, MAX_RING_BUFFER_LOGS)));
}

export async function recordBackendSystemLog(
  level: AuditLogLevel,
  category: AuditLogCategory,
  message: string,
  details?: Record<string, any> | null,
  actor?: { uid?: string; email?: string },
  options?: { forcePersistToFirestore?: boolean }
): Promise<void> {
  try {
    let safeDetails: any = null;
    if (details !== undefined && details !== null) {
      try {
        safeDetails = JSON.parse(JSON.stringify(details));
      } catch {
        safeDetails = { info: String(details) };
      }
    }

    const entryId = `memlog_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    recentBackendLogsRingBuffer.unshift({
      id: entryId,
      level,
      category,
      message,
      details: safeDetails,
      userId: actor?.uid || 'system',
      userEmail: actor?.email || 'system',
      timestampIso: new Date().toISOString()
    });
    if (recentBackendLogsRingBuffer.length > MAX_RING_BUFFER_LOGS) {
      recentBackendLogsRingBuffer.pop();
    }

    // Only persist to Firestore system_logs when explicitly forced, or for security/error/admin-mutation events
    const shouldPersist =
      options?.forcePersistToFirestore === true ||
      level === 'error' ||
      (category as string) === 'security' ||
      (category === 'admin' && !message.includes('GET ') && !message.includes('keep-alive'));

    if (!shouldPersist) {
      dbTelemetry.recordSuppressedWrite('system_logs', 'buffered_routine_info_or_warning_log', 1);
      return;
    }

    const dedupeKey = `${level}:${category}:${message.slice(0, 120)}`;
    const now = Date.now();
    const lastPersistedAt = recentFirestoreLogDedupeMap.get(dedupeKey) || 0;
    if (!options?.forcePersistToFirestore && now - lastPersistedAt < LOG_DEDUPE_WINDOW_MS) {
      dbTelemetry.recordSuppressedWrite('system_logs', 'deduplicated_repeated_system_log', 1);
      return;
    }
    recentFirestoreLogDedupeMap.set(dedupeKey, now);

    const app = getAdminApp();
    if (!app) return;
    const db = app.firestore();
    const logRef = db.collection('system_logs').doc();
    await logRef.set({
      id: logRef.id,
      level,
      category,
      message,
      details: safeDetails,
      userId: actor?.uid || 'system',
      userEmail: actor?.email || 'system',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (err: any) {
    console.warn('[SystemAuditLogger] Could not persist system_log entry:', err?.message || err);
  }
}

let memoryMonitorInterval: NodeJS.Timeout | null = null;
let lastMemoryWarningFirestoreWriteAt = 0;
const MEMORY_WARNING_FIRESTORE_THROTTLE_MS = 30 * 60 * 1000; // Max 1 write per 30 minutes

export function startMemoryMonitoringUtility(getActiveJobsCount: () => number): NodeJS.Timeout {
  if (memoryMonitorInterval) {
    clearInterval(memoryMonitorInterval);
  }

  const logMemorySnapshot = (isInitial: boolean = false) => {
    const stats = getLiveMemoryTelemetry(getActiveJobsCount());
    const summaryMsg = isInitial
      ? `[MemoryMonitor] Initialized dynamic memory manager — Heap: ${stats.heapUsedMB}/${stats.heapLimitMB} MB (${stats.heapUtilizationPct}%), RSS: ${stats.rssMB} MB, Host Available: ${stats.hostFreeMB}/${stats.hostTotalMB} MB (${stats.hostUtilizationPct}% used), CPUs: ${stats.cpuCount}`
      : `[MemoryMonitor] 1m Telemetry — Heap: ${stats.heapUsedMB}/${stats.heapLimitMB} MB (${stats.heapUtilizationPct}%), RSS: ${stats.rssMB} MB, Host Free: ${stats.hostFreeMB}/${stats.hostTotalMB} MB, Active Jobs: ${stats.activeCourseJobs}, Uptime: ${stats.uptimeSeconds}s`;

    if (stats.heapUtilizationPct >= 85 || stats.hostUtilizationPct >= 90) {
      console.warn(summaryMsg);
      const now = Date.now();
      if (now - lastMemoryWarningFirestoreWriteAt >= MEMORY_WARNING_FIRESTORE_THROTTLE_MS) {
        lastMemoryWarningFirestoreWriteAt = now;
        void recordBackendSystemLog('warning', 'system', summaryMsg, stats, undefined, { forcePersistToFirestore: true });
      } else {
        dbTelemetry.recordSuppressedWrite('system_logs', 'throttled_1m_memory_warning', 1);
      }
    } else {
      console.log(summaryMsg);
    }
  };

  setTimeout(() => logMemorySnapshot(true), 2000);

  memoryMonitorInterval = setInterval(() => {
    logMemorySnapshot(false);
  }, 60 * 1000);

  return memoryMonitorInterval;
}
