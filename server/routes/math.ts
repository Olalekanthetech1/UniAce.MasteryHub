import express from 'express';
import { getPostgresPool } from '../postgresPool';
import { 
  executeMathComputation, 
  getMathEngineConfig, 
  saveMathEngineConfig, 
  MathCalculationRequest
} from '../mathEngine';

export function setupMathRoutes(
  app: express.Express, 
  verifyAuth: any, 
  getAdminApp: any, 
  isAdminEmail: any
) {
  const requireMathAdmin = async (user: any): Promise<boolean> => {
    if (!user?.uid) return false;
    if (typeof user.email === 'string' && isAdminEmail(user.email)) return true;
    const pool = getPostgresPool();
    if (!pool) return false;
    const result = await pool.query('SELECT role FROM users WHERE uid = $1 LIMIT 1', [user.uid]);
    return result.rows[0]?.role === 'admin';
  };

  // 1. Primary Math Computation Endpoint (Used by Student AI Chat & Interactive Solvers)
  app.post('/api/math/compute', async (req: express.Request, res: express.Response) => {
    try {
      const {
        operation,
        expression,
        variable,
        bounds,
        matrixA,
        matrixB,
        matrixOp,
        rigorLevel
      } = req.body || {};

      if (typeof operation !== 'string' || !operation.trim()) {
        return res.status(400).json({ error: 'A calculation operation is required.' });
      }
      if (operation === 'matrix_operations') {
        if (!Array.isArray(matrixA) || matrixA.length === 0 || !matrixOp) {
          return res.status(400).json({ error: 'A source-supplied matrix and matrix operation are required.' });
        }
      } else if (typeof expression !== 'string' || !expression.trim() || typeof variable !== 'string' || !variable.trim()) {
        return res.status(400).json({ error: 'A mathematical expression and independent variable are required.' });
      }

      const engineConfig = await getMathEngineConfig();
      const effectiveRigor = rigorLevel || engineConfig.defaultRigor;
      const userId = (req as any).user?.uid;
      const calcReq: MathCalculationRequest = {
        operation,
        expression: typeof expression === 'string' ? expression : '',
        variable: typeof variable === 'string' ? variable : undefined,
        bounds,
        matrixA,
        matrixB,
        matrixOp,
        rigorLevel: effectiveRigor,
      };

      const result = await executeMathComputation(calcReq, userId);
      return res.json(result);
    } catch (error: any) {
      console.error('[MathRoute] Compute Error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message || 'Symbolic calculation failed.' 
      });
    }
  });

  // 2. Admin Diagnostic Sandbox Test Endpoint
  app.post('/api/math/test', verifyAuth, async (req: express.Request, res: express.Response) => {
    try {
      const user = (req as any).user;
      const adminApp = getAdminApp();
      if (!adminApp) return res.status(503).json({ error: 'Firebase Admin not initialized' });

      // Verify Admin or Tutor role via Neon PostgreSQL
      let isAdmin = false;
      if (isAdminEmail(user.email)) {
        isAdmin = true;
      } else {
        const pool = getPostgresPool();
        if (pool) {
          const res = await pool.query('SELECT role FROM users WHERE uid = $1', [user.uid]);
          if (res.rows.length > 0 && (res.rows[0].role === 'admin' || res.rows[0].role === 'tutor')) {
            isAdmin = true;
          }
        }
      }
      if (!isAdmin) {
        return res.status(403).json({ error: 'Forbidden: Admin or Tutor access required' });
      }


      const {
        operation,
        expression,
        variable,
        bounds,
        matrixA,
        matrixB,
        matrixOp,
        rigorLevel
      } = req.body || {};

      if (typeof operation !== 'string' || !operation.trim()) {
        return res.status(400).json({ error: 'A calculation operation is required.' });
      }
      if (operation === 'matrix_operations') {
        if (!Array.isArray(matrixA) || matrixA.length === 0 || !matrixOp) {
          return res.status(400).json({ error: 'A source-supplied matrix and matrix operation are required.' });
        }
      } else if (typeof expression !== 'string' || !expression.trim() || typeof variable !== 'string' || !variable.trim()) {
        return res.status(400).json({ error: 'A mathematical expression and independent variable are required.' });
      }

      const engineConfig = await getMathEngineConfig();
      const calcReq: MathCalculationRequest = {
        operation,
        expression: typeof expression === 'string' ? expression : '',
        variable: typeof variable === 'string' ? variable : undefined,
        bounds,
        matrixA,
        matrixB,
        matrixOp,
        rigorLevel: rigorLevel || engineConfig.defaultRigor
      };

      const result = await executeMathComputation(calcReq, user.uid);
      return res.json({
        ...result,
        testedBy: user.email || user.uid,
        testTimestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('[MathRoute] Sandbox Test Error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message || 'Diagnostic sandbox execution failed.' 
      });
    }
  });

  // 3. Telemetry & Analytics Endpoint (Real-Time Stats for Admin Dashboard)
  app.get('/api/math/stats', verifyAuth, async (req: express.Request, res: express.Response) => {
    try {
      if (!(await requireMathAdmin((req as any).user))) return res.status(403).json({ error: 'Admin access required.' });
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Neon PostgreSQL not initialized' });

      const logsRes = await pool.query(
        `SELECT id, metadata, created_at FROM system_logs
         WHERE category = 'math_telemetry'
         ORDER BY created_at DESC LIMIT 50`
      );

      const recentLogs: any[] = [];
      let totalLatency = 0;
      let successCount = 0;
      const opCounts: Record<string, number> = {
        derivative: 0,
        integral: 0,
        solve_equation: 0,
        ode: 0,
        matrix_operations: 0,
        simplify: 0
      };

      for (const row of logsRes.rows) {
        const data = typeof row.metadata === 'object' && row.metadata ? row.metadata : {};
        recentLogs.push({ id: row.id, ...data, timestamp: data.timestamp || new Date(row.created_at).toISOString() });
        if (data.latencyMs) totalLatency += Number(data.latencyMs);
        if (data.success) successCount++;
        if (data.operation && opCounts[data.operation] !== undefined) {
          opCounts[data.operation]++;
        }
      }

      const totalCount = recentLogs.length;
      const avgLatencyMs = totalCount > 0 ? Math.round(totalLatency / totalCount) : null;
      const successRate = totalCount > 0 ? Number(((successCount / totalCount) * 100).toFixed(1)) : null;
      const observedOperations = Object.fromEntries(
        Object.entries(opCounts).filter(([, count]) => count > 0)
      );

      const currentConfig = await getMathEngineConfig();

      return res.json({
        totalComputations: totalCount,
        avgLatencyMs,
        successRate,
        operationDistribution: observedOperations,
        activeEngine: currentConfig.defaultEngine,
        recentEvents: recentLogs
      });
    } catch (error: any) {
      console.error('[MathRoute] Stats Fetch Error:', error);
      return res.status(503).json({
        error: 'Math Engine telemetry or configuration is unavailable.',
        message: error.message
      });
    }
  });

  // 4. Get Math Engine Config
  app.get('/api/admin/math-config', verifyAuth, async (req: express.Request, res: express.Response) => {
    try {
      if (!(await requireMathAdmin((req as any).user))) return res.status(403).json({ error: 'Admin access required.' });
      const config = await getMathEngineConfig();
      return res.json(config);
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Failed to fetch math config' });
    }
  });

  // 5. Update Math Engine Config
  app.post('/api/admin/math-config', verifyAuth, async (req: express.Request, res: express.Response) => {
    try {
      const user = (req as any).user;
      if (!(await requireMathAdmin(user))) {
        return res.status(403).json({ error: 'Admin access required.' });
      }

      const updated = await saveMathEngineConfig(req.body || {});
      return res.json({ success: true, config: updated });
    } catch (error: any) {
      console.error('[MathRoute] Save Config Error:', error);
      return res.status(400).json({ error: error.message || 'Failed to save math config' });
    }
  });
}
