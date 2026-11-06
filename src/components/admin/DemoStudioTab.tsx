import React, { useState, useMemo, useEffect } from 'react';
import { useDemoReel } from '../../context/DemoReelContext';
import {
  DemoScenario,
  MarketingTargetScope,
  PlatformMarketingContext,
  buildDynamicDemoScenarios,
  synthesizeCustomDemoScenarioWithAI,
} from '../../services/demoReelService';
import { useMarketingSnapshot } from '../../hooks/useMarketingSnapshot';
import { toMarketingCourseMap } from '../../services/marketingSnapshot';
import DynamicFlyerStudio from './DynamicFlyerStudio';
import {
  Video,
  Play,
  Sparkles,
  Share2,
  Clock,
  ShieldCheck,
  Eye,
  Layers,
  Zap,
  RefreshCw,
  AlertCircle,
  Film,
  Image as ImageIcon,
  Sliders,
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function DemoStudioTab() {
  const {
    isRecording,
    startDemoReel,
    setSelectedScenarioId,
    recordedVideoUrl,
    recordedDuration,
    openPreviewModal,
    screenCaptureSupported,
  } = useDemoReel();

  const { snapshot, loading: snapshotLoading, error: snapshotError, refresh: refreshSnapshot } = useMarketingSnapshot();
  const courses = useMemo(() => snapshot ? toMarketingCourseMap(snapshot) : {}, [snapshot]);
  const faculties = snapshot?.institution.faculties || [];
  const departments = snapshot?.institution.departments || [];
  const departmentToFaculty = snapshot?.institution.departmentToFaculty || {};
  const featureSwitches = snapshot?.featureSwitches.status === 'configured'
    ? snapshot.featureSwitches.values
    : null;
  const supportConfig = useMemo(() => snapshot?.support.status === 'configured'
    ? {
        whatsappSupport: snapshot.support.whatsappSupport || undefined,
        contactEmail: snapshot.support.contactEmail || undefined
      }
    : null, [snapshot]);

  const [studioMode, setStudioMode] = useState<'flyer' | 'video'>('flyer');

  // Dynamic Video Reel targeting state
  const [reelScope, setReelScope] = useState<MarketingTargetScope>('full_ecosystem');
  const [selectedFaculty, setSelectedFaculty] = useState<string>('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [customAiDirective, setCustomAiDirective] = useState<string>('');
  const [customAiScenarios, setCustomAiScenarios] = useState<Record<string, DemoScenario>>({});
  const [isSynthesizingReel, setIsSynthesizingReel] = useState(false);

  const [activeScenarioPreview, setActiveScenarioPreview] = useState<string>('full_ecosystem');
  const [isStarting, setIsStarting] = useState(false);

  const courseList = useMemo(() => Object.values(courses || {}), [courses]);

  useEffect(() => {
    if (!selectedFaculty && faculties.length > 0) setSelectedFaculty(faculties[0]);
    if (!selectedDepartment && departments.length > 0) setSelectedDepartment(departments[0]);
    if (!selectedCourseId && courseList.length > 0) setSelectedCourseId(courseList[0].id);
  }, [faculties, departments, courseList, selectedFaculty, selectedDepartment, selectedCourseId]);

  const reelMarketingContext: PlatformMarketingContext = useMemo(
    () => ({
      courses,
      faculties,
      departments,
      departmentToFaculty,
      featureSwitches,
      supportConfig,
      liveOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
      formulaCountsVerified: snapshot?.totals.formulasVerified === true,
      targetScope: reelScope,
      selectedFaculty,
      selectedDepartment,
      selectedCourseId,
    }),
    [
      courses,
      faculties,
      departments,
      departmentToFaculty,
      featureSwitches,
      supportConfig,
      snapshot,
      reelScope,
      selectedFaculty,
      selectedDepartment,
      selectedCourseId,
    ]
  );

  const dynamicScenarios = useMemo(() => {
    const base = buildDynamicDemoScenarios(reelMarketingContext);
    return {
      ...customAiScenarios,
      ...base,
    };
  }, [reelMarketingContext, customAiScenarios]);

  const activeScenario =
    dynamicScenarios[activeScenarioPreview] ||
    dynamicScenarios.full_ecosystem;

  if (!snapshotLoading && snapshot && !activeScenario) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-8 space-y-4">
        <h3 className="text-base font-black text-slate-900 dark:text-white">No demonstration sequence is currently verified</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          The marketing snapshot contains no live student-visible course offering or capability eligible for a recording. Do not record a generic scenario as proof of a live feature.
        </p>
        <button type="button" onClick={() => void refreshSnapshot()} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">
          Refresh marketing evidence
        </button>
      </div>
    );
  }

  const handleLaunchRecording = async (scenario: DemoScenario) => {
    if (scenario.requiresReview) {
      toast.error('Review and approve the AI-generated storyboard and captions before recording.');
      return;
    }
    setIsStarting(true);
    try {
      setSelectedScenarioId(scenario.id);
      const success = await startDemoReel(scenario);
      if (!success) {
        setIsStarting(false);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to start demo reel');
      setIsStarting(false);
    }
  };

  const handleSynthesizeAiReel = async () => {
    setIsSynthesizingReel(true);
    try {
      const generated = await synthesizeCustomDemoScenarioWithAI(
        reelMarketingContext,
        customAiDirective
      );
      setCustomAiScenarios((prev) => ({
        [generated.id]: generated,
        ...prev,
      }));
      setActiveScenarioPreview(generated.id);
      toast.success(`✨ Synthesized custom reel: ${generated.name}`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to synthesize custom AI demo scenario.');
    } finally {
      setIsSynthesizingReel(false);
    }
  };

  if (snapshotLoading || !snapshot) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-8 space-y-4">
        <div className="flex items-center gap-3">
          <RefreshCw size={20} className={snapshotError ? 'text-amber-600' : 'text-emerald-600 animate-spin'} />
          <h3 className="text-base font-black text-slate-900 dark:text-white">
            {snapshotError ? 'Demo evidence unavailable' : 'Verifying live demonstration data'}
          </h3>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {snapshotError || 'Loading student-visible course offerings, academic scope and feature-switch settings.'}
        </p>
        {snapshotError && (
          <button type="button" onClick={() => void refreshSnapshot()} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">
            Retry verification
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Unified Studio Header Card + Mode Switcher */}
      <div className="bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 text-white rounded-[2.5rem] p-8 sm:p-10 border border-emerald-500/20 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none">
          {studioMode === 'flyer' ? <ImageIcon size={200} /> : <Film size={200} />}
        </div>

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-emerald-300">
              <span>Live Platform Introspection</span>
              <span aria-hidden="true">·</span>
              <span>{courseList.length} live course offerings</span>
              <span aria-hidden="true">·</span>
              <span>{departments.length} Departments</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-amber-300">
                <ShieldCheck size={14} /> Visibility-filtered marketing data
              </span>
            </div>

            <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
              Marketing, Flyer & Demo Studio
            </h2>

            <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
              Create promotional assets from verified UniAce course and configuration data, and draft campaign copy or product-demo storyboards with AI for administrator review.
            </p>
          </div>

          {/* Studio Mode Segmented Switcher */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-slate-950/70 p-2 rounded-2xl border border-white/10 shrink-0">
            <button
              type="button"
              onClick={() => setStudioMode('flyer')}
              className={`px-5 py-3.5 rounded-xl font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-2.5 ${
                studioMode === 'flyer'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <ImageIcon size={18} />
              <span>Promotional Flyer & Poster Studio</span>
            </button>

            <button
              type="button"
              onClick={() => setStudioMode('video')}
              className={`px-5 py-3.5 rounded-xl font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-2.5 ${
                studioMode === 'video'
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <Video size={18} />
              <span>Dynamic Video Reel Studio</span>
            </button>
          </div>
        </div>
      </div>

      {/* MODE 1: DYNAMIC PROMOTIONAL FLYER & POSTER STUDIO */}
      {studioMode === 'flyer' && <DynamicFlyerStudio />}

      {/* MODE 2: DYNAMIC VIDEO REEL STUDIO */}
      {studioMode === 'video' && (
        <div className="space-y-8">
          {/* Screen Capture Support Warning if in unsupported browser */}
          {!screenCaptureSupported && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-3">
              <AlertCircle size={20} className="shrink-0 text-amber-400" />
              <span>
                Note: Screen recording uses the standard browser{' '}
                <code className="bg-amber-950/60 px-1 py-0.5 rounded font-mono">
                  getDisplayMedia
                </code>{' '}
                API. For the best experience, run in Google Chrome, Chromium, or Microsoft Edge.
              </span>
            </div>
          )}

          {/* Dynamic Reel Targeting & AI Scenario Synthesizer */}
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-700 space-y-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Sliders size={20} className="text-rose-500" />
                  Dynamic Reel Targeting & Live AI Script Synthesizer
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Target any live course, department, or faculty. The reel engine adapts its steps and captions to current course visibility, campaign scope and enabled application views.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleLaunchRecording(activeScenario)}
                  disabled={isRecording || isStarting}
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-black text-xs shadow-lg shadow-rose-600/20 transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
                >
                  <Play size={16} fill="currentColor" />
                  <span>
                    {isRecording
                      ? 'Recording in Progress...'
                      : `Launch "${activeScenario.name}"`}
                  </span>
                </button>

                {recordedVideoUrl && (
                  <button
                    type="button"
                    onClick={openPreviewModal}
                    className="px-4 py-3 rounded-xl bg-slate-900 dark:bg-slate-700 text-white font-bold text-xs transition-all flex items-center gap-2"
                  >
                    <Eye size={16} className="text-indigo-400" />
                    <span>Review Last Recording ({recordedDuration}s)</span>
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100 dark:border-slate-700/60">
              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1.5">
                  Target Campaign Scope
                </label>
                <select
                  value={reelScope}
                  onChange={(e) => {
                    const nextScope = e.target.value as MarketingTargetScope;
                    setReelScope(nextScope);
                    if (nextScope === 'course' || nextScope === 'department') {
                      setActiveScenarioPreview('full_ecosystem');
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white"
                >
                  <option value="full_ecosystem">Full University Ecosystem</option>
                  <option value="course">Specific live course offering</option>
                  <option value="department">Specific Department</option>
                  <option value="faculty">Specific Faculty</option>
                  <option value="exam_readiness">Semester Exam Readiness</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1.5">
                  Live Course / Department Context
                </label>
                {reelScope === 'department' ? (
                  <select
                    value={selectedDepartment}
                    onChange={(e) => setSelectedDepartment(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white"
                  >
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                ) : reelScope === 'faculty' ? (
                  <select
                    value={selectedFaculty}
                    onChange={(e) => setSelectedFaculty(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white"
                  >
                    {faculties.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={selectedCourseId}
                    onChange={(e) => setSelectedCourseId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white"
                  >
                    {courseList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id} — {c.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1.5">
                  Custom AI Reel Directive (Optional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customAiDirective}
                    onChange={(e) => setCustomAiDirective(e.target.value)}
                    placeholder="e.g., Focus on derivations & exam prep"
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white min-w-0"
                  />
                  <button
                    type="button"
                    onClick={handleSynthesizeAiReel}
                    disabled={isSynthesizingReel}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shrink-0 flex items-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    {isSynthesizingReel ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                    <span>AI Script</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Scenarios Deck */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Layers className="text-indigo-500" size={22} />
                  Evidence-backed Demo Reel Scenarios
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Scenarios are assembled from published student-visible course records, configured feature switches and the current deployment domain.
                </p>
              </div>
              <span className="text-xs font-bold text-slate-400">
                {Object.keys(dynamicScenarios).length} Scenarios Ready
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Object.values(dynamicScenarios).map((scenario: DemoScenario) => {
                const isSelected = activeScenario.id === scenario.id;

                return (
                  <div
                    key={scenario.id}
                    onClick={() => setActiveScenarioPreview(scenario.id)}
                    className={`p-6 sm:p-7 rounded-3xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-500 shadow-xl shadow-indigo-500/10'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="space-y-4">
                      {/* Top Bar with Duration and Aspect Ratio */}
                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono font-bold flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                          <Clock size={13} className="text-indigo-500" />
                          {scenario.totalDurationSec}s Reel
                        </span>
                        <span className="font-bold text-indigo-600 dark:text-indigo-400">
                          {scenario.aspectRatioHint}
                        </span>
                      </div>

                      {/* Title & Tagline */}
                      <div>
                        <h4 className="text-lg font-black text-slate-900 dark:text-white">
                          {scenario.name}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          {scenario.tagline}
                        </p>
                      </div>

                      {/* Recommended Channels (unboxed clean metadata) */}
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        {scenario.recommendedFor.map((platform, idx) => (
                          <React.Fragment key={platform}>
                            {idx > 0 && <span aria-hidden="true">·</span>}
                            <span>{platform}</span>
                          </React.Fragment>
                        ))}
                      </div>

                      {/* Step Timeline Breakdown */}
                      <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-700/60">
                        <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                          Live Sequence Breakdown ({scenario.steps.length} Steps):
                        </span>
                        <div className="space-y-1">
                          {scenario.steps.map((step, idx) => (
                            <div
                              key={step.id}
                              className="flex items-center justify-between text-xs py-1 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800"
                            >
                              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[230px]">
                                {idx + 1}. {step.title}
                              </span>
                              <span className="text-[10px] font-mono font-bold text-slate-400">
                                {Math.round(step.durationMs / 1000)}s
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {scenario.requiresReview && (
                      <details className="mt-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 p-3">
                        <summary className="cursor-pointer text-xs font-bold text-amber-900 dark:text-amber-200">
                          Review AI-generated captions and storyboard
                        </summary>
                        <div className="mt-3 space-y-3 text-xs text-slate-700 dark:text-slate-200">
                          {Object.entries(scenario.captions).map(([channel, caption]) => (
                            <div key={channel}>
                              <div className="font-bold uppercase text-[10px] text-slate-500 mb-1">{channel}</div>
                              <p className="whitespace-pre-wrap">{caption}</p>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCustomAiScenarios((prev) => ({
                                ...prev,
                                [scenario.id]: { ...scenario, requiresReview: false }
                              }));
                              toast.success('Storyboard marked as reviewed. Check the live product before publishing the recording.');
                            }}
                            className="px-3 py-2 rounded-lg bg-amber-700 text-white font-bold"
                          >
                            Approve storyboard for recording
                          </button>
                        </div>
                      </details>
                    )}

                    {/* Launch Action */}
                    <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-3">
                      <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                        {isSelected ? '✓ Selected Scenario' : 'Click to select'}
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLaunchRecording(scenario);
                        }}
                        disabled={isRecording || scenario.requiresReview}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition-all active:scale-95 flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Play size={13} fill="currentColor" />
                        <span>{scenario.requiresReview ? 'Review first' : 'Record Reel'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Marketing Evidence & Recording Details Deck */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 space-y-3">
              <div className="p-3 w-fit rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck size={24} />
              </div>
              <h4 className="font-bold text-slate-900 dark:text-white text-base">
                Live-source Marketing Inputs
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Flyer and reel inputs are sourced from published course records, student-visibility settings and configured feature switches. Targeted courses retain their audience scope.
              </p>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 space-y-3">
              <div className="p-3 w-fit rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                <Zap size={24} />
              </div>
              <h4 className="font-bold text-slate-900 dark:text-white text-base">
                AI Script Drafting
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                AI-generated campaign copy and storyboards remain drafts until an administrator reviews their factual claims and captions.
              </p>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 space-y-3">
              <div className="p-3 w-fit rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400">
                <Share2 size={24} />
              </div>
              <h4 className="font-bold text-slate-900 dark:text-white text-base">
                Campaign Asset Export
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Export the flyer as PNG or A4 PDF, generate its QR code, and record browser-based WebM demonstrations. Actual video capture quality depends on the browser and device.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
