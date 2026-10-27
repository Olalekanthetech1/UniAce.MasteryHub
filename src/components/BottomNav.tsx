import React from 'react';
import { Home, Grid, Trophy, User, MessageSquare, BookOpen } from 'lucide-react';
import { View } from '../types';

interface BottomNavProps {
  activeView: View | 'pricing';
  onViewSelect: (view: View | 'pricing') => void;
}

export default function BottomNav({ activeView, onViewSelect }: BottomNavProps) {
  if (activeView === 'ai-tutor') return null;
  if (typeof document !== 'undefined' && document.body.dataset.skillSessionActive === 'true') return null;

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 pb-safe z-50">
      <div className="flex justify-around items-center p-2">
        <button
          onClick={() => onViewSelect('hub')}
          className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${
            activeView === 'hub' 
              ? 'text-emerald-600 dark:text-emerald-400' 
              : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <Grid size={24} />
          <span className="text-[9px] font-bold tracking-tight">Hub</span>
        </button>

        <button
          onClick={() => onViewSelect('dashboard')}
          className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${
            activeView === 'dashboard' 
              ? 'text-emerald-600 dark:text-emerald-400' 
              : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <Home size={24} />
          <span className="text-[9px] font-bold tracking-tight">Home</span>
        </button>

        <button
          onClick={() => onViewSelect('ai-tutor')}
          className="flex flex-col items-center gap-1 p-2 -mt-8 bg-emerald-500 text-white rounded-full shadow-lg shadow-emerald-500/30 border-4 border-slate-50 dark:border-slate-900 transition-transform active:scale-95"
        >
          <MessageSquare size={24} />
        </button>

        <button
          onClick={() => onViewSelect('arena')}
          className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${
            activeView === 'arena' 
              ? 'text-amber-500' 
              : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <Trophy size={24} />
          <span className="text-[9px] font-bold tracking-tight">Arena</span>
        </button>

        <button
          onClick={() => onViewSelect('profile')}
          className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${
            activeView === 'profile' 
              ? 'text-emerald-600 dark:text-emerald-400' 
              : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <User size={24} />
          <span className="text-[9px] font-bold tracking-tight">Profile</span>
        </button>
      </div>
    </div>
  );
}
