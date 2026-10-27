import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Swords, Trophy, Timer, Shield, Zap, Skull, Crown, User, Search, X, Heart, CheckCircle, AlertCircle, Loader2, Star, Target, ArrowRight, Flame } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { Battle, BattlePlayer, QuizQuestion, CourseId } from '../types';
import { AIService } from '../services/ai';
import Leaderboard from './Leaderboard';
import { ChallengesService, ArenaChallenge, DEFAULT_CHALLENGES } from '../services/challengesConfig';

interface ArenaProps {
  activeCourseId: CourseId | null;
}

const MAX_HEALTH = 100;
const DAMAGE_PER_HIT = 20;

export default function Arena({ activeCourseId }: ArenaProps) {
  const { user, profile } = useAuth();
  const { courses } = useCourses();

  const [challenges, setChallenges] = useState<ArenaChallenge[]>(DEFAULT_CHALLENGES);
  const [view, setView] = useState<'lobby' | 'matching' | 'battle' | 'result'>('lobby');
  const [battleId, setBattleId] = useState<string | null>(null);
  const [battleData, setBattleData] = useState<Battle | null>(null);
  const [timeLeft, setTimeLeft] = useState(60); // 60 seconds per battle
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [matchStatus, setMatchStatus] = useState('Searching for opponent...');

  // Audio refs
  const hitSound = useRef<HTMLAudioElement | null>(null);
  const winSound = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const unsubscribe = ChallengesService.subscribeChallenges((data) => {
      if (data && data.length > 0) {
        setChallenges(data.filter(c => c.active !== false));
      }
    });
    return () => unsubscribe();
  }, []);

  const getChallengeIcon = (iconName?: string) => {
    const lower = (iconName || '').toLowerCase();
    switch (lower) {
      case 'trophy': return Trophy;
      case 'flame': return Flame;
      case 'zap': return Zap;
      case 'target': return Target;
      case 'star': return Star;
      case 'swords':
      default: return Swords;
    }
  };

  // 1. Matchmaking Logic (Neon PostgreSQL)
  const findMatch = async () => {
    if (!user || !activeCourseId) return;
    setView('matching');
    setMatchStatus('Scanning the arena...');

    try {
      setMatchStatus('Preparing battle arena...');
      const questions = await generateBattleQuestions(activeCourseId);

      const player: BattlePlayer = {
        uid: user.uid,
        name: user.displayName || 'Gladiator',
        avatar: profile?.photoURL || user.photoURL || '',
        score: 0,
        currentQuestionIndex: 0,
        health: MAX_HEALTH,
        status: 'ready'
      };

      const token = await user.getIdToken();
      const res = await fetch('/api/arena/matchmake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          topicId: activeCourseId,
          player,
          questions
        })
      });
      if (!res.ok) throw new Error('Matchmaking failed');
      const data = await res.json();
      setBattleId(data.battleId);
      if (data.battle) setBattleData(data.battle);
      setMatchStatus(data.joined ? 'Opponent found! Entering arena...' : 'Waiting for a challenger...');
    } catch (error) {
      console.error("Matchmaking error:", error);
      setMatchStatus('Error finding match. Try again.');
      setTimeout(() => setView('lobby'), 2000);
    }
  };

  // 2. Real-time Battle Listener (Polls Neon PostgreSQL)
  useEffect(() => {
    if (!battleId || !user) return;

    let active = true;
    const pollBattle = async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/arena/battles/${encodeURIComponent(battleId)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!active) return;
        if (res.status === 404) {
          setView('lobby');
          setBattleId(null);
          return;
        }
        if (res.ok) {
          const json = await res.json();
          const data = json.battle as Battle;
          if (data) {
            setBattleData(data);
            if (data.status === 'active' && view === 'matching') {
              setView('battle');
            }
            if (data.status === 'finished') {
              setView('result');
            }
          }
        }
      } catch (error) {
        console.error("Arena: Error polling battle:", error);
      }
    };

    void pollBattle();
    const timer = setInterval(pollBattle, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [battleId, view, user]);

  // 3. Timer Logic
  useEffect(() => {
    if (view !== 'battle') return;
    
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleBattleEnd();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [view]);

  const patchBattle = async (updates: Record<string, any>) => {
    if (!battleId || !user) return;
    const token = await user.getIdToken();
    const res = await fetch(`/api/arena/battles/${encodeURIComponent(battleId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(updates)
    });
    if (res.ok) {
      const json = await res.json();
      if (json.battle) setBattleData(json.battle);
    }
  };

  // 4. Gameplay Logic
  const handleAnswer = async (option: string) => {
    if (!battleData || !user || selectedAnswer) return;
    
    const isPlayer1 = battleData.player1.uid === user.uid;
    const player = isPlayer1 ? battleData.player1 : battleData.player2;
    if (!player) return;

    const currentQuestion = battleData.questions[player.currentQuestionIndex];
    const correct = option === currentQuestion.correctAnswer;
    
    setSelectedAnswer(option);
    setIsCorrect(correct);

    if (correct) {
      const updateKey = isPlayer1 ? 'player2.health' : 'player1.health';
      const opponentHealth = isPlayer1 ? battleData.player2!.health : battleData.player1.health;
      const newHealth = Math.max(0, opponentHealth - DAMAGE_PER_HIT);
      
      const updates: Record<string, any> = {
        [isPlayer1 ? 'player1.score' : 'player2.score']: player.score + 100,
        [isPlayer1 ? 'player1.currentQuestionIndex' : 'player2.currentQuestionIndex']: player.currentQuestionIndex + 1,
        [updateKey]: newHealth
      };

      if (newHealth === 0) {
        updates.status = 'finished';
        updates.winner = user.uid;
      }
      await patchBattle(updates);
    } else {
      await patchBattle({
        [isPlayer1 ? 'player1.currentQuestionIndex' : 'player2.currentQuestionIndex']: player.currentQuestionIndex + 1
      });
    }

    setTimeout(() => {
      setSelectedAnswer(null);
      setIsCorrect(null);
    }, 1000);
  };

  const handleBattleEnd = async () => {
    if (!battleData || !user) return;
    
    const p1Score = battleData.player1.score;
    const p2Score = battleData.player2?.score || 0;
    
    let winnerId = 'draw';
    if (p1Score > p2Score) winnerId = battleData.player1.uid;
    if (p2Score > p1Score) winnerId = battleData.player2!.uid;

    await patchBattle({
      status: 'finished',
      winner: winnerId
    });
  };

  const cancelMatchmaking = async () => {
    if (battleId && user) {
      const token = await user.getIdToken();
      await fetch(`/api/arena/battles/${encodeURIComponent(battleId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {});
    }
    setBattleId(null);
    setView('lobby');
  };

  // Helper to generate questions
  const generateBattleQuestions = async (courseId: string): Promise<QuizQuestion[]> => {
    try {
      const course = courses[courseId as CourseId];
      if (course && course.syllabus.length > 0) {
        // Pick a random module
        const randomModule = course.syllabus[Math.floor(Math.random() * course.syllabus.length)];
        
        // Generate questions using AI
        const questions = await AIService.generateQuiz(
          randomModule,
          undefined, // No specific subtopic, cover the module
          5, // 5 questions per battle
          'multiple-choice',
          false,
          3,
          profile?.academic_level,
          profile?.department,
          profile?.displayName
        );
        
        if (questions && questions.length > 0) {
          return questions;
        }
      }
    } catch (error) {
      console.error("AI Question Generation failed:", error);
      throw new Error("Failed to generate battle questions. Please try again.");
    }
    throw new Error("Could not find suitable curriculum to generate questions.");
  };

  // --- RENDERERS ---

  if (view === 'lobby') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col p-4 sm:p-6 lg:p-12 pb-24 lg:pb-12 no-scrollbar overflow-y-auto">
        <div className="max-w-6xl mx-auto w-full space-y-12">
          {/* Header */}
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-8">
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-purple-500 font-black uppercase tracking-[0.2em] text-[10px] sm:text-xs">
                <Swords size={16} />
                <span>PvP Combat Zone</span>
              </div>
              <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight italic uppercase">The Arena</h1>
              <p className="text-slate-500 font-medium">Battle other students in real-time to earn XP and Rank.</p>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-3xl flex items-center gap-4 shadow-xl">
                <div className="w-12 h-12 rounded-2xl bg-purple-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/20">
                  <Trophy size={24} />
                </div>
                <div>
                  <div className="text-2xl font-black text-white">#{profile?.rank || '---'}</div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Global Rank</div>
                </div>
              </div>
              <button
                onClick={findMatch}
                disabled={!activeCourseId}
                className="px-10 py-5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-[2rem] font-black text-lg sm:text-xl shadow-2xl shadow-purple-600/30 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-3"
              >
                <Zap size={24} fill="currentColor" />
                ENTER BATTLE
              </button>
            </div>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Stats & Challenges */}
            <div className="space-y-8">
              {/* Stats Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 shadow-2xl">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-6">Combat Stats</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                    <div className="text-xl sm:text-2xl font-bold text-white">0</div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">Wins</div>
                  </div>
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                    <div className="text-xl sm:text-2xl font-bold text-white">0</div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">Losses</div>
                  </div>
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                    <div className="text-xl sm:text-2xl font-bold text-purple-400">0%</div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">Win Rate</div>
                  </div>
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                    <div className="text-xl sm:text-2xl font-bold text-amber-400">0</div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">Streak</div>
                  </div>
                </div>
              </div>

              {/* Daily Challenges */}
              <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Daily Missions</h3>
                  <Target size={16} className="text-slate-500" />
                </div>
                <div className="space-y-4">
                  {challenges.map((challenge) => {
                    const IconComponent = getChallengeIcon(challenge.iconType);
                    return (
                      <div key={challenge.id} className="flex items-center justify-between p-4 bg-slate-950 rounded-2xl border border-slate-800 group hover:border-purple-500/50 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-slate-400 group-hover:text-purple-400 transition-colors">
                            <IconComponent size={20} />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-white">{challenge.title}</h4>
                            <p className="text-[10px] text-slate-500">{challenge.description}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-black text-emerald-400">+{challenge.reward} XP</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Middle Column: Leaderboard */}
            <div className="lg:col-span-2">
              <Leaderboard />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'matching') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 sm:p-6 pb-24 lg:pb-6 text-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="mb-8"
        >
          <Search size={64} className="text-purple-500" />
        </motion.div>
        <h2 className="text-3xl font-bold text-white mb-4">{matchStatus}</h2>
        <p className="text-slate-400 mb-8 max-w-xs mx-auto">
          Searching for a worthy opponent in {activeCourseId}...
        </p>
        <button 
          onClick={cancelMatchmaking}
          className="px-6 py-2 rounded-full border border-slate-600 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors font-bold text-sm"
        >
          Cancel Search
        </button>
      </div>
    );
  }

  if (view === 'battle' && battleData) {
    const isPlayer1 = battleData.player1.uid === user?.uid;
    const me = isPlayer1 ? battleData.player1 : battleData.player2!;
    const opponent = isPlayer1 ? battleData.player2! : battleData.player1;
    const currentQ = battleData.questions[me.currentQuestionIndex];

    return (
      <div className="min-h-screen bg-slate-900 flex flex-col relative overflow-hidden pb-24 lg:pb-0">
        {/* Top Bar: Health & Avatars */}
        <div className="flex justify-between items-center p-4 sm:p-6 relative z-10">
          {/* Me */}
          <div className="flex items-center gap-4 w-1/3">
            <div className="relative">
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-blue-600 border-4 border-slate-800 shadow-xl overflow-hidden">
                 <img src={me.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${me.uid}`} alt="Me" className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-2 -right-2 bg-slate-800 text-white text-xs font-bold px-2 py-0.5 rounded-full border border-slate-700">
                You
              </div>
            </div>
            <div className="flex-1 hidden sm:block">
              <div className="h-4 bg-slate-800 rounded-full overflow-hidden border border-slate-700 relative">
                <motion.div 
                  initial={{ width: '100%' }}
                  animate={{ width: `${me.health}%` }}
                  className="h-full bg-emerald-500"
                />
              </div>
              <div className="text-xs text-slate-400 mt-1 font-bold">{me.health}/100 HP</div>
            </div>
          </div>

          {/* Timer */}
          <div className="flex flex-col items-center">
            <div className="text-3xl sm:text-4xl font-bold text-white tracking-widest tabular-nums">
              {timeLeft}
            </div>
            <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">Seconds</div>
          </div>

          {/* Opponent */}
          <div className="flex items-center justify-end gap-4 w-1/3">
            <div className="flex-1 hidden sm:block text-right">
              <div className="h-4 bg-slate-800 rounded-full overflow-hidden border border-slate-700 relative">
                <motion.div 
                  initial={{ width: '100%' }}
                  animate={{ width: `${opponent.health}%` }}
                  className="h-full bg-red-500 absolute right-0 top-0 bottom-0"
                />
              </div>
              <div className="text-xs text-slate-400 mt-1 font-bold">{opponent.health}/100 HP</div>
            </div>
            <div className="relative">
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-red-600 border-4 border-slate-800 shadow-xl overflow-hidden">
                 <img src={opponent.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${opponent.uid}`} alt="Opponent" className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-2 -left-2 bg-slate-800 text-white text-xs font-bold px-2 py-0.5 rounded-full border border-slate-700">
                Enemy
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Health Bars (visible only on small screens) */}
        <div className="flex sm:hidden px-4 gap-2 mb-4">
           <div className="h-2 flex-1 bg-slate-800 rounded-full overflow-hidden">
             <motion.div animate={{ width: `${me.health}%` }} className="h-full bg-emerald-500" />
           </div>
           <div className="h-2 flex-1 bg-slate-800 rounded-full overflow-hidden flex justify-end">
             <motion.div animate={{ width: `${opponent.health}%` }} className="h-full bg-red-500" />
           </div>
        </div>

        {/* Question Area */}
        <div className="flex-1 flex items-center justify-center p-6 relative z-10">
          {currentQ ? (
            <div className="max-w-2xl w-full space-y-8">
              <motion.div
                key={currentQ.id}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-center space-y-6"
              >
                <h2 className="text-xl sm:text-3xl font-bold text-white leading-tight">
                  {currentQ.question}
                </h2>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {currentQ.options?.map((option, idx) => {
                    const isSelected = selectedAnswer === option;
                    const showResult = selectedAnswer !== null;
                    const isCorrectOption = option === currentQ.correctAnswer;
                    
                    let btnClass = "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700";
                    if (showResult) {
                      if (isCorrectOption) btnClass = "bg-emerald-600 border-emerald-500 text-white";
                      else if (isSelected) btnClass = "bg-red-600 border-red-500 text-white";
                      else btnClass = "bg-slate-800 border-slate-700 text-slate-500 opacity-50";
                    }

                    return (
                      <button
                        key={idx}
                        onClick={() => handleAnswer(option)}
                        disabled={showResult}
                        className={`p-6 rounded-2xl border-2 font-bold text-lg transition-all transform active:scale-95 ${btnClass}`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </div>
          ) : (
            <div className="text-center text-white">
              <h2 className="text-3xl font-bold mb-2">All Questions Answered!</h2>
              <p className="text-slate-400">Waiting for opponent to finish...</p>
              <Loader2 size={48} className="animate-spin mx-auto mt-8 text-purple-500" />
            </div>
          )}
        </div>

        {/* VS Background Effect */}
        <div className="absolute inset-0 pointer-events-none flex">
          <div className="w-1/2 h-full bg-blue-600/5 skew-x-12 -ml-20"></div>
          <div className="w-1/2 h-full bg-red-600/5 skew-x-12 ml-20"></div>
        </div>
      </div>
    );
  }

  if (view === 'result' && battleData) {
    const isWinner = battleData.winner === user?.uid;
    const isDraw = battleData.winner === 'draw';

    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 sm:p-6 pb-24 lg:pb-6 relative overflow-hidden">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md w-full bg-slate-800 border border-slate-700 p-8 rounded-3xl text-center shadow-2xl relative z-10"
        >
          <div className="mb-6 flex justify-center">
            {isWinner ? (
              <div className="w-24 h-24 bg-yellow-400 rounded-full flex items-center justify-center shadow-lg shadow-yellow-400/50 animate-bounce">
                <Trophy size={48} className="text-yellow-900" />
              </div>
            ) : isDraw ? (
              <div className="w-24 h-24 bg-slate-600 rounded-full flex items-center justify-center shadow-lg">
                <Shield size={48} className="text-white" />
              </div>
            ) : (
              <div className="w-24 h-24 bg-red-500 rounded-full flex items-center justify-center shadow-lg shadow-red-500/50">
                <Skull size={48} className="text-white" />
              </div>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-2">
            {isWinner ? 'VICTORY!' : isDraw ? 'DRAW!' : 'DEFEAT'}
          </h1>
          <p className="text-slate-400 mb-8 font-medium">
            {isWinner ? '+100 XP Earned' : isDraw ? '+20 XP Earned' : 'Better luck next time!'}
          </p>

          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-slate-900 p-4 rounded-2xl border border-slate-700">
              <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Your Score</div>
              <div className="text-xl sm:text-2xl font-bold text-white">
                {battleData.player1.uid === user?.uid ? battleData.player1.score : battleData.player2?.score}
              </div>
            </div>
            <div className="bg-slate-900 p-4 rounded-2xl border border-slate-700">
              <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Enemy Score</div>
              <div className="text-xl sm:text-2xl font-bold text-white">
                {battleData.player1.uid !== user?.uid ? battleData.player1.score : battleData.player2?.score}
              </div>
            </div>
          </div>

          <button
            onClick={() => setView('lobby')}
            className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition-colors"
          >
            Return to Lobby
          </button>
        </motion.div>
        
        {isWinner && (
          <div className="absolute inset-0 pointer-events-none">
             {/* Confetti effect could go here */}
          </div>
        )}
      </div>
    );
  }

  return null;
}
