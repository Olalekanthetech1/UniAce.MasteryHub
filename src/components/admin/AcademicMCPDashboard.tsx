import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Search,
  AlertCircle,
  Clock,
  RefreshCw,
  FileText,
  Download,
  Settings,
  Database,
  Award,
  Layers,
  Zap,
  ExternalLink,
  ShieldAlert,
  Code2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { auth } from '../../firebase';

interface Paper {
  id: string;
  title: string;
  authors: string[];
  abstract: string | null;
  year?: number | null;
  venue?: string | null;
  doi?: string | null;
  url: string;
  pdfUrl?: string | null;
  citationCount: number | null;
  source: 'arxiv' | 'semantic_scholar' | 'openalex';
  relevanceScore: number;
  syllabusTags: string[];
}

interface ProviderHealth {
  provider: 'arxiv' | 'semantic_scholar' | 'openalex' | 'tavily';
  status: 'healthy' | 'degraded' | 'offline' | 'disabled' | 'not_configured';
  latencyMs: number;
  lastChecked: string;
  errorMessage?: string;
}

interface AcademicConfig {
  enabled: boolean;
  cacheTtlHours: number;
  semanticScholarApiKeyConfigured: boolean;
  tavilyApiKeyConfigured: boolean;
  openAlexEmail?: string;
  arxivMaxResults: number;
  researchDepth: 'adaptive' | 'basic' | 'advanced';
  maxExpansionRounds: number;
  minimumEvidenceCount: number;
  maxWebResults: number;
  providersEnabled: {
    arxiv: boolean;
    semanticScholar: boolean;
    openAlex: boolean;
    tavily: boolean;
  };
}

interface WebSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  content: string | null;
  score: number | null;
  searchDepth: 'basic' | 'advanced';
  authorityClass: string;
  verificationStatus: 'unverified';
}

interface EvidenceAssessment {
  status: 'candidate_evidence_found' | 'insufficient_candidate_evidence' | 'no_evidence';
  evidenceCount: number;
  relevantEvidenceCount: number;
  queryTermCoverage: number;
  minimumEvidenceCount: number;
  expansionReasons: string[];
}

