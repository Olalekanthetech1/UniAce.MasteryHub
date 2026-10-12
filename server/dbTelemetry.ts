import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type DbOperationType =
  | 'doc_read'
  | 'query_read'
  | 'count_read'
  | 'doc_set'
  | 'doc_update'
  | 'doc_add'
  | 'doc_delete'
  | 'batch_write'
  | 'transaction_write'
  | 'transaction_read';

export interface CollectionTelemetryStats {
  docReads: number;
  queryCalls: number;
  queryDocsRead: number;
  countQueries: number;
  writes: number;
  deletes: number;
  batchWrites: number;
  transactionReads: number;
  transactionWrites: number;
  failedOperations: number;
  quotaExhaustedErrors: number;
  suppressedDuplicateWrites: number;
  lastOperationAtIso: string | null;
}

export interface DbTelemetrySnapshot {
  measurementScope: 'application_attributed_process_telemetry';
  billingCaveat: string;
  instanceId: string;
  processBootTimeIso: string;
  uptimeSeconds: number;
  coldStartCount: number;
  windowStartedAtIso: string;
  totals: {
    totalReadOps: number;
    totalDocsRead: number;
    totalWriteOps: number;
    totalDeleteOps: number;
    totalFailedOps: number;
    totalQuotaExhaustedErrors: number;
    totalSuppressedWrites: number;
    totalBackgroundTaskRuns: number;
  };
  byCollection: Record<string, CollectionTelemetryStats>;
  suppressedByReason: Record<string, number>;
  backgroundTasks: Record<string, { runs: number; lastRunAtIso: string | null; writesTriggered: number }>;
  recentQuotaErrors: Array<{
    timestampIso: string;
    collection: string;
    operation: string;
    errorMessage: string;
  }>;
  persistedHistorySummary: {
    checkpointFile: string;
    persistedSnapshotsCount: number;
    cumulativeHistoricalWrites: number;
    cumulativeHistoricalReads: number;
    cumulativeHistoricalSuppressedWrites: number;
  };
}

const CHECKPOINT_FILE_PATH = path.join(process.cwd(), '.db-telemetry-checkpoints.ndjson');
const MAX_CHECKPOINT_LINES = 200;

