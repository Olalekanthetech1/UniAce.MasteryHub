/**
 * UniAce Mastery Hub: Multi-Instance Resilient Catalog Cache
 *
 * Implements a memory-bounded LRU cache with:
 * 1. Strict serialized-payload budget (128 MB max).
 * 2. Versioned cache keys (stale content is superseded automatically).
 * 3. Cross-instance invalidation event hooks with fallback TTL.
 * 4. Separate draft vs published cache namespaces.
 */

export interface CacheEntry<T> {
  value: T;
  version: number;
  expiresAt: number;
  byteSize: number;
}

export interface CatalogCacheOptions {
  /** Maximum bytes for cached payload strings (default: 128 MB) */
  maxPayloadBytes?: number;
  /** Default TTL in milliseconds (default: 10 minutes) */
  defaultTtlMs?: number;
  /** Draft TTL in milliseconds (default: 30 seconds) */
  draftTtlMs?: number;
}

export class MultiInstanceCatalogCache {
  private cache = new Map<string, CacheEntry<any>>();
  private currentBytes = 0;
  private maxPayloadBytes: number;
  private defaultTtlMs: number;
  private draftTtlMs: number;
  private globalCatalogVersion = 1;
  private lastVerifiedDbRevision: string | null = null;
  private hits = 0;
  private misses = 0;
  private invalidationListeners: Array<(keyOrPattern: string) => void> = [];

  constructor(options: CatalogCacheOptions = {}) {
    this.maxPayloadBytes = options.maxPayloadBytes || 128 * 1024 * 1024; // 128 MB
    this.defaultTtlMs = options.defaultTtlMs || 10 * 60 * 1000;          // 10 mins
    this.draftTtlMs = options.draftTtlMs || 30 * 1000;                   // 30 secs
  }

  /**
   * Estimates byte size of value using stringification length
   */
  private estimateBytes(value: any): number {
    try {
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      return str.length * 2; // UTF-16 approximation
    } catch {
      return 1024; // fallback 1KB
    }
  }

  /**
   * Evicts least-recently-used items until within byte capacity
   */
  private evictToFit(additionalBytes: number): void {
    if (this.currentBytes + additionalBytes <= this.maxPayloadBytes) return;

    for (const [key, entry] of this.cache.entries()) {
      this.currentBytes -= entry.byteSize;
      this.cache.delete(key);
      if (this.currentBytes + additionalBytes <= this.maxPayloadBytes) break;
    }
  }

  /**
   * Sets a value in the published content cache
   */
  public setPublished<T>(key: string, value: T, version = 1, ttlMs?: number): void {
    this.set(`pub:${key}:v${version}`, value, version, ttlMs || this.defaultTtlMs);
  }

  /**
   * Gets a value from the published content cache if version matches
   */
  public getPublished<T>(key: string, expectedVersion = 1): T | null {
    return this.get(`pub:${key}:v${expectedVersion}`);
  }

  /**
   * Sets an uncommitted course draft in the draft cache (short TTL)
   */
  public setDraft<T>(courseId: string, value: T): void {
    this.set(`draft:course:${courseId}`, value, 0, this.draftTtlMs);
  }

  /**
   * Gets a course draft from the draft cache
   */
  public getDraft<T>(courseId: string): T | null {
    return this.get(`draft:course:${courseId}`);
  }

  private set<T>(fullKey: string, value: T, version: number, ttlMs: number): void {
    const byteSize = this.estimateBytes(value);
    this.evictToFit(byteSize);

    // If key existed, deduct previous byte size
    const existing = this.cache.get(fullKey);
    if (existing) {
      this.currentBytes -= existing.byteSize;
    }

    this.cache.set(fullKey, {
      value,
      version,
      expiresAt: Date.now() + ttlMs,
      byteSize
    });
    this.currentBytes += byteSize;
  }

  private get<T>(fullKey: string): T | null {
    const entry = this.cache.get(fullKey);
    if (!entry) {
      this.misses += 1;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.currentBytes -= entry.byteSize;
      this.cache.delete(fullKey);
      this.misses += 1;
      return null;
    }

    // Refresh LRU ordering
    this.cache.delete(fullKey);
    this.cache.set(fullKey, entry);
    this.hits += 1;
    return entry.value as T;
  }