export const AcademicMCPDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'sandbox' | 'config' | 'health' | 'audit'>('sandbox');
  const [loading, setLoading] = useState<boolean>(false);

  // Search Sandbox State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [fieldOfStudy, setFieldOfStudy] = useState<string>('');
  const [courseCode, setCourseCode] = useState<string>('');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [webSources, setWebSources] = useState<WebSource[]>([]);
  const [evidenceAssessment, setEvidenceAssessment] = useState<EvidenceAssessment | null>(null);
  const [researchStatus, setResearchStatus] = useState<string | null>(null);
  const [researchPasses, setResearchPasses] = useState<Array<{ pass: number; searchDepth: string; reason: string }>>([]);
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [citationFormat, setCitationFormat] = useState<'apa' | 'bibtex'>('apa');
  const [citationResult, setCitationResult] = useState<{ apa: string; bibtex: string } | null>(null);

  // Engine Stats & Health State
  const [providerHealth, setProviderHealth] = useState<ProviderHealth[]>([]);
  const [config, setConfig] = useState<AcademicConfig | null>(null);
  const [configLoading, setConfigLoading] = useState<boolean>(true);
  const [configLoadError, setConfigLoadError] = useState<string | null>(null);
  const [totalQueries, setTotalQueries] = useState<number | null>(null);
  const [semanticScholarApiKeyInput, setSemanticScholarApiKeyInput] = useState<string>('');
  const [tavilyApiKeyInput, setTavilyApiKeyInput] = useState<string>('');
  const [clearTavilyApiKey, setClearTavilyApiKey] = useState<boolean>(false);

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Your administrator session is unavailable. Sign in again and retry.');
    }
    const idToken = await currentUser.getIdToken();
    return { Authorization: `Bearer ${idToken}` };
  };

  // Fetch persisted configuration separately from live provider telemetry.
  // If the authoritative read fails, do not present local defaults as real settings.
  const fetchStatsAndConfig = async () => {
    setConfigLoading(true);
    setConfigLoadError(null);

    try {
      const configResponse = await fetch('/api/admin/academic/config', {
        headers: await getAuthHeaders()
      });
      const configData = await configResponse.json();
      if (!configResponse.ok) {
        throw new Error(configData.error || configData.message || 'Unable to read persisted academic research settings.');
      }
      setConfig(configData);
    } catch (err) {
      setConfig(null);
      setConfigLoadError((err as Error).message || 'Academic research settings could not be verified.');
      console.error('Failed to fetch persisted academic configuration:', err);
    } finally {
      setConfigLoading(false);
    }

    try {
      const statsResponse = await fetch('/api/admin/academic/stats', {
        headers: await getAuthHeaders()
      });
      if (!statsResponse.ok) {
        throw new Error('Live academic provider statistics are currently unavailable.');
      }
      const statsData = await statsResponse.json();
      if (statsData.providerHealth) setProviderHealth(statsData.providerHealth);
      if (statsData.totalQueriesLogged !== undefined) {
        setTotalQueries(typeof statsData.totalQueriesLogged === 'number' ? statsData.totalQueriesLogged : null);
      }
    } catch (err) {
      console.error('Failed to fetch academic provider stats:', err);
      setProviderHealth([]);
    }
  };

  useEffect(() => {
    fetchStatsAndConfig();
  }, []);

  // Run Search Sandbox
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setCitationResult(null);
    setSelectedPaper(null);
    setPapers([]);
    setWebSources([]);
    setEvidenceAssessment(null);
    setResearchStatus(null);
    setResearchPasses([]);

    try {
      const res = await fetch('/api/admin/academic/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({
          query: searchQuery,
          fieldOfStudy,
          courseCode,
          limit: 5,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Academic search failed');
      }

      const data = await res.json();
      setPapers(Array.isArray(data.papers) ? data.papers : []);
      setWebSources(Array.isArray(data.webSources) ? data.webSources : []);
      setEvidenceAssessment(data.evidenceAssessment || null);
      setResearchStatus(typeof data.researchStatus === 'string' ? data.researchStatus : null);
      setResearchPasses(Array.isArray(data.researchPasses) ? data.researchPasses : []);
      toast.success(
        `Research completed: ${data.papers?.length || 0} scholarly records and ${data.webSources?.length || 0} web leads in ${data.latencyMs}ms`
      );
    } catch (err) {
      toast.error((err as Error).message || 'Failed to query academic registries');
    } finally {
      setLoading(false);
    }
  };

  // Generate Citation
  const handleGenerateCitation = async (paper: Paper) => {
    setSelectedPaper(paper);
    try {
      const res = await fetch('/api/admin/academic/citation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ identifier: paper.doi || paper.title }),
      });

      if (res.ok) {
        const data = await res.json();
        setCitationResult({ apa: data.apa, bibtex: data.bibtex });
      }
    } catch (err) {
      toast.error('Failed to generate citation formatting');
    }
  };

  // Download .bib File
  const handleDownloadBibTeX = (bibtex: string, title: string) => {
    const blob = new Blob([bibtex], { type: 'text/x-bibtex' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.slice(0, 15).replace(/[^a-z0-9]/gi, '_')}.bib`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Downloaded .bib citation file!');
  };

  // Save Config
  const handleSaveConfig = async () => {
    if (!config) {
      toast.error('Load the persisted academic configuration before saving changes.');
      return;
    }

    try {
      const apiKey = semanticScholarApiKeyInput.trim();
      const payload = {
        enabled: config.enabled,
        cacheTtlHours: config.cacheTtlHours,
        arxivMaxResults: config.arxivMaxResults,
        openAlexEmail: config.openAlexEmail || '',
        providersEnabled: config.providersEnabled,
        researchDepth: config.researchDepth,
        maxExpansionRounds: config.maxExpansionRounds,
        minimumEvidenceCount: config.minimumEvidenceCount,
        maxWebResults: config.maxWebResults,
        ...(apiKey ? { semanticScholarApiKey: apiKey } : {}),
        ...(tavilyApiKeyInput.trim() ? { tavilyApiKey: tavilyApiKeyInput.trim() } : {}),
        ...(clearTavilyApiKey ? { clearTavilyApiKey: true } : {})
      };
      const res = await fetch('/api/admin/academic/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to persist academic research configuration.');
      }

      setConfig(data.config);
      setSemanticScholarApiKeyInput('');
      setTavilyApiKeyInput('');
      setClearTavilyApiKey(false);
      toast.success('Academic research configuration saved to Neon.');
      await fetchStatsAndConfig();
    } catch (err) {
      toast.error((err as Error).message || 'Error saving academic config');
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-slate-100 shadow-2xl space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-cyan-400">
            <BookOpen className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-bold tracking-tight text-white">Academic Research Engine</h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Adaptive research across arXiv, Semantic Scholar, OpenAlex and optional Tavily discovery. Retrieved web sources remain unverified until reviewed.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={fetchStatsAndConfig}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sync Stats</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 space-x-2">
        <button
          onClick={() => setActiveTab('sandbox')}
          className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-medium border-b-2 transition ${
            activeTab === 'sandbox'
              ? 'border-cyan-400 text-cyan-400 bg-cyan-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Search className="w-4 h-4" />
          <span>Research Sandbox & Smoke Test</span>
        </button>

        <button
          onClick={() => setActiveTab('health')}
          className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-medium border-b-2 transition ${
            activeTab === 'health'
              ? 'border-cyan-400 text-cyan-400 bg-cyan-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Zap className="w-4 h-4" />
          <span>Live Provider Telemetry ({providerHealth.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('config')}
          className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-medium border-b-2 transition ${
            activeTab === 'config'
              ? 'border-cyan-400 text-cyan-400 bg-cyan-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Engine Settings & Keys</span>
        </button>
      </div>

      {/* TAB 1: SANDBOX */}
      {activeTab === 'sandbox' && (
        <div className="space-y-6">
          {/* Query Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-800/50 p-4 rounded-xl border border-slate-800">
            <div className="md:col-span-2 space-y-1">
              <label className="text-xs font-medium text-slate-400">Research Topic / Paper Query</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g. quantum algorithms for linear systems"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Field of Study</label>
              <input
                type="text"
                value={fieldOfStudy}
                onChange={(e) => setFieldOfStudy(e.target.value)}
                placeholder="Computer Science, Physics, Mathematics"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Course Alignment</label>
              <input
                type="text"
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value)}
                placeholder="e.g. CSC 401"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="md:col-span-4 flex justify-end">
              <button
                onClick={handleSearch}
                disabled={loading}
                className="flex items-center space-x-2 px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium text-xs shadow-lg shadow-cyan-600/20 transition disabled:opacity-50"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>Execute Live Academic Query</span>
              </button>
            </div>
          </div>

          {/* Results Display */}
          {papers.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Returned {papers.length} scholarly records and {webSources.length} web discovery leads.</span>
              </div>

              <div className="space-y-3">
                {papers.map((paper) => (
                  <div
                    key={paper.id}
                    className="p-4 bg-slate-800/60 border border-slate-700/80 rounded-xl space-y-2 hover:border-slate-600 transition"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <a
                          href={paper.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-sm text-cyan-300 hover:underline flex items-center gap-1.5"
                        >
                          {paper.title}
                          <ExternalLink className="w-3.5 h-3.5 text-slate-400 inline" />
                        </a>
                        <p className="text-xs text-slate-400 mt-1">
                          {paper.authors.length > 0 ? <>By <span className="text-slate-300">{paper.authors.slice(0, 3).join(', ')}{paper.authors.length > 3 ? ' et al.' : ''}</span></> : <span>Author metadata not supplied</span>} • {paper.venue || 'Venue not supplied'} ({paper.year ?? 'Year unavailable'})
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-700 text-slate-300">
                          {paper.source}
                        </span>
                        <span className="text-[11px] text-amber-400 font-mono">
                          {paper.citationCount === null ? 'Citation count unavailable' : `★ ${paper.citationCount} Citations`}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed">
                      {paper.abstract || 'Abstract not supplied by the source registry.'}
                    </p>

                    <div className="pt-2 border-t border-slate-700/50 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center space-x-2">
                        {paper.syllabusTags.map((tag, idx) => (
                          <span key={idx} className="px-2 py-0.5 rounded text-[10px] bg-cyan-950/80 text-cyan-300 border border-cyan-800/50">
                            🎓 {tag}
                          </span>
                        ))}
                        {paper.doi && (
                          <span className="text-[11px] font-mono text-slate-400">
                            DOI: {paper.doi}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-2">
                        {paper.pdfUrl && (
                          <a
                            href={paper.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-xs flex items-center gap-1 transition"
                          >
                            <FileText className="w-3 h-3 text-cyan-400" /> PDF Paper
                          </a>
                        )}

                        <button
                          onClick={() => handleGenerateCitation(paper)}
                          className="px-2.5 py-1 bg-cyan-700/80 hover:bg-cyan-600 text-white rounded text-xs flex items-center gap-1 transition"
                        >
                          <Code2 className="w-3 h-3" /> Cite (BibTeX/APA)
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(researchStatus || evidenceAssessment) && (
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">Research assessment</h3>
                <span className="text-xs rounded-md border border-slate-600 px-2 py-1 text-slate-200">
                  {researchStatus || evidenceAssessment?.status || 'Assessment unavailable'}
                </span>
              </div>
              {evidenceAssessment && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div><p className="text-slate-400">Evidence records</p><p className="text-white font-semibold">{evidenceAssessment.evidenceCount}</p></div>
                  <div><p className="text-slate-400">Relevant records</p><p className="text-white font-semibold">{evidenceAssessment.relevantEvidenceCount}</p></div>
                  <div><p className="text-slate-400">Query-term coverage</p><p className="text-white font-semibold">{Math.round(evidenceAssessment.queryTermCoverage * 100)}%</p></div>
                  <div><p className="text-slate-400">Minimum evidence target</p><p className="text-white font-semibold">{evidenceAssessment.minimumEvidenceCount}</p></div>
                </div>
              )}
              <p className="text-[11px] text-amber-300">
                Candidate evidence is not an academic validation or contradiction check. Web discovery results are unverified and require administrator review before course use.
              </p>
              {researchPasses.length > 0 && (
                <div className="text-xs text-slate-400">
                  {researchPasses.map((pass) => (
                    <p key={pass.pass}>Pass {pass.pass}: {pass.searchDepth} — {pass.reason}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {webSources.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">Web discovery leads — unverified</h3>
              {webSources.map((source) => (
                <div key={source.id} className="rounded-lg border border-amber-700/40 bg-slate-800/50 p-3 space-y-1">
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-cyan-300 hover:underline">
                    {source.title}
                  </a>
                  <p className="text-[11px] text-slate-400">{source.domain} • {source.authorityClass.replace(/_/g, ' ')} • {source.searchDepth} search</p>
                  {source.content && <p className="text-xs text-slate-300 whitespace-pre-wrap">{source.content.slice(0, 900)}{source.content.length > 900 ? '…' : ''}</p>}
                  <p className="text-[11px] text-amber-300">Not verified; do not treat as approved course evidence.</p>
                </div>
              ))}
            </div>
          )}

          {/* Citation Modal / Card */}
          {citationResult && selectedPaper && (
            <div className="p-5 bg-slate-800 border border-cyan-500/40 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
                  <Award className="w-4 h-4" /> Generated Academic Citation: {selectedPaper.title.slice(0, 35)}...
                </h3>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setCitationFormat('apa')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded ${citationFormat === 'apa' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                  >
                    APA 7th
                  </button>
                  <button
                    onClick={() => setCitationFormat('bibtex')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded ${citationFormat === 'bibtex' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                  >
                    BibTeX
                  </button>
                </div>
              </div>

              <div className="p-3 bg-slate-900 border border-slate-700 rounded-lg font-mono text-xs text-emerald-300 overflow-x-auto whitespace-pre-wrap">
                {citationFormat === 'apa' ? citationResult.apa : citationResult.bibtex}
              </div>

              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => handleDownloadBibTeX(citationResult.bibtex, selectedPaper.title)}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg flex items-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5" /> Export .bib File
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: LIVE TELEMETRY */}
      {activeTab === 'health' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {providerHealth.map((ph) => (
              <div key={ph.provider} className="p-4 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm uppercase tracking-wide text-white">{ph.provider}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${ph.status === 'healthy' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>
                    {ph.status}
                  </span>
                </div>

                <div className="space-y-1 text-xs text-slate-400">
                  <div className="flex justify-between">
                    <span>Latency:</span>
                    <span className="font-mono text-cyan-300">{ph.latencyMs} ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Last Ping:</span>
                    <span className="font-mono text-slate-300">{new Date(ph.lastChecked).toLocaleTimeString()}</span>
                  </div>
                </div>

                {ph.errorMessage && (
                  <p className="text-[11px] text-rose-400 bg-rose-950/40 p-2 rounded border border-rose-800/40">
                    {ph.errorMessage}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="p-4 bg-slate-800/40 border border-slate-800 rounded-xl flex items-center justify-between text-xs text-slate-400">
            <span>Total Logged Academic Searches in Database: <strong className="text-white">{totalQueries === null ? 'Unavailable' : totalQueries}</strong></span>
            <span>Cache TTL: <strong className="text-cyan-400">{config ? `${config.cacheTtlHours} Hours` : configLoading ? 'Loading persisted setting…' : 'Unavailable'}</strong></span>
          </div>
        </div>
      )}

      {/* TAB 3: ENGINE CONFIG */}
      {activeTab === 'config' && (
        <div className="space-y-4 bg-slate-800/50 p-5 rounded-xl border border-slate-800">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Settings className="w-4 h-4 text-cyan-400" /> Persisted Academic Research Configuration
          </h3>

          {configLoading ? (
            <p className="text-xs text-slate-400">Reading the authoritative configuration from Neon…</p>
          ) : !config ? (
            <div className="space-y-3">
              <p className="text-xs text-rose-300">{configLoadError || 'Persisted configuration is unavailable. Settings are not editable until the authoritative read succeeds.'}</p>
              <button
                onClick={fetchStatsAndConfig}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg"
              >
                Retry configuration read
              </button>
            </div>
          ) : (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1">
              <label className="text-slate-400">Semantic Scholar API Key</label>
              <input
                type="password"
                autoComplete="new-password"
                value={semanticScholarApiKeyInput}
                onChange={(e) => setSemanticScholarApiKeyInput(e.target.value)}
                placeholder={config.semanticScholarApiKeyConfigured ? 'Enter a replacement key; leave blank to keep the stored key' : 'Enter API key'}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
              />
              <p className="text-[11px] text-slate-500">
                {config.semanticScholarApiKeyConfigured
                  ? 'A credential is stored encrypted on the server. Its value is never returned to this dashboard.'
                  : 'No Semantic Scholar credential is currently stored. A key is optional.'}
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-slate-400">Tavily API Key</label>
              <input
                type="password"
                autoComplete="new-password"
                value={tavilyApiKeyInput}
                onChange={(e) => { setTavilyApiKeyInput(e.target.value); setClearTavilyApiKey(false); }}
                placeholder={config.tavilyApiKeyConfigured ? 'Enter a replacement key' : 'Enter Tavily API key'}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
              />
              <p className="text-[11px] text-slate-500">
                {config.tavilyApiKeyConfigured ? 'A key is stored encrypted on the server; it is never returned to this dashboard.' : 'No Tavily key is stored. Web search remains unavailable until a key is saved.'}
              </p>
              {config.tavilyApiKeyConfigured && (
                <label className="flex items-center gap-2 text-[11px] text-rose-300">
                  <input type="checkbox" checked={clearTavilyApiKey} onChange={(e) => setClearTavilyApiKey(e.target.checked)} />
                  Remove stored Tavily key
                </label>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-slate-400">OpenAlex Polite User Agent Email</label>
              <input
                type="email"
                value={config.openAlexEmail || ''}
                onChange={(e) => setConfig({ ...config, openAlexEmail: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-400">Research Depth</label>
              <select
                value={config.researchDepth}
                onChange={(e) => setConfig({ ...config, researchDepth: e.target.value as AcademicConfig['researchDepth'] })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
              >
                <option value="adaptive">Adaptive (default)</option>
                <option value="basic">Basic</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-slate-400">Maximum Adaptive Expansion Rounds (0–2)</label>
              <input type="number" min={0} max={2} value={config.maxExpansionRounds}
                onChange={(e) => setConfig({ ...config, maxExpansionRounds: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white" />
            </div>

            <div className="space-y-1">
              <label className="text-slate-400">Minimum Evidence Count</label>
              <input type="number" min={1} max={20} value={config.minimumEvidenceCount}
                onChange={(e) => setConfig({ ...config, minimumEvidenceCount: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white" />
            </div>

            <div className="space-y-1">
              <label className="text-slate-400">Maximum Tavily Results per Pass</label>
              <input type="number" min={1} max={20} value={config.maxWebResults}
                onChange={(e) => setConfig({ ...config, maxWebResults: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white" />
            </div>

            <div className="space-y-1">
              <label className="text-slate-400">Cache TTL (Hours)</label>
              <input
                type="number"
                value={config.cacheTtlHours}
                onChange={(e) => setConfig({ ...config, cacheTtlHours: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
              />
            </div>

            <div className="md:col-span-2 border-t border-slate-700 pt-3">
              <p className="text-slate-300 font-semibold mb-2">Enabled research providers</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['arxiv', 'arXiv'],
                  ['semanticScholar', 'Semantic Scholar'],
                  ['openAlex', 'OpenAlex'],
                  ['tavily', 'Tavily web discovery']
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-slate-300">
                    <input
                      type="checkbox"
                      checked={config.providersEnabled[key]}
                      onChange={(e) => setConfig({
                        ...config,
                        providersEnabled: { ...config.providersEnabled, [key]: e.target.checked }
                      })}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {config.providersEnabled.tavily && !config.tavilyApiKeyConfigured && !tavilyApiKeyInput.trim() && (
                <p className="text-amber-300 mt-2">Tavily cannot run until a key is saved.</p>
              )}
            </div>
          </div>

          <div className="pt-3 flex justify-end">
            <button
              onClick={handleSaveConfig}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition"
            >
              Save Engine Settings
            </button>
          </div>
          </>
          )}
        </div>
      )}
    </div>
  );
};

export default AcademicMCPDashboard;
