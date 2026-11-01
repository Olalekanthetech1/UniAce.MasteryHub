import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Brain, 
  Trophy, 
  Sparkles, 
  CheckCircle2, 
  ArrowRight, 
  BookOpen, 
  GraduationCap, 
  BarChart3, 
  Calculator, 
  X, 
  Mail, 
  Lock, 
  Loader2, 
  AlertCircle, 
  User,
  Zap
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { UniAceLogo } from './UniAceLogo';

export default function LandingPage() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  
  // Login Modal State
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage('Please fill in all required fields.');
      return;
    }
    if (isSignUp && password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    setErrorMessage('');
    setIsSubmitting(true);
    try {
      if (isSignUp) {
        await signUpWithEmail(email, password, displayName.trim() || undefined);
        toast.success('Account created successfully! Welcome to UniAce.');
      } else {
        await signInWithEmail(email, password);
        toast.success('Successfully logged in!');
      }
      setIsLoginModalOpen(false);
    } catch (err: any) {
      console.error('Email auth error:', err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setErrorMessage('Invalid email or password. If you don\'t have an account yet, switch to "Create Account".');
      } else if (err.code === 'auth/email-already-in-use') {
        setErrorMessage('An account with this email already exists. Please switch to "Sign In".');
      } else if (err.code === 'auth/weak-password') {
        setErrorMessage('Password is too weak. Please use at least 6 characters.');
      } else if (err.code === 'auth/invalid-email') {
        setErrorMessage('Please enter a valid email address.');
      } else {
        setErrorMessage(err.message || 'An error occurred during authentication.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMessage('');
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
      setIsLoginModalOpen(false);
    } catch (err: any) {
      console.error('Google login error:', err);
      setErrorMessage(err.message || 'Google sign-in could not be completed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAuthModal = (signUpMode: boolean = false) => {
    setIsSignUp(signUpMode);
    setErrorMessage('');
    setIsLoginModalOpen(true);
  };

  const scrollToFeatures = () => {
    const el = document.getElementById('core-features');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 font-sans selection:bg-emerald-100 selection:text-emerald-900 transition-colors">
      {/* Navigation */}
      <nav className="fixed w-full bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md z-50 border-b border-slate-100 dark:border-zinc-800">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <UniAceLogo size="md" showText={true} />
          <div className="flex items-center gap-3">
            <button 
              onClick={() => openAuthModal(false)}
              className="px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-zinc-200 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
            >
              Sign In
            </button>
            <button 
              onClick={() => openAuthModal(true)}
              className="px-5 py-2.5 text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl shadow-md shadow-emerald-500/20 transition-all"
            >
              Get Started Free
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-16 lg:pt-44 lg:pb-28 px-6 overflow-hidden">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="lg:col-span-7 space-y-6"
          >
            {/* Primary Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm font-semibold shadow-sm">
              <GraduationCap size={16} className="text-emerald-600 dark:text-emerald-400" />
              <span>Designed for University Students</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-slate-900 dark:text-white tracking-tight leading-[1.12]">
              Achieve Academic Success <br className="hidden sm:inline" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-teal-500">
                with AI Support
              </span>
            </h1>
            
            {/* Hero Subtext */}
            <p className="text-base sm:text-lg lg:text-xl text-slate-600 dark:text-zinc-300 leading-relaxed max-w-2xl">
              Tackle challenging concepts, strengthen your knowledge through intelligent practice, and monitor your progress with precision — all in one platform.
            </p>

            {/* Primary Action / CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 pt-2 w-full sm:w-auto">
              <button 
                onClick={() => openAuthModal(true)}
                className="px-8 py-4 bg-emerald-500 text-white rounded-2xl font-bold text-base hover:bg-emerald-400 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2.5 group"
              >
                <span>Get Started Free</span>
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </button>
              <button 
                onClick={scrollToFeatures}
                className="px-6 py-4 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-200 border border-slate-200 dark:border-zinc-800 rounded-2xl font-semibold text-base hover:bg-slate-50 dark:hover:bg-zinc-800/80 transition-all flex items-center justify-center gap-2"
              >
                Explore Features
              </button>
            </div>

            {/* Friction Reducer */}
            <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400 font-medium flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
              Free tier available • No credit card required
            </p>

            <p className="pt-4 text-xs sm:text-sm text-slate-500 dark:text-zinc-400 font-medium">
              Built to support university students with course-based learning and guided practice.
            </p>
          </motion.div>

          {/* Hero Visual Preview */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="lg:col-span-5 relative"
          >
            <div className="absolute top-0 right-0 w-[450px] h-[450px] bg-emerald-500/10 rounded-full blur-3xl -z-10" />
            
            <div className="relative bg-white dark:bg-zinc-900 rounded-[2rem] shadow-xl shadow-slate-200/60 dark:shadow-none border border-slate-200/80 dark:border-zinc-800 p-5 sm:p-6">
              {/* Product capability label; no user activity is implied. */}
              <div className="absolute -top-4 -right-4 bg-white dark:bg-zinc-800 px-3.5 py-2.5 rounded-2xl shadow-lg border border-slate-100 dark:border-zinc-700 flex items-center gap-2.5">
                <div className="w-8 h-8 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <BookOpen size={16} />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider">Learning tools</p>
                  <p className="text-sm font-black text-slate-900 dark:text-white">Course-based practice</p>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-zinc-950 rounded-2xl p-5 space-y-4 border border-slate-100 dark:border-zinc-800/80">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200/60 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-emerald-500 rounded-xl flex items-center justify-center text-white shadow-xs">
                      <Brain size={18} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">UniAce AI Tutor</h3>
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Ready to explain & derive</p>
                    </div>
                  </div>
                  <span className="text-[11px] px-2.5 py-1 rounded-md bg-slate-200/70 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 font-semibold">
                    Calculus & Physics
                  </span>
                </div>
                
                <div className="space-y-3">
                  <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl shadow-xs border border-slate-200/60 dark:border-zinc-800">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Study workflow</h4>
                    <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
                      Select a course, explore its lessons, practise with guided questions, and review progress from recorded activity.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-white dark:bg-zinc-900 p-3 border border-slate-200/60 dark:border-zinc-800">
                      <BookOpen size={18} className="text-emerald-500 mb-2" />
                      <p className="text-xs font-semibold text-slate-700 dark:text-zinc-300">Course lessons</p>
                    </div>
                    <div className="rounded-xl bg-white dark:bg-zinc-900 p-3 border border-slate-200/60 dark:border-zinc-800">
                      <Brain size={18} className="text-emerald-500 mb-2" />
                      <p className="text-xs font-semibold text-slate-700 dark:text-zinc-300">Guided practice</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Capability Badges Section */}
      <section className="py-12 bg-white/70 dark:bg-zinc-900/60 border-y border-slate-200/70 dark:border-zinc-800/80">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-3 gap-6">
            {/* Capability 1 */}
            <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 shadow-xs hover:border-emerald-300 dark:hover:border-emerald-700/60 transition-all">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-4">
                <Brain size={22} />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">
                Grasp Complex Topics Quickly
              </h3>
              <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
                Step‑by‑step AI explanations with clear mathematical proofs and structured reasoning.
              </p>
            </div>

            {/* Capability 2 */}
            <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 shadow-xs hover:border-emerald-300 dark:hover:border-emerald-700/60 transition-all">
              <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400 flex items-center justify-center mb-4">
                <CheckCircle2 size={22} />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">
                Strengthen Knowledge Through Practice
              </h3>
              <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
                Smart quizzes, instant feedback, and spaced repetition to reinforce retention.
              </p>
            </div>

            {/* Capability 3 */}
            <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 shadow-xs hover:border-emerald-300 dark:hover:border-emerald-700/60 transition-all">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4">
                <BarChart3 size={22} />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">
                Monitor Your Academic Progress
              </h3>
              <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
                Visual dashboards tracking study streaks, topic mastery, and learning milestones.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Core Features Grid */}
      <section id="core-features" className="py-20 lg:py-28 bg-slate-50 dark:bg-zinc-950 transition-colors">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-2xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-4">
              Everything You Need to Excel
            </h2>
            <p className="text-slate-600 dark:text-zinc-400 text-base sm:text-lg leading-relaxed">
              Designed specifically for university coursework across STEM, Business, and Humanities.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Feature 1: Adaptive AI Explanations */}
            <motion.div 
              whileHover={{ y: -4 }}
              className="p-6 sm:p-7 rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div>
                <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mb-5">
                  <Brain size={24} />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2.5">
                  Adaptive AI Explanations
                </h3>
                <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
                  Multi‑step breakdowns tailored to complex university coursework across STEM, Business, and Humanities.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-zinc-800">
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={14} /> Step-by-step proofs
                </span>
              </div>
            </motion.div>

            {/* Feature 2: Interactive Quiz Generator */}
            <motion.div 
              whileHover={{ y: -4 }}
              className="p-6 sm:p-7 rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div>
                <div className="w-12 h-12 bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400 rounded-2xl flex items-center justify-center mb-5">
                  <Zap size={24} />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2.5">
                  Interactive Quiz Generator
                </h3>
                <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
                  Auto‑generated practice questions with comprehensive answer explanations to test and deepen recall.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-zinc-800">
                <span className="text-xs font-semibold text-teal-600 dark:text-teal-400 flex items-center gap-1">
                  <CheckCircle2 size={14} /> Instant rationales
                </span>
              </div>
            </motion.div>

            {/* Feature 3: Formula & Theory Reference */}
            <motion.div 
              whileHover={{ y: -4 }}
              className="p-6 sm:p-7 rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div>
                <div className="w-12 h-12 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center mb-5">
                  <BookOpen size={24} />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2.5">
                  Formula & Theory Reference
                </h3>
                <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
                  Built‑in directory of scientific formulas, definitions, and derivations for quick academic lookup.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-zinc-800">
                <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                  <CheckCircle2 size={14} /> Formula definitions
                </span>
              </div>
            </motion.div>

            {/* Feature 4: Gamified Knowledge Arena */}
            <motion.div 
              whileHover={{ y: -4 }}
              className="p-6 sm:p-7 rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div>
                <div className="w-12 h-12 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center mb-5">
                  <Trophy size={24} />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2.5">
                  Gamified Knowledge Arena
                </h3>
                <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
                  Compete in study challenges, earn XP, and climb the public leaderboard to stay motivated.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-zinc-800">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <CheckCircle2 size={14} /> Leaderboards & XP
                </span>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto bg-slate-900 rounded-[2.5rem] p-10 sm:p-16 text-center relative overflow-hidden shadow-2xl">
          <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/20 rounded-full blur-[90px] -z-0" />
          
          <div className="relative z-10 space-y-6 max-w-2xl mx-auto">
            <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight leading-tight">
              Ready to Achieve Academic Success?
            </h2>
            <p className="text-slate-300 text-base sm:text-lg leading-relaxed">
              Join university students mastering complex coursework, practicing with smart quizzes, and accelerating their learning with UniAce.
            </p>
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
              <button 
                onClick={() => openAuthModal(true)}
                className="w-full sm:w-auto px-8 py-4 bg-emerald-500 text-white rounded-2xl font-bold text-base hover:bg-emerald-400 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-emerald-500/30 flex items-center justify-center gap-2"
              >
                <span>Start Learning Today</span>
                <ArrowRight size={18} />
              </button>
            </div>
            <p className="text-xs sm:text-sm text-slate-400">
              Free tier available • No credit card required
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 border-t border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 transition-colors">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row justify-between items-center gap-4">
          <UniAceLogo size="sm" showText={true} />
          <p className="text-slate-500 dark:text-zinc-500 text-xs sm:text-sm">
            © {new Date().getFullYear()} UniAce Mastery Hub. Built for university academic excellence.
          </p>
        </div>
      </footer>

      {/* Unified Login / Sign Up Modal */}
      <AnimatePresence>
        {isLoginModalOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", duration: 0.4 }}
              className="bg-white dark:bg-zinc-900 rounded-[2rem] w-full max-w-md p-8 border border-slate-200 dark:border-zinc-800 shadow-2xl relative"
            >
              <button 
                onClick={() => {
                  setIsLoginModalOpen(false);
                  setErrorMessage('');
                }}
                className="absolute top-6 right-6 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-400 hover:text-slate-600 transition-all"
                aria-label="Close modal"
              >
                <X size={20} />
              </button>

              <div className="text-center mb-6">
                <div className="flex justify-center mb-4">
                  <UniAceLogo size="xl" />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                  {isSignUp ? 'Create Your Account' : 'Welcome to UniAce'}
                </h3>
                <p className="text-slate-500 text-xs mt-1">
                  {isSignUp ? 'Start mastering your courses with AI support.' : 'Access your personalized university AI tutoring hub.'}
                </p>
              </div>

              {/* Social Login */}
              <button
                onClick={handleGoogleLogin}
                disabled={isSubmitting}
                className="w-full bg-slate-50 hover:bg-slate-100 dark:bg-zinc-800 dark:hover:bg-zinc-700/80 border border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-200 font-semibold py-3.5 rounded-2xl transition-all flex items-center justify-center gap-3 text-sm disabled:opacity-60 shadow-xs"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" referrerPolicy="no-referrer" />
                <span>Continue with Google</span>
              </button>

              <div className="relative flex py-5 items-center">
                <div className="flex-grow border-t border-slate-200 dark:border-zinc-800"></div>
                <span className="flex-shrink mx-4 text-slate-400 text-[10px] font-bold uppercase tracking-widest">or email</span>
                <div className="flex-grow border-t border-slate-200 dark:border-zinc-800"></div>
              </div>

              {/* Mode Switcher Tabs */}
              <div className="grid grid-cols-2 p-1 mb-4 bg-slate-100 dark:bg-zinc-800 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(false);
                    setErrorMessage('');
                  }}
                  className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                    !isSignUp 
                      ? 'bg-white dark:bg-zinc-900 text-slate-900 dark:text-white shadow-xs' 
                      : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(true);
                    setErrorMessage('');
                  }}
                  className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                    isSignUp 
                      ? 'bg-white dark:bg-zinc-900 text-slate-900 dark:text-white shadow-xs' 
                      : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900'
                  }`}
                >
                  Create Account
                </button>
              </div>

              {/* Email & Password Form */}
              <form onSubmit={handleEmailAuth} className="space-y-3.5">
                {isSignUp && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest mb-1.5">Full Name</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input 
                        type="text" 
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="e.g. Alex Johnson"
                        className="w-full pl-11 pr-4 py-2.5 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest mb-1.5">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      type="email" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. name@university.edu"
                      className="w-full pl-11 pr-4 py-2.5 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest mb-1.5">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      type="password" 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={isSignUp ? "At least 6 characters" : "Enter password"}
                      className="w-full pl-11 pr-4 py-2.5 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white font-mono"
                      required
                    />
                  </div>
                </div>

                {errorMessage && (
                  <div className="flex items-start gap-2 text-red-600 dark:text-red-400 text-xs font-semibold bg-red-50 dark:bg-red-950/30 p-3 rounded-xl border border-red-200 dark:border-red-900/40">
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                    <span className="leading-snug">{errorMessage}</span>
                  </div>
                )}

                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white font-bold text-sm rounded-2xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 mt-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>{isSignUp ? 'Creating Account...' : 'Signing In...'}</span>
                    </>
                  ) : (
                    <span>{isSignUp ? 'Create Scholar Account' : 'Sign In with Email'}</span>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