class DatabaseTelemetryRegistry {
  private readonly instanceId = `inst_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  private readonly processBootTimeIso = new Date().toISOString();
  private windowStartedAtIso = new Date().toISOString();
  private coldStartCount = 1;
  private byCollection: Map<string, CollectionTelemetryStats> = new Map();
  private suppressedByReason: Map<string, number> = new Map();
  private backgroundTasks: Map<string, { runs: number; lastRunAtIso: string | null; writesTriggered: number }> = new Map();
  private recentQuotaErrors: Array<{
    timestampIso: string;
    collection: string;
    operation: string;
    errorMessage: string;
  }> = [];

  private persistedSnapshotsCount = 0;
  private cumulativeHistoricalWrites = 0;
  private cumulativeHistoricalReads = 0;
  private cumulativeHistoricalSuppressedWrites = 0;

  constructor() {
    this.loadPersistedHistorySummary();
  }

  private getOrCreateCollectionStats(collectionName: string): CollectionTelemetryStats {
    const normalized = collectionName || 'unknown';
    let stats = this.byCollection.get(normalized);
    if (!stats) {
      stats = {
        docReads: 0,
        queryCalls: 0,
        queryDocsRead: 0,
        countQueries: 0,
        writes: 0,
        deletes: 0,
        batchWrites: 0,
        transactionReads: 0,
        transactionWrites: 0,
        failedOperations: 0,
        quotaExhaustedErrors: 0,
        suppressedDuplicateWrites: 0,
        lastOperationAtIso: null
      };
      this.byCollection.set(normalized, stats);
    }
    return stats;
  }

  public recordRead(
    collectionName: string,
    kind: 'doc_read' | 'query_read' | 'count_read' | 'transaction_read',
    docsCount: number = 1
  ): void {
    const stats = this.getOrCreateCollectionStats(collectionName);
    stats.lastOperationAtIso = new Date().toISOString();
    if (kind === 'doc_read') {
      stats.docReads += Math.max(1, docsCount);
    } else if (kind === 'query_read') {
      stats.queryCalls += 1;
      stats.queryDocsRead += Math.max(0, docsCount);
    } else if (kind === 'count_read') {
      stats.countQueries += 1;
    } else if (kind === 'transaction_read') {
      stats.transactionReads += Math.max(1, docsCount);
    }
  }

  public recordWrite(
    collectionName: string,
    kind: 'doc_set' | 'doc_update' | 'doc_add' | 'doc_delete' | 'batch_write' | 'transaction_write',
    count: number = 1
  ): void {
    const stats = this.getOrCreateCollectionStats(collectionName);
    stats.lastOperationAtIso = new Date().toISOString();
    const safeCount = Math.max(1, count);
    if (kind === 'doc_delete') {
      stats.deletes += safeCount;
    } else if (kind === 'batch_write') {
      stats.batchWrites += safeCount;
      stats.writes += safeCount;
    } else if (kind === 'transaction_write') {
      stats.transactionWrites += safeCount;
      stats.writes += safeCount;
    } else {
      stats.writes += safeCount;
    }
  }

  public recordSuppressedWrite(collectionName: string, reason: string, count: number = 1): void {
    const safeCount = Math.max(1, count);
    const stats = this.getOrCreateCollectionStats(collectionName);
    stats.suppressedDuplicateWrites += safeCount;
    this.suppressedByReason.set(reason, (this.suppressedByReason.get(reason) || 0) + safeCount);
  }

  public recordBackgroundTaskRun(taskName: string, writesTriggered: number = 0): void {
    const existing = this.backgroundTasks.get(taskName) || {
      runs: 0,
      lastRunAtIso: null,
      writesTriggered: 0
    };
    existing.runs += 1;
    existing.lastRunAtIso = new Date().toISOString();
    existing.writesTriggered += Math.max(0, writesTriggered);
    this.backgroundTasks.set(taskName, existing);
  }

  public recordOperationError(collectionName: string, operation: string, error: any): void {
    const stats = this.getOrCreateCollectionStats(collectionName);
    stats.failedOperations += 1;
    const msg = String(error?.message || error || '');
    const code = error?.code;
    const isQuotaError =
      code === 8 ||
      code === 'resource-exhausted' ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.toLowerCase().includes('quota exceeded');

    if (isQuotaError) {
      stats.quotaExhaustedErrors += 1;
      this.recentQuotaErrors.unshift({
        timestampIso: new Date().toISOString(),
        collection: collectionName,
        operation,
        errorMessage: msg.slice(0, 300)
      });
      if (this.recentQuotaErrors.length > 50) {
        this.recentQuotaErrors.pop();
      }
    }
  }

  public resetWindow(): void {
    this.byCollection.clear();
    this.suppressedByReason.clear();
    this.backgroundTasks.clear();
    this.recentQuotaErrors = [];
    this.windowStartedAtIso = new Date().toISOString();
  }

  public getSnapshot(): DbTelemetrySnapshot {
    let totalReadOps = 0;
    let totalDocsRead = 0;
    let totalWriteOps = 0;
    let totalDeleteOps = 0;
    let totalFailedOps = 0;
    let totalQuotaExhaustedErrors = 0;
    let totalSuppressedWrites = 0;
    let totalBackgroundTaskRuns = 0;

    const byCollectionObj: Record<string, CollectionTelemetryStats> = {};
    for (const [col, stats] of this.byCollection.entries()) {
      byCollectionObj[col] = { ...stats };
      totalReadOps += stats.docReads + stats.queryCalls + stats.countQueries + stats.transactionReads;
      totalDocsRead += stats.docReads + stats.queryDocsRead + stats.countQueries + stats.transactionReads;
      totalWriteOps += stats.writes;
      totalDeleteOps += stats.deletes;
      totalFailedOps += stats.failedOperations;
      totalQuotaExhaustedErrors += stats.quotaExhaustedErrors;
      totalSuppressedWrites += stats.suppressedDuplicateWrites;
    }

    const suppressedObj: Record<string, number> = {};
    for (const [reason, count] of this.suppressedByReason.entries()) {
      suppressedObj[reason] = count;
    }

    const bgObj: Record<string, { runs: number; lastRunAtIso: string | null; writesTriggered: number }> = {};
    for (const [task, info] of this.backgroundTasks.entries()) {
      bgObj[task] = { ...info };
      totalBackgroundTaskRuns += info.runs;
    }

    return {
      measurementScope: 'application_attributed_process_telemetry',
      billingCaveat:
        'Application-attributed counters measure operations issued by this Node.js server process. Compare against GCP Cloud Monitoring (firestore.googleapis.com/document/read_count & write_count) for multi-instance, index/TTL, and direct client-SDK billed usage.',
      instanceId: this.instanceId,
      processBootTimeIso: this.processBootTimeIso,
      uptimeSeconds: Math.round(process.uptime()),
      coldStartCount: this.coldStartCount,
      windowStartedAtIso: this.windowStartedAtIso,
      totals: {
        totalReadOps,
        totalDocsRead,
        totalWriteOps,
        totalDeleteOps,
        totalFailedOps,
        totalQuotaExhaustedErrors,
        totalSuppressedWrites,
        totalBackgroundTaskRuns
      },
      byCollection: byCollectionObj,
      suppressedByReason: suppressedObj,
      backgroundTasks: bgObj,
      recentQuotaErrors: [...this.recentQuotaErrors],
      persistedHistorySummary: {
        checkpointFile: path.basename(CHECKPOINT_FILE_PATH),
        persistedSnapshotsCount: this.persistedSnapshotsCount,
        cumulativeHistoricalWrites: this.cumulativeHistoricalWrites + totalWriteOps,
        cumulativeHistoricalReads: this.cumulativeHistoricalReads + totalDocsRead,
        cumulativeHistoricalSuppressedWrites: this.cumulativeHistoricalSuppressedWrites + totalSuppressedWrites
      }
    };
  }

  private loadPersistedHistorySummary(): void {
    try {
      if (!fs.existsSync(CHECKPOINT_FILE_PATH)) return;
      const content = fs.readFileSync(CHECKPOINT_FILE_PATH, 'utf8').trim();
      if (!content) return;
      const lines = content.split('\n').filter(Boolean);
      this.persistedSnapshotsCount = lines.length;
      this.coldStartCount = lines.length + 1;
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          this.cumulativeHistoricalWrites += Number(parsed?.totals?.totalWriteOps || 0);
          this.cumulativeHistoricalReads += Number(parsed?.totals?.totalDocsRead || 0);
          this.cumulativeHistoricalSuppressedWrites += Number(parsed?.totals?.totalSuppressedWrites || 0);
        } catch {
          // Ignore malformed line
        }
      }
    } catch {
      // Ignore file read errors in restricted environments
    }
  }

  public persistCheckpointToDisk(): void {
    try {
      const snap = this.getSnapshot();
      const compactEntry = JSON.stringify({
        timestampIso: new Date().toISOString(),
        instanceId: snap.instanceId,
        windowStartedAtIso: snap.windowStartedAtIso,
        uptimeSeconds: snap.uptimeSeconds,
        totals: snap.totals,
        suppressedByReason: snap.suppressedByReason
      });

      let existingLines: string[] = [];
      if (fs.existsSync(CHECKPOINT_FILE_PATH)) {
        existingLines = fs
          .readFileSync(CHECKPOINT_FILE_PATH, 'utf8')
          .split('\n')
          .filter(Boolean);
      }
      existingLines.push(compactEntry);
      if (existingLines.length > MAX_CHECKPOINT_LINES) {
        existingLines = existingLines.slice(-MAX_CHECKPOINT_LINES);
      }
      fs.writeFileSync(CHECKPOINT_FILE_PATH, existingLines.join('\n') + '\n', 'utf8');
      this.persistedSnapshotsCount = existingLines.length;
    } catch {
      // Never throw on local disk telemetry persistence
    }
  }
}

export const dbTelemetry = new DatabaseTelemetryRegistry();

function extractRootCollectionName(pathStr: string | undefined): string {
  if (!pathStr) return 'unknown';
  const parts = pathStr.split('/').filter(Boolean);
  if (parts[0] === '_ci_test_sandboxes' && parts.length >= 3) {
    return `_sandbox:${parts[2]}`;
  }
  return parts[0] || 'unknown';
}

/**
 * Transparently instruments a Firestore instance to count reads, writes, deletes,
 * batches, and transactions per collection without altering Firestore behavior.
 */
export function instrumentFirestoreInstance<T extends Record<string, any>>(firestoreDb: T): T {
  if (!firestoreDb || (firestoreDb as any).__uniaceTelemetryInstrumented) {
    return firestoreDb;
  }
  try {
    Object.defineProperty(firestoreDb, '__uniaceTelemetryInstrumented', {
      value: true,
      enumerable: false,
      configurable: true
    });

    const wrapDocRef = (docRef: any, collectionName: string): any => {
      if (!docRef || docRef.__uniaceDocWrapped) return docRef;
      Object.defineProperty(docRef, '__uniaceDocWrapped', { value: true, enumerable: false });

      if (typeof docRef.get === 'function') {
        const origGet = docRef.get.bind(docRef);
        docRef.get = async (...args: any[]) => {
          try {
            const snap = await origGet(...args);
            dbTelemetry.recordRead(collectionName, 'doc_read', 1);
            return snap;
          } catch (err) {
            dbTelemetry.recordOperationError(collectionName, 'doc.get', err);
            throw err;
          }
        };
      }

      if (typeof docRef.set === 'function') {
        const origSet = docRef.set.bind(docRef);
        docRef.set = async (...args: any[]) => {
          try {
            const res = await origSet(...args);
            dbTelemetry.recordWrite(collectionName, 'doc_set', 1);
            return res;
          } catch (err) {
            dbTelemetry.recordOperationError(collectionName, 'doc.set', err);
            throw err;
          }
        };
      }

      if (typeof docRef.update === 'function') {
        const origUpdate = docRef.update.bind(docRef);
        docRef.update = async (...args: any[]) => {
          try {
            const res = await origUpdate(...args);
            dbTelemetry.recordWrite(collectionName, 'doc_update', 1);
            return res;
          } catch (err) {
            dbTelemetry.recordOperationError(collectionName, 'doc.update', err);
            throw err;
          }
        };
      }

      if (typeof docRef.delete === 'function') {
        const origDelete = docRef.delete.bind(docRef);
        docRef.delete = async (...args: any[]) => {
          try {
            const res = await origDelete(...args);
            dbTelemetry.recordWrite(collectionName, 'doc_delete', 1);
            return res;
          } catch (err) {
            dbTelemetry.recordOperationError(collectionName, 'doc.delete', err);
            throw err;
          }
        };
      }

      if (typeof docRef.collection === 'function') {
        const origSubCol = docRef.collection.bind(docRef);
        docRef.collection = (subPath: string) => {
          const subCol = origSubCol(subPath);
          return wrapQueryOrCollection(subCol, extractRootCollectionName(subCol?.path || `${collectionName}/${subPath}`));
        };
      }

      return docRef;
    };

    const wrapQueryOrCollection = (target: any, collectionName: string): any => {
      if (!target || target.__uniaceQueryWrapped) return target;
      Object.defineProperty(target, '__uniaceQueryWrapped', { value: true, enumerable: false });

      if (typeof target.doc === 'function') {
        const origDoc = target.doc.bind(target);
        target.doc = (...args: any[]) => {
          const docRef = origDoc(...args);
          return wrapDocRef(docRef, collectionName);
        };
      }

      if (typeof target.add === 'function') {
        const origAdd = target.add.bind(target);
        target.add = async (...args: any[]) => {
          try {
            const res = await origAdd(...args);
            dbTelemetry.recordWrite(collectionName, 'doc_add', 1);
            return wrapDocRef(res, collectionName);
          } catch (err) {
            dbTelemetry.recordOperationError(collectionName, 'collection.add', err);
            throw err;
          }
        };
      }

      if (typeof target.get === 'function') {
        const origGet = target.get.bind(target);
        target.get = async (...args: any[]) => {
          try {
            const snap = await origGet(...args);
            const docsRead = typeof snap?.size === 'number' ? snap.size : 1;
            dbTelemetry.recordRead(collectionName, 'query_read', Math.max(1, docsRead));
            return snap;
          } catch (err) {
            dbTelemetry.recordOperationError(collectionName, 'query.get', err);
            throw err;
          }
        };
      }

      if (typeof target.count === 'function') {
        const origCount = target.count.bind(target);
        target.count = (...args: any[]) => {
          const countQuery = origCount(...args);
          if (countQuery && typeof countQuery.get === 'function' && !countQuery.__uniaceCountWrapped) {
            Object.defineProperty(countQuery, '__uniaceCountWrapped', { value: true, enumerable: false });
            const origCountGet = countQuery.get.bind(countQuery);
            countQuery.get = async (...cArgs: any[]) => {
              try {
                const res = await origCountGet(...cArgs);
                dbTelemetry.recordRead(collectionName, 'count_read', 1);
                return res;
              } catch (err) {
                dbTelemetry.recordOperationError(collectionName, 'count.get', err);
                throw err;
              }
            };
          }
          return countQuery;
        };
      }

      for (const chainMethod of ['where', 'orderBy', 'limit', 'limitToLast', 'offset', 'startAt', 'startAfter', 'endAt', 'endBefore', 'select']) {
        if (typeof target[chainMethod] === 'function') {
          const origMethod = target[chainMethod].bind(target);
          target[chainMethod] = (...args: any[]) => {
            const nextQuery = origMethod(...args);
            return wrapQueryOrCollection(nextQuery, collectionName);
          };
        }
      }

      return target;
    };

    if (typeof firestoreDb.collection === 'function') {
      const origCollection = firestoreDb.collection.bind(firestoreDb);
      (firestoreDb as any).collection = (collectionPath: string) => {
        const colRef = origCollection(collectionPath);
        return wrapQueryOrCollection(colRef, extractRootCollectionName(collectionPath));
      };
    }

    if (typeof firestoreDb.doc === 'function') {
      const origRootDoc = firestoreDb.doc.bind(firestoreDb);
      (firestoreDb as any).doc = (docPath: string) => {
        const docRef = origRootDoc(docPath);
        return wrapDocRef(docRef, extractRootCollectionName(docPath));
      };
    }

    if (typeof firestoreDb.batch === 'function') {
      const origBatch = firestoreDb.batch.bind(firestoreDb);
      (firestoreDb as any).batch = () => {
        const batch = origBatch();
        const stagedCounts = new Map<string, { writes: number; deletes: number }>();
        const recordStaged = (ref: any, isDelete: boolean) => {
          const col = extractRootCollectionName(ref?.path);
          const entry = stagedCounts.get(col) || { writes: 0, deletes: 0 };
          if (isDelete) entry.deletes += 1;
          else entry.writes += 1;
          stagedCounts.set(col, entry);
        };

        for (const m of ['set', 'update', 'create'] as const) {
          if (typeof batch[m] === 'function') {
            const origM = batch[m].bind(batch);
            batch[m] = (ref: any, ...rest: any[]) => {
              recordStaged(ref, false);
              return origM(ref, ...rest);
            };
          }
        }
        if (typeof batch.delete === 'function') {
          const origDel = batch.delete.bind(batch);
          batch.delete = (ref: any, ...rest: any[]) => {
            recordStaged(ref, true);
            return origDel(ref, ...rest);
          };
        }
        if (typeof batch.commit === 'function') {
          const origCommit = batch.commit.bind(batch);
          batch.commit = async (...args: any[]) => {
            try {
              const res = await origCommit(...args);
              for (const [col, counts] of stagedCounts.entries()) {
                if (counts.writes > 0) dbTelemetry.recordWrite(col, 'batch_write', counts.writes);
                if (counts.deletes > 0) dbTelemetry.recordWrite(col, 'doc_delete', counts.deletes);
              }
              return res;
            } catch (err) {
              const firstCol = stagedCounts.keys().next().value || 'batch';
              dbTelemetry.recordOperationError(firstCol, 'batch.commit', err);
              throw err;
            }
          };
        }
        return batch;
      };
    }

    if (typeof firestoreDb.runTransaction === 'function') {
      const origRunTx = firestoreDb.runTransaction.bind(firestoreDb);
      (firestoreDb as any).runTransaction = async (updateFn: (tx: any) => Promise<any>, ...rest: any[]) => {
        return origRunTx(async (tx: any) => {
          const stagedTxWrites = new Map<string, { writes: number; deletes: number }>();
          const recordTxWrite = (ref: any, isDelete: boolean) => {
            const col = extractRootCollectionName(ref?.path);
            const entry = stagedTxWrites.get(col) || { writes: 0, deletes: 0 };
            if (isDelete) entry.deletes += 1;
            else entry.writes += 1;
            stagedTxWrites.set(col, entry);
          };

          if (tx && !tx.__uniaceTxWrapped) {
            Object.defineProperty(tx, '__uniaceTxWrapped', { value: true, enumerable: false });
            if (typeof tx.get === 'function') {
              const origTxGet = tx.get.bind(tx);
              tx.get = async (refOrQuery: any, ...gArgs: any[]) => {
                const col = extractRootCollectionName(refOrQuery?.path || refOrQuery?._queryOptions?.collectionId);
                try {
                  const snap = await origTxGet(refOrQuery, ...gArgs);
                  const count = typeof snap?.size === 'number' ? Math.max(1, snap.size) : 1;
                  dbTelemetry.recordRead(col, 'transaction_read', count);
                  return snap;
                } catch (err) {
                  dbTelemetry.recordOperationError(col, 'transaction.get', err);
                  throw err;
                }
              };
            }
            for (const m of ['set', 'update', 'create'] as const) {
              if (typeof tx[m] === 'function') {
                const origM = tx[m].bind(tx);
                tx[m] = (ref: any, ...mArgs: any[]) => {
                  recordTxWrite(ref, false);
                  return origM(ref, ...mArgs);
                };
              }
            }
            if (typeof tx.delete === 'function') {
              const origDel = tx.delete.bind(tx);
              tx.delete = (ref: any, ...dArgs: any[]) => {
                recordTxWrite(ref, true);
                return origDel(ref, ...dArgs);
              };
            }
          }

          const result = await updateFn(tx);
          for (const [col, counts] of stagedTxWrites.entries()) {
            if (counts.writes > 0) dbTelemetry.recordWrite(col, 'transaction_write', counts.writes);
            if (counts.deletes > 0) dbTelemetry.recordWrite(col, 'doc_delete', counts.deletes);
          }
          return result;
        }, ...rest);
      };
    }
  } catch (err) {
    console.warn('[dbTelemetry] Non-fatal instrumentation warning:', err);
  }
  return firestoreDb;
}