  /**
   * Reconciles local process cache against the authoritative PostgreSQL catalog revision token.
   * If any instance mutated published courses, modules, lessons, or level availability,
   * the revision token changes and all published entries in this instance are purged immediately.
   */
  public reconcileDatabaseRevision(dbRevision: string): boolean {
    if (!dbRevision) return false;
    if (this.lastVerifiedDbRevision !== null && this.lastVerifiedDbRevision !== dbRevision) {
      for (const key of Array.from(this.cache.keys())) {
        if (key.startsWith('pub:')) {
          const entry = this.cache.get(key);
          if (entry) this.currentBytes -= entry.byteSize;
          this.cache.delete(key);
        }
      }
      this.lastVerifiedDbRevision = dbRevision;
      return true;
    }
    this.lastVerifiedDbRevision = dbRevision;
    return false;
  }

  /**
   * Invalidates a course across local cache and notifies registered listeners
   */
  public invalidateCourse(courseId: string, newVersion = 1): void {
    this.lastVerifiedDbRevision = null;
    // Delete all keys matching this course or aggregate catalog
    for (const key of Array.from(this.cache.keys())) {
      if (key.includes(courseId) || key.includes('catalog:list') || key.includes('catalog:full')) {
        const entry = this.cache.get(key);
        if (entry) this.currentBytes -= entry.byteSize;
        this.cache.delete(key);
      }
    }

    // Notify cross-instance broadcast handlers (Postgres NOTIFY / PubSub)
    for (const listener of this.invalidationListeners) {
      try {
        listener(JSON.stringify({ courseId, newVersion, timestamp: Date.now() }));
      } catch (err) {
        console.warn('Cache invalidation listener error:', err);
      }
    }
  }

  /**
   * Reconciles global catalog version. If changed, purges all catalog lists.
   */
  public reconcileGlobalVersion(dbVersion: number): void {
    if (dbVersion > this.globalCatalogVersion) {
      this.globalCatalogVersion = dbVersion;
      this.lastVerifiedDbRevision = null;
      // Invalidate all catalog listing entries
      for (const key of Array.from(this.cache.keys())) {
        if (key.includes('catalog:list') || key.includes('catalog:full')) {
          const entry = this.cache.get(key);
          if (entry) this.currentBytes -= entry.byteSize;
          this.cache.delete(key);
        }
      }
    }
  }

  /**
   * Invalidates full catalog and list entries across local cache
   */
  public invalidateFullCatalog(): void {
    this.lastVerifiedDbRevision = null;
    for (const key of Array.from(this.cache.keys())) {
      if (key.includes('catalog:full') || key.includes('catalog:list')) {
        const entry = this.cache.get(key);
        if (entry) this.currentBytes -= entry.byteSize;
        this.cache.delete(key);
      }
    }
  }

  /**
   * Registers a listener for cross-instance invalidation broadcasts
   */
  public onInvalidation(fn: (msg: string) => void): () => void {
    this.invalidationListeners.push(fn);
    return () => {
      this.invalidationListeners = this.invalidationListeners.filter(l => l !== fn);
    };
  }

  /**
   * Diagnostic snapshot of memory cache utilization and hit ratio
   */
  public getStats(): {
    itemCount: number;
    memoryBytes: number;
    maxBytes: number;
    globalVersion: number;
    lastVerifiedDbRevision: string | null;
    hits: number;
    misses: number;
    hitRatio: number;
  } {
    const totalLookups = this.hits + this.misses;
    return {
      itemCount: this.cache.size,
      memoryBytes: this.currentBytes,
      maxBytes: this.maxPayloadBytes,
      globalVersion: this.globalCatalogVersion,
      lastVerifiedDbRevision: this.lastVerifiedDbRevision,
      hits: this.hits,
      misses: this.misses,
      hitRatio: totalLookups > 0 ? Number((this.hits / totalLookups).toFixed(4)) : 0
    };
  }

  /**
   * Clears the entire cache (useful for tests and maintenance)
   */
  public clear(): void {
    this.cache.clear();
    this.currentBytes = 0;
    this.lastVerifiedDbRevision = null;
  }

  public invalidateAll(): void {
    this.clear();
  }
}

// Global process-local singleton
export const catalogCache = new MultiInstanceCatalogCache();
