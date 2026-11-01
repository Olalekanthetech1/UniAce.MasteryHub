import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Search,
  CheckCircle2,
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

interface Paper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  year?: number | null;
  venue?: string | null;
  doi?: string;
  url: string;
  pdfUrl?: string;
  citationCount: number | null;
  source: 'arxiv' | 'semantic_scholar' | 'openalex';
  relevanceScore: number;
  syllabusTags: string[];
}

interface ProviderHealth {
  provider: 'arxiv' | 'semantic_scholar' | 'openalex';
  status: 'healthy' | 'degraded' | 'offline';
  latencyMs: number;
  lastChecked: string;
  errorMessage?: string;
}

interface AcademicConfig {
  enabled: boolean;
  cacheTtlHours: number;
  semanticScholarApiKey?: string;
  semanticScholarApiKeyConfigured?: boolean;
  tavilyApiKey?: string;
  tavilyApiKeyConfigured?: boolean;
  openAlexEmail?: string;
  arxivMaxResults: number;
  defaultCourseAlignment: string;
  researchDepth: 'adaptive';
  adaptiveMaxQueries: number;
  minimumUsefulSources: number;
  minimumRelevanceScore: number;
  providersEnabled: {
    arxiv: boolean;
    semanticScholar: boolean;
    openAlex: boolean;
    tavily: boolean;
  };
}

interface WebSource {
  title: string;
  url: string;
  content: string;
  rawContent?: string;
  score: number;
  publishedDate?: string | null;
  sourceClass: 'institutional_domain_candidate' | 'publisher_or_repository_candidate' | 'general_web_candidate';
  verificationStatus: 'unverified';
}

interface WebSourceSearchResult {
  query: string;
  status: 'results_found' | 'no_results';
  escalated: boolean;
  stages: Array<{
    searchDepth: 'basic' | 'advanced';
    resultCount: number;
    usefulSourceCount: number;
    creditsUsed: number | null;
    responseTimeSeconds: number | null;
  }>;
  sources: WebSource[];
  creditsUsed: number | null;
  disclaimer: string;
}

