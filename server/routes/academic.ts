import { Router, Request, Response, RequestHandler } from 'express';
import {
  searchAcademicPapers,
  getCitationAndAbstract,
  extractCanonicalDefinitions,
  checkAcademicProvidersHealth,
  getAcademicConfig,
  initializeAcademicConfig,
  updateAcademicConfig,
} from '../academicResearchEngine.js';
import { getPostgresPool } from '../postgresPool.js';

const router = Router();

// populateUser runs globally before this router and verifies the Firebase ID token.
// Admin privileges are resolved only from the server allow-list or Neon.
const requireAcademicAdmin: RequestHandler = async (req, res, next) => {
  const user = (req as any).user;
  const uid = typeof user?.uid === 'string' ? user.uid : '';
  const email = typeof user?.email === 'string' ? user.email : '';

  if (!uid) {
    return res.status(401).json({ error: 'A verified administrator session is required.' });
  }

  const configuredAdmins = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (email && configuredAdmins.includes(email.toLowerCase())) {
    return next();
  }

  const pool = getPostgresPool();
  if (!pool) {
    return res.status(503).json({ error: 'Administrator authorization cannot be verified because Neon PostgreSQL is unavailable.' });
  }

  try {
    const result = await pool.query('SELECT role FROM users WHERE uid = $1 LIMIT 1', [uid]);
    if (result.rows[0]?.role !== 'admin') {
      return res.status(403).json({ error: 'Academic research management is restricted to administrators.' });
    }
    return next();
  } catch (error) {
    console.error('[Academic Research] Admin authorization lookup failed:', error);
    return res.status(503).json({ error: 'Administrator authorization could not be verified.' });
  }
};

router.use(requireAcademicAdmin);

router.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, fieldOfStudy, limit, minYear, courseCode } = req.body || {};
    if (typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'A non-empty research query is required.' });
    }

    const result = await searchAcademicPapers({
      query: query.trim(),
      ...(typeof fieldOfStudy === 'string' && fieldOfStudy.trim() ? { fieldOfStudy: fieldOfStudy.trim() } : {}),
      ...(typeof courseCode === 'string' && courseCode.trim() ? { courseCode: courseCode.trim() } : {}),
      ...(limit !== undefined ? { limit: Number(limit) } : {}),
      ...(minYear !== undefined ? { minYear: Number(minYear) } : {}),
    });
    return res.json(result);
  } catch (error) {
    console.error('[Academic Research] Search failed:', error);
    return res.status(503).json({
      error: 'Academic research search could not be completed from live providers.',
      message: (error as Error).message,
    });
  }
});

router.post('/citation', async (req: Request, res: Response) => {
  try {
    const { identifier, format } = req.body || {};
    if (typeof identifier !== 'string' || !identifier.trim()) {
      return res.status(400).json({ error: 'A DOI, arXiv identifier, or paper title is required.' });
    }

    const citation = await getCitationAndAbstract({ identifier: identifier.trim(), format });
    return res.json(citation);
  } catch (error) {
    console.error('[Academic Research] Citation lookup failed:', error);
    return res.status(404).json({
      error: 'The requested citation could not be verified in the live scholarly registry.',
      message: (error as Error).message,
    });
  }
});

router.post('/definitions', async (req: Request, res: Response) => {
  try {
    const { subject, topic } = req.body || {};
    if (typeof subject !== 'string' || !subject.trim() ||
        typeof topic !== 'string' || !topic.trim()) {
      return res.status(400).json({ error: 'Subject and topic are required.' });
    }

    const definition = await extractCanonicalDefinitions(subject.trim(), topic.trim());
    if (!definition) {
      return res.status(404).json({
        error: 'No source-backed concept definition was found. No definition was generated as a substitute.',
      });
    }
    return res.json(definition);
  } catch (error) {
    console.error('[Academic Research] Definition lookup failed:', error);
    return res.status(503).json({ error: 'The live definition source could not be queried.' });
  }
});

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    await initializeAcademicConfig();
    const providerHealth = await checkAcademicProvidersHealth();
    const pool = getPostgresPool();

    let totalLogCount: number | null = null;
    if (pool) {
      try {
        const countRes = await pool.query(
          `SELECT COUNT(*)::int AS cnt FROM system_logs WHERE category = 'academic_research'`
        );
        totalLogCount = Number(countRes.rows[0]?.cnt);
      } catch (error) {
        console.warn('[Academic Research] Could not read search telemetry count:', error);
      }
    }

    return res.json({
      status: providerHealth.some((provider) => provider.status === 'healthy') ? 'operational' : 'degraded',
      config: getAcademicConfig(),
      providerHealth,
      totalQueriesLogged: totalLogCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Academic Research] Stats unavailable:', error);
    return res.status(503).json({ error: 'Academic research configuration or provider status could not be verified.' });
  }
});

router.get('/config', async (_req: Request, res: Response) => {
  try {
    await initializeAcademicConfig();
    return res.json(getAcademicConfig());
  } catch (error) {
    console.error('[Academic Research] Config read failed:', error);
    return res.status(503).json({ error: 'Academic research configuration could not be read from Neon.' });
  }
});

router.post('/config', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    if (Object.prototype.hasOwnProperty.call(body, 'semanticScholarApiKey') ||
        Object.prototype.hasOwnProperty.call(body, 'tavilyApiKey') ||
        Object.prototype.hasOwnProperty.call(body, 'openAlexEmail')) {
      return res.status(400).json({
        error: 'Provider credentials and contact details must be configured on the server, not stored through the browser configuration endpoint.',
      });
    }

    const updated = await updateAcademicConfig(body);
    return res.json({ message: 'Academic configuration persisted to Neon.', config: updated });
  } catch (error) {
    return res.status(400).json({
      error: 'Academic configuration was not updated.',
      details: (error as Error).message,
    });
  }
});

router.post('/test', async (req: Request, res: Response) => {
  try {
    const { query, limit } = req.body || {};
    if (typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'Provide a research query for the live smoke test.' });
    }
    const searchRes = await searchAcademicPapers({
      query: query.trim(),
      ...(limit !== undefined ? { limit: Number(limit) } : {}),
    });
    const providerHealth = await checkAcademicProvidersHealth();

    return res.json({
      smokeTest: 'completed',
      searchResult: searchRes,
      providerHealth,
    });
  } catch (error) {
    return res.status(503).json({
      smokeTest: 'failed',
      error: (error as Error).message,
    });
  }
});

export default router;
