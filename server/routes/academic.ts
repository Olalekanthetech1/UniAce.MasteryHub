import { Router, Request, Response } from 'express';
import {
  searchAcademicPapers,
  getCitationAndAbstract,
  extractCanonicalDefinitions,
  checkAcademicProvidersHealth,
  getAcademicConfig,
  updateAcademicConfig,
  searchAcademicWebSources,
} from '../academicResearchEngine.js';
import { getPostgresPool } from '../postgresPool.js';

const router = Router();

// 1. Search Academic Papers
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, fieldOfStudy, limit, minYear, courseCode } = req.body;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Valid query parameter is required' });
      return;
    }

    const result = await searchAcademicPapers({
      query,
      fieldOfStudy,
      limit: limit ? Number(limit) : 5,
      minYear: minYear ? Number(minYear) : undefined,
      courseCode,
    });

    res.json(result);
  } catch (error) {
    console.error('Academic Search Endpoint Error:', error);
    res.status(503).json({
      error: 'Academic Research Search Error',
      message: (error as Error).message,
    });
  }
});

// 2. Get Citation and Abstract
router.post('/citation', async (req: Request, res: Response) => {
  try {
    const { identifier, format } = req.body;
    if (!identifier) {
      res.status(400).json({ error: 'Identifier (DOI, arXiv ID, or title) is required' });
      return;
    }

    const citation = await getCitationAndAbstract({ identifier, format });
    res.json(citation);
  } catch (error) {
    console.error('Academic Citation Endpoint Error:', error);
    res.status(404).json({
      error: 'Citation Not Found',
      message: (error as Error).message,
    });
  }
});

// 3. Extract Canonical Definitions
router.post('/definitions', async (req: Request, res: Response) => {
  try {
    const { subject, topic, courseCode } = req.body;
    if (!subject || !topic) {
      res.status(400).json({ error: 'Subject and topic parameters are required' });
      return;
    }

    const definition = await extractCanonicalDefinitions(subject, topic, courseCode);
    res.json(definition);
  } catch (error) {
    console.error('Academic Definition Endpoint Error:', error);
    res.status(500).json({
      error: 'Canonical Definition Error',
      message: (error as Error).message,
    });
  }
});

// 4. Get System Stats & Provider Health
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const health = await checkAcademicProvidersHealth();
    const config = await getAcademicConfig();

    let totalLogCount = 0;
    const pool = getPostgresPool();
    if (pool) {
      try {
        const countRes = await pool.query(`SELECT COUNT(*)::int AS cnt FROM system_logs WHERE category = 'academic_research'`);
        totalLogCount = Number(countRes.rows[0]?.cnt || 0);
      } catch (err) {
        console.warn('Log count error:', err);
      }
    }

    res.json({
      status: health.length > 0 && health.every(provider => provider.status === 'healthy') ? 'operational' : 'degraded',
      config,
      providerHealth: health,
      totalQueriesLogged: totalLogCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve academic engine stats' });
  }
});

// 5. Admin Config GET
router.get('/config', async (req: Request, res: Response) => {
  if (!req.baseUrl.startsWith('/api/admin/')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  try {
    res.json(await getAcademicConfig());
  } catch (error) {
    res.status(503).json({ error: 'Academic configuration could not be loaded from the authoritative database.' });
  }
});

// 6. Admin Config POST
router.post('/config', async (req: Request, res: Response) => {
  if (!req.baseUrl.startsWith('/api/admin/')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  try {
    const updated = await updateAcademicConfig(req.body);
    res.json({ message: 'Academic Config updated successfully', config: updated });
  } catch (error) {
    const message = (error as Error).message || 'Failed to update academic config';
    const status = /DATABASE|PostgreSQL|ACADEMIC_CONFIG_ENCRYPTION_KEY|configuration could not be persisted/i.test(message) ? 503 : 400;
    res.status(status).json({ error: 'Failed to update academic config', details: message });
  }
});


router.post('/sources/search', async (req: Request, res: Response) => {
  if (!req.baseUrl.startsWith('/api/admin/')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  try {
    const { query, maxResults } = req.body || {};
    if (typeof query !== 'string' || query.trim().length < 4) {
      res.status(400).json({ error: 'A course research query of at least four characters is required.' });
      return;
    }
    const result = await searchAcademicWebSources({
      query: query.trim(),
      ...(typeof maxResults === 'number' ? { maxResults } : {}),
    });
    res.json(result);
  } catch (error) {
    const message = (error as Error).message || 'Academic web research failed.';
    const status = /not configured|disabled|DATABASE|configuration|ACADEMIC_CONFIG_ENCRYPTION_KEY|PostgreSQL/i.test(message) ? 503 : 502;
    res.status(status).json({ error: message });
  }
});

// 8. Admin Live Smoke Test Sandbox
router.post('/test', async (req: Request, res: Response) => {
  if (!req.baseUrl.startsWith('/api/admin/')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  try {
    const { query, limit = 3 } = req.body;
    if (typeof query !== 'string' || query.trim().length < 2) {
      res.status(400).json({ error: 'A live research query is required.' });
      return;
    }
    const searchRes = await searchAcademicPapers({ query: query.trim(), limit: Number(limit) });
    const health = await checkAcademicProvidersHealth();

    res.json({
      smokeTest: 'passed',
      searchResult: searchRes,
      providerHealth: health,
    });
  } catch (error) {
    res.status(503).json({
      smokeTest: 'failed',
      error: (error as Error).message,
    });
  }
});

export default router;
