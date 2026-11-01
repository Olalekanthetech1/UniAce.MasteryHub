import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Trophy, Medal, Crown, User, Zap, Flame } from 'lucide-react';
import { safeFetchJson } from '../utils/safeFetch';

interface LeaderboardEntry {
  uid: string;
  displayName: string;
  photoURL?: string | null;
  xp: number;
  level: number;
  streak?: number | null;
  rank: number;
}

export default function Leaderboard() {
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchLeaders = async () => {
      try {
        const res = await safeFetchJson<any>('/api/gamification/leaderboard', { cache: 'no-store' });
        if (!res.ok || !res.data || !Array.isArray(res.data.leaderboard)) {
          throw new Error(res.error || 'The live leaderboard response is unavailable or malformed.');
        }
        const data: LeaderboardEntry[] = res.data.leaderboard.map((item: any, index: number) => {
          if (typeof item.id !== 'string' || !item.id.trim() ||
              typeof item.name !== 'string' || !item.name.trim() ||
              !Number.isInteger(item.xp) || item.xp < 0 ||
              !Number.isInteger(item.level) || item.level < 1 ||
              !Number.isInteger(item.rank) || item.rank < 1 ||
              (item.streak !== null && item.streak !== undefined &&
                (!Number.isInteger(item.streak) || item.streak < 0))) {
            throw new Error(`Leaderboard record at position ${index + 1} is missing verified fields.`);
          }
          return {
            uid: item.id,
            displayName: item.name,
            photoURL: typeof item.avatar === 'string' && item.avatar.trim() ? item.avatar : null,
            xp: item.xp,
            level: item.level,
            streak: item.streak ?? null,
            rank: item.rank
          };
        });
        if (isMounted) {
          setLeaders(data);
          setLoadError(null);
        }
      } catch (error) {
        console.warn('Leaderboard fetch error:', error);
        if (isMounted) {
          setLeaders([]);
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchLeaders();
    return () => { isMounted = false; };
  }, []);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-[2.5rem] border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
      <div className="p-8 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-gradient-to-r from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
        <div className="flex items-center gap-4">
          <div className="bg-yellow-100 dark:bg-yellow-900/30 p-3 rounded-2xl text-yellow-600 dark:text-yellow-400">
            <Trophy size={24} />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-white tracking-tight">Recorded Student Leaderboard</h2>
            <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Ranked by stored XP</p>
          </div>
        </div>
        <span className="text-xs text-zinc-500">Live user profile records</span>
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="space-y-4 py-8">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : loadError ? (
          <div className="py-8 text-center text-sm text-amber-700 dark:text-amber-300">
            Leaderboard unavailable: {loadError}
          </div>
        ) : leaders.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-500">
            No verified student leaderboard records are currently available.
          </div>
        ) : (
          <div className="space-y-3">
            {leaders.map((leader, index) => (
              <motion.div
                key={leader.uid}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
                  index === 0 
                    ? 'bg-yellow-50/50 border-yellow-200 dark:bg-yellow-900/10 dark:border-yellow-900/30' 
                    : 'bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-8 flex justify-center">
                    {leader.rank === 1 ? <Crown className="text-yellow-500" size={20} /> :
                     leader.rank === 2 ? <Medal className="text-zinc-400" size={20} /> :
                     leader.rank === 3 ? <Medal className="text-amber-600" size={20} /> :
                     <span className="text-sm font-bold text-zinc-400">#{leader.rank}</span>}
                  </div>
                  
                  <div className="relative">
                    <div className="w-10 h-10 rounded-xl overflow-hidden border-2 border-white dark:border-zinc-800 shadow-sm flex items-center justify-center bg-zinc-100 dark:bg-zinc-800">
                      {leader.photoURL ? (
                        <img
                          src={leader.photoURL}
                          alt={leader.displayName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User size={18} className="text-zinc-500" />
                      )}
                    </div>
                    <div className="absolute -bottom-1 -right-1 bg-zinc-900 text-white text-[8px] font-bold px-1 rounded-sm">
                      Lvl {leader.level}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-bold text-zinc-900 dark:text-white text-sm">{leader.displayName}</h4>
                    <div className="flex items-center gap-2">
                       <Zap size={10} className="text-amber-500" fill="currentColor" />
                       <span className="text-[10px] font-bold text-zinc-500 uppercase">{leader.xp.toLocaleString()} XP</span>
                       {typeof leader.streak === 'number' && leader.streak > 0 && (
                         <>
                           <span className="text-zinc-300 dark:text-zinc-700">•</span>
                           <span className="text-[10px] font-bold text-orange-500 uppercase flex items-center gap-0.5">
                             <Flame size={10} />
                             {leader.streak} Day Streak
                           </span>
                         </>
                       )}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-zinc-400">#{leader.rank}</div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <div className="p-6 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800 text-center">
        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">
          Rankings reflect the latest successfully retrieved profile metrics
        </p>
      </div>
    </div>
  );
}
