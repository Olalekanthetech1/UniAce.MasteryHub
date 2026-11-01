import React, { useState, useEffect } from 'react';
import { auth } from '../../firebase';
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
  citationCount?: number | null;
  source: 'arxiv' | 'semantic_scholar' | 'openalex';
  relevanceScore: number;
  conceptTags: string[];
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
  arxivMaxResults: number;
  researchDepth: 'adaptive';
  providersEnabled: {
    arxiv: boolean;
    semanticScholar: boolean;
    openAlex: boolean;
  };
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

  // Engine Stats & Health State
  const [providerHealth, setProviderHealth] = useState<ProviderHealth[]>([]);
  const [config, setConfig] = useState<AcademicConfig>({
    enabled: true,
    cacheTtlHours: 24,
    arxivMaxResults: 5,
    researchDepth: 'adaptive',
    providersEnabled: {
      arxiv: true,
      semanticScholar: true,
      openAlex: true,
    },
  });
  const [totalQueries, setTotalQueries] = useState<number>(0);

  const getAdminHeaders = async () => {
    const user = auth.currentUser;
    if (!user) throw new Error('A signed-in administrator session is required.');
    const token = await user.getIdToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  };

  // Fetch Stats & Config from the authenticated admin API.
  const fetchStatsAndConfig = async () => {
    try {
      const res = await fetch('/api/academic/stats', {
        headers: await getAdminHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.providerHealth) setProviderHealth(data.providerHealth);
        if (data.config) setConfig(data.config);
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
        headers: await getAdminHeaders(),
        body: JSON.stringify({
          query: searchQuery,
          ...(fieldOfStudy.trim() ? { fieldOfStudy: fieldOfStudy.trim() } : {}),
          ...(courseCode.trim() ? { courseCode: courseCode.trim() } : {}),
          limit: 5,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Academic search failed');
      }

      const data = await res.json();
      setPapers(data.papers || []);
      toast.success(`Retrieved ${data.papers?.length ?? 0} indexed academic records in ${data.latencyMs}ms`);
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
      const res = await fetch('/api/academic/citation', {
        method: 'POST',
        headers: await getAdminHeaders(),
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
        headers: await getAdminHeaders(),
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
                Live provider access
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Scholarly records from arXiv, Semantic Scholar, and OpenAlex. These indexes are not official university syllabi.
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
          <span>Engine Settings</span>
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
                <span>Returned {papers.length} indexed records from configured scholarly providers:</span>
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Live source response received
                </span>
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
                          {paper.authors.length > 0
                            ? <>By <span className="text-slate-300">{paper.authors.slice(0, 3).join(', ')}{paper.authors.length > 3 ? ' et al.' : ''}</span></>
                            : <span className="text-slate-500">Author metadata not indexed</span>}
                          {' • '}{paper.venue || 'Venue not indexed'} ({paper.year ?? 'Year not indexed'})
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-700 text-slate-300">
                          {paper.source}
                        </span>
                        <span className="text-[11px] text-amber-400 font-mono">
                          {typeof paper.citationCount === 'number'
                            ? `★ ${paper.citationCount} Citations`
                            : 'Citation count not indexed'}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed">
                      {paper.abstract || 'No abstract was supplied by this source index.'}
                    </p>

                    <div className="pt-2 border-t border-slate-700/50 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center space-x-2">
                        {paper.conceptTags.length > 0 && (
                          <span className="text-[10px] text-slate-400">
                            Indexed concepts: {paper.conceptTags.join(', ')}
                          </span>
                        )}
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
              <label className="text-slate-400">Research Depth Default</label>
              <div className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white">
                Adaptive
              </div>
              <p className="text-[11px] text-slate-500">
                Adaptive is persisted as the default research depth. Provider credentials are read only from server environment variables and are never returned to this dashboard.
              </p>
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

            <div className="space-y-1">
              <label className="text-slate-400">Enabled Scholarly Providers</label>
              <div className="text-slate-300">
                {Object.entries(config.providersEnabled)
                  .filter(([, enabled]) => enabled)
                  .map(([provider]) => provider)
                  .join(', ') || 'No scholarly providers enabled'}
              </div>
              <p className="text-[11px] text-slate-500">
                Academic papers and concept records support research; they are not treated as official course outlines or institutional approvals.
              </p>
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
        </div>
      )}
    </div>
  );
};

export default AcademicMCPDashboard;
