import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Shield, Eye, EyeOff, ArrowLeft, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { auth } from '../firebase';
import { safeFetchJson } from '../utils/safeFetch';

export default function AdminLogin({ onSuccess, onBackToApp, requireGoogleLogin }: { onSuccess?: () => void; onBackToApp?: () => void; requireGoogleLogin?: boolean }) {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { signInWithGoogle } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await safeFetchJson<any>('/api/admin/verify-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ pin })
      });

      if (res.ok && res.data?.success) {
        try {
          sessionStorage.setItem('admin_pin_verified', 'true');
        } catch {}
        if (onSuccess) {
          onSuccess();
        } else {
          window.history.pushState({}, '', '/admin/dashboard');
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      } else {
        setError(res.error || res.data?.error || 'Invalid PIN. Please try again.');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a1128] flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Atmospheric Background */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-600/20 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="z-10 w-full max-w-md flex flex-col items-center"
      >
        {/* Logo / Icon */}
        <div className="w-16 h-16 bg-blue-500 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(59,130,246,0.5)] mb-6">
          <Shield className="text-white" size={32} />
        </div>

        <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Admin Portal</h1>
        <p className="text-blue-200/70 mb-10 text-sm">UniAce Administration</p>

        {/* Login Card */}
        <div className="w-full bg-[#111836]/80 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-blue-500/20 p-2 rounded-lg">
              <Shield className="text-blue-400" size={18} />
            </div>
            <div>
              <h2 className="text-white font-semibold text-sm">Secure Access</h2>
              <p className="text-slate-400 text-xs">{requireGoogleLogin ? 'Authentication Required' : 'Enter your admin PIN to continue'}</p>
            </div>
          </div>

          {requireGoogleLogin ? (
            <div className="space-y-6 text-center">
              <p className="text-slate-300 text-sm mb-6">You must be logged in with an administrator account to access this portal.</p>
              <button
                onClick={signInWithGoogle}
                className="w-full bg-white hover:bg-gray-50 text-slate-900 font-semibold py-3.5 rounded-xl transition-all flex items-center justify-center gap-3 shadow-lg"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
                Sign in with Google
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 tracking-wider uppercase">Admin PIN</label>
              <div className="relative">
                <input
                  type={showPin ? "text" : "password"}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Enter PIN"
                  className="w-full bg-[#0a1128] border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono tracking-widest"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {error && (
                <motion.p 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="text-red-400 text-xs font-medium mt-2"
                >
                  {error}
                </motion.p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || !pin}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)]"
            >
              {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Shield size={18} />}
              Access Dashboard
            </button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-xs text-slate-500">
              Default PIN: <span className="font-mono text-slate-400">admin1234</span><br/>
              Set ADMIN_PIN env var to change it
            </p>
          </div>
          </>
          )}
        </div>

        {/* Back Link */}
        <button 
          onClick={() => {
            if (onBackToApp) {
              onBackToApp();
            } else {
              window.history.pushState({}, '', '/');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }
          }}
          className="mt-8 flex items-center gap-2 text-blue-400/70 hover:text-blue-400 text-sm font-medium transition-colors cursor-pointer"
        >
          <ArrowLeft size={16} />
          Back to UniAce
        </button>
      </motion.div>
    </div>
  );
}
