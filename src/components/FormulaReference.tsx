import { Formula, CourseId } from '../types';
import { motion } from 'motion/react';
import { Book, Search, Copy, Check, GraduationCap, ArrowLeft, Bookmark, AlertTriangle, BookOpen, ArrowRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import { asDisplayMath } from '../shared/mathText';
import { useAuth } from '../context/AuthContext';
import { CourseService } from '../services/courseService';
import { useUserProgress } from '../hooks/useUserProgress';
import { useCourses } from '../context/CourseContext';
import CourseContextBar from './CourseContextBar';
import { isCourseEligibleForUser } from '../utils/courseEligibility';

interface FormulaReferenceProps {
  onBack: () => void;
  activeCourseId: CourseId | null;
  formulas?: Formula[]; // Keep for backward compatibility if needed
  onBookmark?: (formula: Formula) => void;
  onSelectCourse?: (courseId: CourseId) => void;
  activeSemester?: string;
  enrolledCourses?: CourseId[];
}

export default function FormulaReference({ 
  onBack, 
  activeCourseId, 
  formulas: initialFormulas = [], 
  onBookmark,
  onSelectCourse,
  activeSemester = '1st Semester',
  enrolledCourses = []
}: FormulaReferenceProps) {
  const { user, profile } = useAuth();
  const { progress, addBookmark, removeBookmark } = useUserProgress();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [formulas, setFormulas] = useState<Formula[]>(initialFormulas);
  const [loading, setLoading] = useState(false);
  const [isSearchingBroader, setIsSearchingBroader] = useState(false);
  const [hasSearchedBroader, setHasSearchedBroader] = useState(false);

  const { courses } = useCourses();
  const courseList = Object.values(courses);

  const [selectedCourseId, setSelectedCourseId] = useState<CourseId | null>(activeCourseId);

  // Filter program courses using shared eligibility engine
  const availableCourses = Object.values(courses).filter(c => 
    isCourseEligibleForUser(c, profile, activeSemester, enrolledCourses) || enrolledCourses.includes(c.id as CourseId)
  );

  const handleToggleBookmark = (formula: Formula) => {
    const existingBookmark = progress?.bookmarks?.find(
      b => b.type === 'formula' && b.content?.id === formula.id
    );

    if (existingBookmark) {
      removeBookmark(existingBookmark.id);
      setToast({ message: `Removed "${formula.title}" from Notebook`, type: 'info' });
    } else {
      addBookmark(formula, 'formula');
      setToast({ message: `Saved "${formula.title}" to Notebook! 📝`, type: 'success' });
    }
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const filteredFormulas = formulas.filter(f => {
    const title = f.title || '';
    const category = f.category || '';
    const description = f.description || '';
    const searchLower = search.toLowerCase();

    const matchesSearch = title.toLowerCase().includes(searchLower) || 
                         category.toLowerCase().includes(searchLower) ||
                         description.toLowerCase().includes(searchLower);
    const matchesCategory = selectedCategory === 'All' || category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Automatically select the most appropriate course from the filtered list
  useEffect(() => {
    if (activeCourseId) {
      setSelectedCourseId(activeCourseId);
    } else if (availableCourses.length > 0) {
      if (!selectedCourseId || !availableCourses.some(c => c.id === selectedCourseId)) {
        setSelectedCourseId(availableCourses[0].id);
      }
    } else if (courseList.length > 0) {
      setSelectedCourseId(courseList[0].id);
    } else {
      setSelectedCourseId(null);
    }
  }, [profile, availableCourses.length, activeCourseId]);

  const activeCourse = selectedCourseId ? courses[selectedCourseId] : null;

  // Dynamically extract categories from course syllabus (module titles) and existing formulas
  const categories = Array.from(new Set([
    'All',
    ...(activeCourse?.syllabus?.map(m => m.title) || []),
    ...formulas.map(f => f.category).filter(Boolean)
  ])).filter(Boolean);

  // Safeguard: Reset selectedCategory to 'All' if the currently selected category becomes unavailable
  useEffect(() => {
    if (!categories.includes(selectedCategory)) {
      setSelectedCategory('All');
    }
  }, [categories, selectedCategory]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const hasSearch = search.trim().length >= 3;
      const hasCategory = selectedCategory !== 'All';
      const noResults = filteredFormulas.length === 0;
      
      if ((hasSearch || hasCategory) && noResults && !isSearchingBroader && !hasSearchedBroader) {
        handleBroaderSearch();
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [search, selectedCategory, filteredFormulas.length, isSearchingBroader, hasSearchedBroader]);

  // Reset hasSearchedBroader when search or category changes
  useEffect(() => {
    setHasSearchedBroader(false);
  }, [search, selectedCategory]);

  useEffect(() => {
    if (selectedCourseId) {
      setLoading(true);
      CourseService.getFormulas(selectedCourseId)
        .then(fetchedFormulas => {
          if (fetchedFormulas.length > 0) {
            setFormulas(fetchedFormulas);
          } else if (selectedCourseId === activeCourseId && initialFormulas && initialFormulas.length > 0) {
            setFormulas(initialFormulas);
          } else {
            handleBroaderSearch(selectedCourseId);
          }
        })
        .catch(err => {
          console.error('Failed to fetch formulas:', err);
          if (selectedCourseId === activeCourseId && initialFormulas && initialFormulas.length > 0) {
            setFormulas(initialFormulas);
          } else {
            handleBroaderSearch(selectedCourseId);
          }
        })
        .finally(() => setLoading(false));
    } else {
      setFormulas([]);
    }
  }, [selectedCourseId, activeCourseId, initialFormulas]);

  const handleBroaderSearch = async (forcedQuery?: string) => {
    const currentQuery = forcedQuery || search.trim() || (selectedCategory !== 'All' ? selectedCategory : '') || (activeCourse?.title || '');
    if (!currentQuery) return;
    
    setIsSearchingBroader(true);
    setHasSearchedBroader(true);
    try {
      const token = await user?.getIdToken();
      const response = await fetch('/api/formulas/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ query: currentQuery, courseId: selectedCourseId })
      });

      if (!response.ok) throw new Error('Search failed');
      
      const newFormulas = await response.json();
      
      // Add to local list if not already there
      setFormulas(prev => {
        const existingIds = new Set(prev.map(f => f.id));
        const uniqueNewFormulas = newFormulas.filter((f: Formula) => !existingIds.has(f.id));
        return [...uniqueNewFormulas, ...prev];
      });

      // Save new formulas to Firestore subcollection so they are permanently cached for this course
      if (selectedCourseId && newFormulas.length > 0) {
        CourseService.saveFormulas(selectedCourseId, newFormulas).catch(err => {
          console.error('Failed to auto-save formulas to Firestore:', err);
        });
      }
    } catch (error) {
      console.error('Broader search failed:', error);
    } finally {
      setIsSearchingBroader(false);
    }
  };

  const copyToClipboard = (formula: Formula) => {
    navigator.clipboard.writeText(formula.latex);
    setCopiedId(formula.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="flex-1 bg-slate-50 dark:bg-zinc-950 p-3 sm:p-6 lg:p-8 pb-16 transition-colors font-sans">
      <div className="w-full space-y-6 sm:space-y-8">
        
        {/* Course Context Switcher Bar */}
        {onSelectCourse && (
          <CourseContextBar
            courses={courses}
            activeCourseId={activeCourseId}
            onSelectCourse={onSelectCourse}
            profile={profile}
            activeSemester={activeSemester}
            enrolledCourses={enrolledCourses}
            titleLabel="Formula vault Active Course"
          />
        )}

        {/* Header */}
        <header className="space-y-6 lg:pl-4 xl:pl-0">
          <button 
            onClick={onBack}
            className="flex items-center gap-2 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white font-bold text-sm transition-colors group"
          >
            <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
            <span>Back to Dashboard</span>
          </button>

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-emerald-500 font-bold uppercase tracking-widest text-xs">
                <Book size={16} />
                <span>Formula Repository</span>
              </div>
              <h1 className="text-4xl lg:text-5xl font-black text-slate-900 dark:text-white tracking-tight">
                {activeCourse ? `${activeCourse.id}: Equation Vault` : 'The Equation Vault'}
              </h1>
              <p className="text-slate-500 dark:text-zinc-400 text-lg max-w-2xl">
                A centralized repository of every formula, Theorem, and derivation in the {activeCourse?.title || 'course'} syllabus.
              </p>
            </div>

            {activeCourseId && (
              <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
                <div className="relative w-full md:w-80">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                  <input 
                    type="text"
                    placeholder="Search formulas..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleBroaderSearch()}
                    className="w-full pl-12 pr-4 py-4 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl focus:border-slate-900 dark:focus:border-white focus:ring-0 transition-all shadow-sm font-medium text-slate-900 dark:text-white"
                  />
                  {isSearchingBroader && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-500"></div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* STATE 1: No Course Selected */}
        {!activeCourseId && (
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 text-center space-y-6 shadow-sm">
            <div className="w-16 h-16 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto">
              <BookOpen size={32} />
            </div>
            <div className="max-w-md mx-auto space-y-2">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                Select a Course to View Formulas
              </h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400">
                Choose a course from your program curriculum to view mathematical theorems, derivations, and physics laws.
              </p>
            </div>

            {onSelectCourse && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-left max-w-3xl mx-auto pt-4">
                {availableCourses.map(c => (
                  <button
                    key={c.id}
                    onClick={() => onSelectCourse(c.id as CourseId)}
                    className="p-5 bg-slate-50 hover:bg-slate-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-700/60 rounded-2xl transition-all group flex flex-col justify-between"
                  >
                    <div>
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block mb-1">
                        {c.id}
                      </span>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-2 mb-2">
                        {c.title}
                      </h4>
                    </div>
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-zinc-300 pt-3 border-t border-slate-200/60 dark:border-zinc-700/60">
                      <span>{c.level ? `L${c.level}` : 'L100'} • {c.semester || activeSemester}</span>
                      <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform text-emerald-500" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {activeCourseId && (
          <>
            {/* Categories (Quick Filter) */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-6 py-2 rounded-full text-sm font-bold transition-all whitespace-nowrap ${
                    selectedCategory === cat
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-zinc-900 shadow-lg'
                      : 'bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 hover:border-slate-900 dark:hover:white'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Loading State */}
            {loading && (
              <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
              </div>
            )}

            {/* Formula Grid */}
            {!loading && (
              <div className="space-y-8">
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {filteredFormulas.map((formula, i) => (
                    <motion.div
                      key={formula.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-6 sm:p-8 rounded-3xl space-y-6 hover:border-slate-900 dark:hover:border-white transition-all group shadow-sm hover:shadow-md"
                    >
                      <div className="flex items-center justify-between">
                        <div className="px-3 py-1 bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 rounded-full text-[10px] font-bold uppercase tracking-widest">
                          {formula.category}
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => copyToClipboard(formula)}
                            className="p-2 text-slate-400 hover:text-emerald-600 transition-colors bg-slate-50 dark:bg-zinc-800 rounded-full"
                            title="Copy LaTeX"
                          >
                            {copiedId === formula.id ? <Check size={18} /> : <Copy size={18} />}
                          </button>
                          {(() => {
                            const isBookmarked = progress?.bookmarks?.some(
                              b => b.type === 'formula' && b.content?.id === formula.id
                            );
                            return (
                              <button
                                onClick={() => handleToggleBookmark(formula)}
                                className={`p-2 transition-colors rounded-full ${
                                  isBookmarked 
                                    ? 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30' 
                                    : 'text-slate-400 hover:text-emerald-600 bg-slate-50 dark:bg-zinc-800'
                                }`}
                                title={isBookmarked ? "Remove from Notebook" : "Save to Notebook"}
                              >
                                <Bookmark size={18} className={isBookmarked ? "fill-current" : ""} />
                              </button>
                            );
                          })()}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-lg font-bold text-slate-950 dark:text-white">{formula.title}</h3>
                        <div className="p-4 sm:p-8 bg-slate-50 dark:bg-zinc-950 rounded-2xl flex items-center justify-center min-h-[100px] sm:min-h-[140px] border border-slate-100 dark:border-zinc-800 group-hover:bg-white dark:group-hover:bg-zinc-900 transition-colors overflow-x-auto max-w-full">
                          <div className="text-lg sm:text-2xl text-slate-950 dark:text-white w-full text-center flex justify-center">
                            <div className="max-w-full overflow-x-auto py-2">
                              <MarkdownRenderer content={asDisplayMath(formula.latex || '')} />
                            </div>
                          </div>
                        </div>
                        <div className="text-slate-600 dark:text-zinc-300 text-sm leading-relaxed">
                          <MarkdownRenderer content={formula.description} />
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </section>

                {filteredFormulas.length > 0 && search.trim() && (
                  <div className="flex flex-col items-center gap-4 pt-4 border-t border-slate-200 dark:border-zinc-800">
                    <p className="text-slate-500 dark:text-zinc-400 font-medium">Need more related formulas?</p>
                    <button
                      onClick={() => handleBroaderSearch()}
                      disabled={isSearchingBroader}
                      className="px-8 py-3 bg-white dark:bg-zinc-900 border-2 border-slate-900 dark:border-white text-slate-900 dark:text-white rounded-2xl font-bold hover:bg-slate-900 dark:hover:bg-white hover:text-white dark:hover:text-zinc-900 transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      {isSearchingBroader ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                          <span>Consulting UniAce AI...</span>
                        </>
                      ) : (
                        <>
                          <GraduationCap size={20} />
                          <span>Search Broader with UniAce AI</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Empty State / AI Searching */}
            {!loading && filteredFormulas.length === 0 && (search.trim() !== '' || selectedCategory !== 'All' || isSearchingBroader) && (
              <div className="text-center py-20 space-y-8">
                {isSearchingBroader ? (
                  <div className="space-y-6 animate-pulse">
                    <div className="bg-emerald-50 dark:bg-emerald-950/20 p-8 rounded-full w-fit mx-auto text-emerald-500">
                      <GraduationCap size={48} className="animate-bounce" />
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-2xl font-bold text-slate-900 dark:text-white">Consulting UniAce AI...</h3>
                      <p className="text-slate-500 dark:text-zinc-400 max-w-md mx-auto">
                        Searching the broader academic vault for "{search.trim() || selectedCategory}" formulas.
                      </p>
                    </div>
                    <div className="flex justify-center gap-2">
                      <div className="h-2 w-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                      <div className="h-2 w-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                      <div className="h-2 w-2 bg-emerald-500 rounded-full animate-bounce"></div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="bg-slate-100 dark:bg-zinc-800 p-6 rounded-full w-fit mx-auto text-slate-400">
                      <Search size={48} />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xl font-bold text-slate-900 dark:text-white">No results found</h3>
                      <p className="text-slate-500 dark:text-zinc-400">We couldn't find any formulas for "{search.trim() || selectedCategory}" even in the AI vault.</p>
                    </div>
                    <button
                      onClick={() => handleBroaderSearch()}
                      className="px-8 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center gap-2 mx-auto"
                    >
                      <GraduationCap size={20} />
                      <span>Try Different Search</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Initial State (No search yet) */}
            {!loading && !isSearchingBroader && filteredFormulas.length === 0 && search.trim() === '' && selectedCategory === 'All' && (
              <div className="text-center py-20 text-slate-400">
                <Book size={48} className="mx-auto mb-4 opacity-20" />
                <p className="text-lg font-medium">Select a category or search to begin.</p>
              </div>
            )}
          </>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-slate-900 dark:bg-zinc-800 text-white dark:text-white px-6 py-4 rounded-2xl shadow-2xl border border-slate-800 dark:border-zinc-700 font-bold text-sm animate-fade-in animate-slide-up">
          <div className={`h-2.5 w-2.5 rounded-full ${toast.type === 'success' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