export const AcademicMCPDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'sandbox' | 'config' | 'health' | 'audit'>('sandbox');
  const [loading, setLoading] = useState<boolean>(false);

  // Search Sandbox State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [fieldOfStudy, setFieldOfStudy] = useState<string>('');
  const [courseCode, setCourseCode] = useState<string>('');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [citationFormat, setCitationFormat] = useState<'apa' | 'bibtex'>('apa');
  const [citationResult, setCitationResult] = useState<{ apa: string; bibtex: string } | null>(null);
  const [webResearchQuery, setWebResearchQuery] = useState<string>('');
  const [webResearchLoading, setWebResearchLoading] = useState<boolean>(false);
  const [webResearchResult, setWebResearchResult] = useState<WebSourceSearchResult | null>(null);

  // Engine Stats & Health State
  const [providerHealth, setProviderHealth] = useState<ProviderHealth[]>([]);
  const [config, setConfig] = useState<AcademicConfig>({
    enabled: true,
    cacheTtlHours: 24,
    semanticScholarApiKey: '',
    tavilyApiKey: '',
    openAlexEmail: '',
    arxivMaxResults: 5,
    defaultCourseAlignment: 'Source-backed course alignment',
    researchDepth: 'adaptive',
    adaptiveMaxQueries: 2,
    minimumUsefulSources: 3,
    minimumRelevanceScore: 0.25,
    providersEnabled: {
      arxiv: true,
      semanticScholar: true,
      openAlex: true,
      tavily: false,
    },
  });
  const [totalQueries, setTotalQueries] = useState<number>(0);

  // Fetch Stats & Config
  const fetchStatsAndConfig = async () => {
    try {
      const res = await fetch('/api/academic/stats');
      if (res.ok) {
        const data = await res.json();
        if (data.providerHealth) setProviderHealth(data.providerHealth);
        if (data.config) setConfig({ ...data.config, semanticScholarApiKey: '', tavilyApiKey: '' });
        if (data.totalQueriesLogged !== undefined) setTotalQueries(data.totalQueriesLogged);
      }
    } catch (err) {
      console.error('Failed to fetch academic stats:', err);
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

    try {
      const res = await fetch('/api/academic/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      setPapers(data.papers || []);
      toast.success(`Retrieved ${data.papers?.length ?? 0} scholarly records in ${data.latencyMs}ms`);
    } catch (err) {
      toast.error((err as Error).message || 'Failed to query academic registries');
    } finally {
      setLoading(false);
    }
  };


  const handleWebSourceSearch = async () => {
    if (webResearchQuery.trim().length < 4) {
      toast.error('Enter a course research query of at least four characters.');
      return;
    }
    setWebResearchLoading(true);
    setWebResearchResult(null);
    try {
      const res = await fetch('/api/admin/academic/sources/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: webResearchQuery.trim(), maxResults: 10 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Live curriculum source search failed.');
      setWebResearchResult(data as WebSourceSearchResult);
      toast.success(data.sources?.length ? `Retrieved ${data.sources.length} source candidates` : 'Live search returned no sources.');
    } catch (err) {
      toast.error((err as Error).message || 'Failed to search academic web sources.');
    } finally {
      setWebResearchLoading(false);
    }
  };

  // Generate Citation
  const handleGenerateCitation = async (paper: Paper) => {
    setSelectedPaper(paper);
    try {
      const res = await fetch('/api/academic/citation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    try {
      const res = await fetch('/api/admin/academic/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (res.ok) {
        toast.success('Academic Engine Configuration updated live!');
        fetchStatsAndConfig();
      } else {
        toast.error('Failed to save configuration');
      }
    } catch (err) {
      toast.error('Error saving academic config');
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
              <h2 className="text-xl font-bold tracking-tight text-white">Academic Research & Syllabus Grounding MCP</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                Live Open-Source MCP
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Live Academic Research (Tavily • arXiv • Semantic Scholar • OpenAlex)
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


          <div className="space-y-4 bg-slate-800/40 p-4 rounded-xl border border-slate-700">
            <div>
              <h3 className="text-sm font-semibold text-white">Course and Institutional Source Discovery</h3>
              <p className="text-xs text-slate-400 mt-1">Search the live web for course descriptions, university curricula and relevant academic sources. Results remain unverified candidates until their original publishers and authority are checked.</p>
            </div>
            <div className="flex flex-col md:flex-row gap-3">
              <input
                type="text"
                value={webResearchQuery}
                onChange={(e) => setWebResearchQuery(e.target.value)}
                placeholder="Enter course, subject, institution or curriculum research query"
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
              />
              <button
                onClick={handleWebSourceSearch}
                disabled={webResearchLoading || !config.providersEnabled.tavily}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold"
              >
                {webResearchLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Discover Live Sources
              </button>
            </div>
            {!config.providersEnabled.tavily && (
              <p className="text-xs text-amber-300">Enable Tavily and save the research settings before running web source discovery.</p>
            )}
            {webResearchResult && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-300">{webResearchResult.sources.length} source candidates returned</span>
                  <span className="text-slate-400">Adaptive escalation: {webResearchResult.escalated ? 'advanced search executed' : 'not required'}</span>
                  <span className="text-slate-400">Reported credits: {webResearchResult.creditsUsed ?? 'not supplied by provider'}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {webResearchResult.stages.map((stage, index) => (
                    <span key={index} className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-[11px] text-slate-300">
                      {stage.searchDepth}: {stage.resultCount} results, {stage.usefulSourceCount} above relevance threshold, {stage.creditsUsed ?? 'usage unavailable'} credits
                    </span>
                  ))}
                </div>
                <p className="text-xs text-amber-200/90">{webResearchResult.disclaimer}</p>
                <div className="space-y-2">
                  {webResearchResult.sources.map((source) => (
                    <article key={source.url} className="rounded-lg bg-slate-900/80 border border-slate-700 p-3 space-y-2">
                      <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-cyan-300 hover:underline inline-flex items-center gap-1">
                        {source.title}<ExternalLink className="w-3 h-3" />
                      </a>
                      <p className="text-xs text-slate-300 whitespace-pre-wrap">{source.content}</p>
                      <div className="flex flex-wrap gap-2 text-[10px] text-slate-400">
                        <span>{source.sourceClass.replaceAll('_', ' ')}</span>
                        <span>Relevance score: {source.score ?? 'not supplied'}</span>
                        <span>Verification: {source.verificationStatus}</span>
                        {source.publishedDate && <span>Provider date: {source.publishedDate}</span>}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Results Display */}
          {papers.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Retrieved {papers.length} scholarly records from arXiv, Semantic Scholar, and OpenAlex:</span>
                <span className="text-cyan-300">Live scholarly registry records</span>
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
                          By <span className="text-slate-300">{paper.authors.slice(0, 3).join(', ')}{paper.authors.length > 3 ? ' et al.' : ''}</span> • {paper.venue ? `• ${paper.venue}` : ''} {paper.year != null ? `(${paper.year})` : ''}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-700 text-slate-300">
                          {paper.source}
                        </span>
                        {paper.citationCount != null && (
                          <span className="text-[11px] text-amber-400 font-mono">★ {paper.citationCount} Citations</span>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed">
                      {paper.abstract || 'The source registry did not supply an abstract for this record.'}
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
            <span>Total Logged Academic Searches in Database: <strong className="text-white">{totalQueries}</strong></span>
            <span>Cache TTL: <strong className="text-cyan-400">{config.cacheTtlHours} Hours</strong></span>
          </div>
        </div>
      )}

      {/* TAB 3: ENGINE CONFIG */}
      {activeTab === 'config' && (
        <div className="space-y-4 bg-slate-800/50 p-5 rounded-xl border border-slate-800">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Settings className="w-4 h-4 text-cyan-400" /> Dynamic Engine Configuration & Rate Limits
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1">
              <label className="text-slate-400">Tavily API Key</label>
              <input
                type="password"
                autoComplete="new-password"
                value={config.tavilyApiKey || ''}
                onChange={(e) => setConfig({ ...config, tavilyApiKey: e.target.value })}
                placeholder={config.tavilyApiKeyConfigured ? 'Credential stored — enter a new key to rotate' : 'Enter Tavily API key'}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
              />
              <p className="text-[11px] text-slate-500">{config.tavilyApiKeyConfigured ? 'A credential is stored. The key itself is never returned to this dashboard.' : 'No Tavily credential is stored.'} Provider credentials are encrypted before they are written to Neon.</p>
            </div>

            <div className="space-y-1">
              <label className="text-slate-400">Semantic Scholar API Key (Optional)</label>
              <input
                type="password"
                autoComplete="new-password"
                value={config.semanticScholarApiKey || ''}
                onChange={(e) => setConfig({ ...config, semanticScholarApiKey: e.target.value })}
                placeholder={config.semanticScholarApiKeyConfigured ? 'Credential stored — enter a new key to rotate' : 'Enter Semantic Scholar API key'}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
              />
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
              <label className="text-slate-400">Cache TTL (Hours)</label>
              <input
                type="number"
                min={1}
                max={720}
                value={config.cacheTtlHours}
                onChange={(e) => setConfig({ ...config, cacheTtlHours: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-400">Minimum Useful Sources Before Escalation</label>
              <input
                type="number"
                min={1}
                max={10}
                value={config.minimumUsefulSources}
                onChange={(e) => setConfig({ ...config, minimumUsefulSources: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-400">Minimum Provider Relevance Score (0–1)</label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={config.minimumRelevanceScore}
                onChange={(e) => setConfig({ ...config, minimumRelevanceScore: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-400">Maximum Adaptive Search Passes (1–2)</label>
              <input
                type="number"
                min={1}
                max={2}
                value={config.adaptiveMaxQueries}
                onChange={(e) => setConfig({ ...config, adaptiveMaxQueries: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-white">Adaptive Research</p>
                <p className="text-[11px] text-slate-400">Default research depth. Starts with basic search and escalates to advanced search when the live result set falls below the configured evidence threshold.</p>
              </div>
              <span className="rounded-md bg-cyan-900/60 px-2 py-1 text-[11px] text-cyan-200">adaptive</span>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={config.providersEnabled.tavily}
                onChange={(e) => setConfig({ ...config, providersEnabled: { ...config.providersEnabled, tavily: e.target.checked } })}
                className="accent-cyan-500"
              />
              Enable Tavily live web research
            </label>
          </div>

          <div className="pt-3 flex justify-end">
            <button
              onClick={handleSaveConfig}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition"
            >
              Save Engine Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AcademicMCPDashboard;
