import React, { useState } from 'react';
import { AlertCircle, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { requestAdminDemoTutor, AdminDemoTutorResult } from '../../services/adminDemoTutorService';

export default function AdminDemoTutorPreview() {
  const [message, setMessage] = useState('');
  const [courseContext, setCourseContext] = useState('');
  const [result, setResult] = useState<AdminDemoTutorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const handleRun = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!message.trim() || isRunning) return;
    setIsRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await requestAdminDemoTutor(message.trim(), courseContext.trim() || undefined));
    } catch (err: any) {
      setError(err?.message || 'The isolated AI Tutor preview could not be completed.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section className="rounded-3xl border border-emerald-300/70 dark:border-emerald-800 bg-white dark:bg-slate-800 p-6 sm:p-8 space-y-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"><ShieldCheck size={23} /></div>
        <div className="min-w-0">
          <h3 className="text-lg font-black text-slate-900 dark:text-white">Isolated AI Tutor Preview</h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Run a real provider-backed tutor response under the authenticated administrator identity, outside the student chat pipeline.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-3 text-emerald-900 dark:text-emerald-200">Student Sparks: never charged</div>
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-3 text-emerald-900 dark:text-emerald-200">Student profile/history: not read or written</div>
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-3 text-emerald-900 dark:text-emerald-200">Student chat analytics: not written</div>
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-3 text-emerald-900 dark:text-emerald-200">Usage record: separate admin audit entry</div>
      </div>

      <form onSubmit={handleRun} className="space-y-3">
        <div>
          <label htmlFor="admin-demo-course-context" className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">Optional course context</label>
          <input id="admin-demo-course-context" value={courseContext} onChange={e => setCourseContext(e.target.value)} maxLength={1200} placeholder="e.g. GET 205 — Fundamentals of Fluid Mechanics" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-3 text-sm text-slate-900 dark:text-white" />
        </div>
        <div>
          <label htmlFor="admin-demo-tutor-prompt" className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">Tutor prompt</label>
          <textarea id="admin-demo-tutor-prompt" value={message} onChange={e => setMessage(e.target.value)} required minLength={1} maxLength={6000} rows={4} placeholder="Enter an academic question to test the actual UniAce AI Tutor response..." className="w-full resize-y rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-3 text-sm text-slate-900 dark:text-white" />
        </div>
        <button type="submit" disabled={isRunning || !message.trim()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-5 py-3 text-xs font-black">
          {isRunning ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {isRunning ? 'Contacting configured provider...' : 'Run isolated AI preview'}
        </button>
      </form>

      <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">Provider API usage is still incurred by UniAce's configured provider account. Only aggregate provider, token and latency metadata are recorded; the preview prompt and answer are not saved. This manual preview is not yet part of automated video recordings.</p>

      {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-300 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-800 dark:text-rose-200"><AlertCircle size={16} className="shrink-0" />{error}</div>}

      {result && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-[11px] text-slate-600 dark:text-slate-300">
            <span className="font-bold">Live provider response · {result.meta.providerUsed || 'Provider not reported'}</span>
            <span>{Math.round(result.meta.latencyMs)} ms</span>
          </div>
          <div className="p-4 sm:p-5 whitespace-pre-wrap text-sm leading-7 text-slate-800 dark:text-slate-100">{result.response}</div>
          <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-3 text-[11px] text-slate-500 dark:text-slate-400">
            {result.meta.totalTokens !== null ? `Provider-reported tokens: ${result.meta.totalTokens}` : 'Provider token usage was not reported.'} · Admin demo telemetry saved · No student Sparks charged
          </div>
        </div>
      )}
    </section>
  );
}
