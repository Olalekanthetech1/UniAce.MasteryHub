import React from 'react';
import { Construction, ArrowLeft, Sparkles } from 'lucide-react';

interface ComingSoonProps {
  title: string;
  description: string;
  onBack?: () => void;
}

export default function ComingSoon({ title, description, onBack }: ComingSoonProps) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 shadow-xl relative overflow-hidden">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto mb-6">
          <Construction className="w-8 h-8" />
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 uppercase tracking-wider mb-4">
          <Sparkles className="w-3.5 h-3.5" /> Scheduled Feature
        </span>
        <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-2">{title}</h2>
        <p className="text-sm text-slate-500 dark:text-zinc-400 mb-6 leading-relaxed">{description}</p>
        {onBack && (
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 transition-opacity"
          >
            <ArrowLeft className="w-4 h-4" /> Return to Dashboard
          </button>
        )}
      </div>
    </div>
  );
}
