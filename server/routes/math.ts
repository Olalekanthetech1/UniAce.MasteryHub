import express from 'express';
import { getPostgresPool } from '../postgresPool';
import { 
  executeMathComputation, 
  getMathEngineConfig, 
  saveMathEngineConfig, 
  MathCalculationRequest,
  DEFAULT_MATH_CONFIG 
} from '../mathEngine';

export function setupMathRoutes(
  app: express.Express, 
  verifyAuth: any, 
  getAdminApp: any, 
  isAdminEmail: any
) {
  // 1. Primary Math Computation Endpoint (Used by Student AI Chat & Interactive Solvers)
  app.post('/api/math/compute', async (req: express.Request, res: express.Response) => {
    try {
      const { 
        operation = 'simplify', 
        expression, 
        variable = 'x', 
        bounds, 
        matrixA, 
        matrixB, 
        matrixOp, 
        rigorLevel = 'granular' 
      } = req.body;

      if (!expression && !matrixA) {
        return res.status(400).json({ 
          error: 'Missing mathematical expression or matrix payload.' 
        });
      }

      const userId = (req as any).user?.uid || 'anonymous';
      const calcReq: MathCalculationRequest = {
        operation,
        expression: String(expression || ''),
        variable: String(variable || 'x'),
        bounds,
        matrixA,
        matrixB,
        matrixOp,
        rigorLevel,
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
        operation = 'derivative', 
        expression = 'x^3 - 6*x^2 + 11*x - 6', 
        variable = 'x', 
        bounds, 
        matrixA, 
        matrixB, 
        matrixOp = 'determinant',
        rigorLevel = 'granular' 
      } = req.body;

      const calcReq: MathCalculationRequest = {
        operation,
        expression: String(expression || ''),
        variable: String(variable || 'x'),
        bounds,
        matrixA,
        matrixB,
        matrixOp,
        rigorLevel
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
      const avgLatencyMs = totalCount > 0 ? Math.round(totalLatency / totalCount) : 18;
      const successRate = totalCount > 0 ? Number(((successCount / totalCount) * 100).toFixed(1)) : 100.0;

      const currentConfig = await getMathEngineConfig();

      return res.json({
        totalComputations: totalCount,
        avgLatencyMs,
        successRate,
        operationDistribution: opCounts,
        activeEngine: currentConfig.defaultEngine,
        recentEvents: recentLogs
      });
    } catch (error: any) {
      console.error('[MathRoute] Stats Fetch Error:', error);
      return res.status(500).json({ 
        totalComputations: 0,
        avgLatencyMs: 0,
        successRate: 100,
        operationDistribution: {},
        activeEngine: 'SymPy / MathJS Symbolic',
        recentEvents: [],
        error: error.message 
      });
    }
  });

  // 4. Get Math Engine Config
  app.get('/api/admin/math-config', verifyAuth, async (req: express.Request, res: express.Response) => {
    try {
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
      const adminApp = getAdminApp();
      if (!adminApp) return res.status(503).json({ error: 'Firebase not initialized' });

      let isAdmin = false;
      if (isAdminEmail(user.email)) {
        isAdmin = true;
      } else {
        const pool = getPostgresPool();
        if (pool) {
          const res = await pool.query('SELECT role FROM users WHERE uid = $1', [user.uid]);
          if (res.rows.length > 0 && res.rows[0].role === 'admin') {
            isAdmin = true;
          }
        }
      }
      if (!isAdmin) {
        return res.status(403).json({ error: 'Forbidden: Admin access required' });
      }


      const updated = await saveMathEngineConfig(req.body);
      return res.json({ success: true, config: updated });
    } catch (error: any) {
      console.error('[MathRoute] Save Config Error:', error);
      return res.status(500).json({ error: error.message || 'Failed to save math config' });
    }
  });
}
