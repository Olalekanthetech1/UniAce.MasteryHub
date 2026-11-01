import { Router, Request, Response } from 'express';
import {
  searchAcademicPapers,
  getCitationAndAbstract,
  extractCanonicalDefinitions,
  checkAcademicProvidersHealth,
  getAcademicConfig,
  updateAcademicConfig,
} from '../academicResearchEngine.js';
import { getPostgresPool } from '../postgresPool.js';

const router = Router();

// 1. Search Academic Papers
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, fieldOfStudy, limit, minYear, courseCode, syllabusText } = req.body;
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
      syllabusText
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

    const definition = await extractCanonicalDefinitions(subject, topic);
    if (!definition) {
      return res.status(404).json({
        error: 'No source-provided definition is available.',
        message: 'OpenAlex did not return a concept record with a source-provided description. No definition was generated as a substitute.'
      });
    }
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

    let totalLogCount: number | null = null;
    const pool = getPostgresPool();
    if (pool) {
      try {
        const countRes = await pool.query(`SELECT COUNT(*)::int AS cnt FROM system_logs WHERE category = 'academic_research'`);
        totalLogCount = Number(countRes.rows[0]?.cnt);
      } catch (err) {
        console.warn('Log count error:', err);
      }
    }

    const enabledHealth = health.filter((provider) => provider.status !== 'disabled');
    const status = enabledHealth.length > 0 && enabledHealth.every((provider) => provider.status === 'healthy')
      ? 'operational'
      : 'degraded';

    res.json({
      status,
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
router.get('/config', async (_req: Request, res: Response) => {
  try {
    res.json(await getAcademicConfig());
  } catch (error) {
    console.error('Academic config read failed:', error);
    res.status(503).json({
      error: 'Academic research configuration is unavailable from the authoritative database.'
    });
  }
});

// 6. Admin Config POST
router.post('/config', async (req: Request, res: Response) => {
  try {
    const updated = await updateAcademicConfig(req.body);
    res.json({ message: 'Academic research configuration persisted successfully.', config: updated });
  } catch (error) {
    const message = (error as Error).message;
    const isValidationError = message.startsWith('Invalid academic research configuration') ||
      message.startsWith('At least one academic research provider') ||
      message.startsWith('A Semantic Scholar API key');
    res.status(isValidationError ? 400 : 503).json({
      error: 'Failed to persist academic research configuration.',
      message
    });
  }
});

// 7. Admin Live Smoke Test Sandbox
router.post('/test', async (req: Request, res: Response) => {
  try {
    const { query, limit = 3 } = req.body || {};
    if (typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: 'A real research query is required for the live smoke test.' });
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
