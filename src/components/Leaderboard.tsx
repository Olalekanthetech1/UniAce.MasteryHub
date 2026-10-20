import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Trophy, Medal, Crown, User, Zap, Star, ArrowUp, ArrowDown, Minus, Flame } from 'lucide-react';

interface LeaderboardEntry {
  uid: string;
  displayName: string;
  photoURL: string;
  xp: number;
  level: number;
  streak: number;
  rank?: number;
}

export default function Leaderboard() {
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchLeaders = async () => {
      try {
        const res = await fetch('/api/gamification/leaderboard');
        if (res.ok && isMounted) {
          const json = await res.json();
          if (json.leaderboard) {
            const data = json.leaderboard.map((item: any) => ({
              uid: item.id,
              displayName: item.name || 'Scholar',
              photoURL: item.avatar || '',
              xp: item.xp || 0,
              level: item.level || 1,
              streak: item.streak || 0,
              rank: item.rank
            }));
            setLeaders(data);
          }
        }
      } catch (error) {
        console.warn('Leaderboard fetch error:', error);
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
            <h2 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-white tracking-tight">Global Hall of Fame</h2>
            <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Top 10 Gladiators</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 px-3.5 py-1.5 rounded-xl">
          <Star size={16} className="text-amber-400" fill="currentColor" />
          <span className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-white">Season 1</span>
        </div>
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="space-y-4 py-8">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl animate-pulse" />
            ))}
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
                    {index === 0 ? <Crown className="text-yellow-500" size={20} /> :
                     index === 1 ? <Medal className="text-zinc-400" size={20} /> :
                     index === 2 ? <Medal className="text-amber-600" size={20} /> :
                     <span className="text-sm font-bold text-zinc-400">#{index + 1}</span>}
                  </div>
                  
                  <div className="relative">
                    <div className="w-10 h-10 rounded-xl overflow-hidden border-2 border-white dark:border-zinc-800 shadow-sm">
                      <img 
                        src={leader.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${leader.uid}`} 
                        alt={leader.displayName} 
                        className="w-full h-full object-cover"
                      />
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
                       {leader.streak > 0 && (
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

                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-end">
                    <div className="flex items-center gap-1 text-emerald-500">
                      <ArrowUp size={12} />
                      <span className="text-[10px] font-bold">2</span>
                    </div>
                    <span className="text-[8px] font-bold text-zinc-400 uppercase">Trend</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <div className="p-6 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800 text-center">
        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">
          Leaderboard updates every 5 minutes
        </p>
      </div>
    </div>
  );
}
