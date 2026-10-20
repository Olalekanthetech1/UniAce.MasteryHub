import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Brain, ArrowRight, ArrowLeft, RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Module, SubTopic, Flashcard, SRSData } from '../types';
import { AIService } from '../services/ai';
import MarkdownRenderer from './MarkdownRenderer';
import { useUserProgress } from '../hooks/useUserProgress';
import { useAuth } from '../context/AuthContext';

interface FlashcardsProps {
  module?: Module;
  subTopic?: SubTopic;
  isGlobalReview?: boolean;
  onClose: () => void;
}

export default function Flashcards({ module, subTopic, isGlobalReview, onClose }: FlashcardsProps) {
  const { profile, user } = useAuth();
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [loadingText, setLoadingText] = useState("Loading your flashcards...");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const fetchCards = async () => {
      if (!user?.uid) return;
      setIsLoading(true);
      setErrorMsg(null);
      
      try {
        let fetchedCards: Flashcard[] = [];
        
        if (module) {
          setLoadingText("Generating flashcards...");
          const generatedCards = await AIService.generateFlashcards(
            module, 
            subTopic, 
            10,
            profile?.academic_level,
            profile?.department
          );
          
          if (!generatedCards || !Array.isArray(generatedCards) || generatedCards.length === 0) {
            setSessionComplete(true);
            return;
          }

          const cardsToSave = generatedCards.map(c => {
            let cardId = c.id && c.id.length > 3 && !c.id.includes('/') ? c.id : undefined;
            if (!cardId) {
              cardId = typeof crypto !== 'undefined' && crypto.randomUUID 
                ? crypto.randomUUID() 
                : Math.random().toString(36).substring(2) + Date.now().toString(36);
            }
            return {
              ...c,
              id: cardId,
              userId: user.uid,
              interval: 0,
              repetition: 0,
              efactor: 2.5,
              nextReviewDate: new Date().toISOString()
            };
          });
          
          setCards(cardsToSave);
        } else {
          setSessionComplete(true);
        }
      } catch (error: any) {
        console.error("Failed to load flashcards:", error);
        setErrorMsg(error?.message || "Failed to load flashcards. Please try again.");
      } finally {
        setIsLoading(false);
      }
    };
    fetchCards();
  }, [module, subTopic, isGlobalReview, user?.uid]);

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
  };

  const handleRating = async (rating: 1 | 2 | 3 | 4) => {
    const currentCard = cards[currentIndex];
    
    // SuperMemo-2 Algorithm implementation
    let nextInterval = 1;
    let nextRepetition = currentCard.repetition || 0;
    let nextEfactor = currentCard.efactor || 2.5;

    if (rating >= 3) {
      if (nextRepetition === 0) {
        nextInterval = 1;
      } else if (nextRepetition === 1) {
        nextInterval = 6;
      } else {
        nextInterval = Math.round((currentCard.interval || 0) * nextEfactor);
      }
      nextRepetition += 1;
    } else {
      nextRepetition = 0;
      nextInterval = 1;
    }

    nextEfactor = nextEfactor + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02));
    if (nextEfactor < 1.3) nextEfactor = 1.3;

    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + nextInterval);
    
    // Save to Neon API
    if (user?.uid) {
      try {
        const token = await user.getIdToken();
        fetch('/api/user/srs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            cardId: currentCard.id,
            courseId: (currentCard as any).courseId || module?.id || 'general',
            rating
          })
        }).catch(err => console.warn('Failed to save SRS card rating:', err));
      } catch (err) {
        console.warn('Failed to get token for SRS:', err);
      }
    }

    nextCard();
  };

  const nextCard = () => {
    setIsFlipped(false);
    if (currentIndex < cards.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setSessionComplete(true);
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-12 flex flex-col items-center justify-center space-y-4 shadow-2xl">
          <Loader2 size={48} className="animate-spin text-emerald-500" />
          <p className="text-slate-500 dark:text-zinc-400 font-bold animate-pulse">{loadingText}</p>
        </div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-12 flex flex-col items-center justify-center space-y-4 shadow-2xl max-w-lg text-center">
          <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
             <XCircle size={32} />
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Error Loading Flashcards</h3>
          <p className="text-slate-500 dark:text-zinc-400">{errorMsg}</p>
          <button onClick={onClose} className="mt-6 px-6 py-3 bg-slate-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl font-bold hover:opacity-90 transition-opacity">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-100 dark:border-zinc-800 flex justify-between items-center bg-slate-50 dark:bg-zinc-900">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500 text-white">
              <Brain size={20} />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white leading-none">SRS Flashcards</h2>
              <p className="text-slate-500 dark:text-zinc-400 text-[10px] uppercase tracking-wider mt-1 font-bold">
                {isGlobalReview ? 'Daily Global Review' : module?.title}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-2 rounded-full hover:bg-slate-200 dark:hover:bg-zinc-800 transition-colors">
            <XCircle size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center bg-slate-50 dark:bg-zinc-950">
          {!sessionComplete && cards.length > 0 ? (
            <div className="w-full max-w-lg space-y-8">
              <div className="flex justify-between items-center text-sm font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest">
                <span>Card {currentIndex + 1} of {cards.length}</span>
                <span>{Math.round(((currentIndex) / cards.length) * 100)}%</span>
              </div>
              
              <div className="h-2 w-full bg-slate-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-purple-500 transition-all duration-500" 
                  style={{ width: `${((currentIndex) / cards.length) * 100}%` }}
                />
              </div>

              <div className="relative w-full h-80 perspective-1000">
                <motion.div
                  className="w-full h-full relative preserve-3d cursor-pointer"
                  animate={{ rotateY: isFlipped ? 180 : 0 }}
                  transition={{ duration: 0.6, type: "spring", stiffness: 260, damping: 20 }}
                  onClick={handleFlip}
                >
                  {/* Front */}
                  <div className="absolute inset-0 backface-hidden bg-white dark:bg-zinc-900 border-2 border-slate-100 dark:border-zinc-800 rounded-3xl p-8 flex flex-col items-center justify-center text-center shadow-lg">
                    <div className="text-xl font-bold text-slate-950 dark:text-white markdown-body">
                      <MarkdownRenderer content={cards[currentIndex]?.front || ''} />
                    </div>
                    <p className="absolute bottom-6 text-slate-500 dark:text-zinc-400 text-sm font-medium">Click to flip</p>
                  </div>

                  {/* Back */}
                  <div className="absolute inset-0 backface-hidden bg-purple-50 dark:bg-purple-900/20 border-2 border-purple-100 dark:border-purple-900/30 rounded-3xl p-8 flex flex-col items-center justify-center text-center shadow-lg rotate-y-180">
                    <div className="text-lg text-slate-950 dark:text-white markdown-body">
                      <MarkdownRenderer content={cards[currentIndex]?.back || ''} />
                    </div>
                  </div>
                </motion.div>
              </div>

              <AnimatePresence>
                {isFlipped && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="grid grid-cols-4 gap-2"
                  >
                    <button onClick={() => handleRating(1)} className="py-3 bg-red-100 text-red-700 rounded-xl font-bold text-sm hover:bg-red-200 transition-colors">Again</button>
                    <button onClick={() => handleRating(2)} className="py-3 bg-orange-100 text-orange-700 rounded-xl font-bold text-sm hover:bg-orange-200 transition-colors">Hard</button>
                    <button onClick={() => handleRating(3)} className="py-3 bg-emerald-100 text-emerald-700 rounded-xl font-bold text-sm hover:bg-emerald-200 transition-colors">Good</button>
                    <button onClick={() => handleRating(4)} className="py-3 bg-blue-100 text-blue-700 rounded-xl font-bold text-sm hover:bg-blue-200 transition-colors">Easy</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-6"
            >
              <div className="w-24 h-24 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 size={48} />
              </div>
              <h3 className="text-3xl font-black text-slate-900 dark:text-white">
                {cards.length === 0 && isGlobalReview ? "All Caught Up!" : "Session Complete!"}
              </h3>
              <p className="text-slate-500 dark:text-zinc-400">
                {cards.length === 0 && isGlobalReview 
                  ? "You have no flashcards due for review today. Great job!" 
                  : "You've reviewed all cards for this session."}
              </p>
              <button
                onClick={onClose}
                className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-zinc-900 rounded-2xl font-bold hover:bg-slate-800 dark:hover:bg-zinc-100 transition-colors"
              >
                Return to Hub
              </button>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
