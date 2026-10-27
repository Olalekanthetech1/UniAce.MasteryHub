import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Users, Link as LinkIcon, Copy, CheckCircle2, TrendingUp, AlertCircle, ArrowLeft, Loader2, MousePointerClick, CreditCard, Send } from 'lucide-react';
import { auth } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';

interface TutorDashboardProps {
  onBack: () => void;
}

export default function TutorDashboard({ onBack }: TutorDashboardProps) {
  const { user } = useAuth();
  const [affiliateData, setAffiliateData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Payout State
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [isSavingPayout, setIsSavingPayout] = useState(false);
  const [isRequestingPayout, setIsRequestingPayout] = useState(false);
  const [payoutHistories, setPayoutHistories] = useState<any[]>([]);

  useEffect(() => {
    fetchAffiliateData();
  }, [user]);

  const fetchAffiliateData = async () => {
    if (!user) return;
    setIsLoading(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/affiliate/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to load affiliate metrics');
      const data = await res.json();
      const foundData = data.affiliate;
      if (foundData) {
        setAffiliateData(foundData);
        if (foundData.payoutDetails) {
          setBankName(foundData.payoutDetails.bankName || '');
          setAccountName(foundData.payoutDetails.accountName || '');
          setAccountNumber(foundData.payoutDetails.accountNumber || '');
        }
      }
      setPayoutHistories(Array.isArray(data.payouts) ? data.payouts : []);
    } catch (e: any) {
      console.error("Error in fetchAffiliateData:", e);
      const fallbackCode = user.uid.substring(0, 6).toUpperCase();
      setAffiliateData({ 
        id: fallbackCode, 
        signups: 0, 
        clicks: 0, 
        paidConversions: 0, 
        totalEarned: 0, 
        pendingBalance: 0 
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (code: string) => {
    const url = `${window.location.origin}?ref=${code}`;
    navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleSavePayoutDetails = async () => {
    if (!bankName || !accountName || !accountNumber) {
        toast.error('All payout fields are required');
        return;
    }
    
    setIsSavingPayout(true);
    try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/affiliate/payout-settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ bankName, accountName, accountNumber })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast.success(data.message);
        
        // Update local state
        setAffiliateData((prev: any) => ({
            ...prev,
            payoutDetails: { bankName, accountName, accountNumber }
        }));
    } catch (err: any) {
        toast.error(err.message || 'Failed to save payout details');
    } finally {
        setIsSavingPayout(false);
    }
  };

  const handleRequestPayout = async () => {
      if (!affiliateData?.payoutDetails?.bankName) {
          toast.error("Please save your payment details first.");
          return;
      }
      
      const pending = affiliateData?.pendingBalance || 0;
      if (pending < 5000) {
          toast.error("Minimum payout threshold is ₦5,000");
          return;
      }
      
      setIsRequestingPayout(true);
      try {
          const token = await auth.currentUser?.getIdToken();
          const res = await fetch('/api/affiliate/request-payout', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
              }
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          toast.success(data.message);
          
          // Refresh state
          await fetchAffiliateData();
      } catch (err: any) {
          toast.error(err.message || 'Failed to request payout');
      } finally {
          setIsRequestingPayout(false);
      }
  };

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in w-full max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={onBack}
          className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
        >
          <ArrowLeft size={24} className="text-slate-700 dark:text-slate-200" />
        </button>
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Tutor Dashboard</h2>
          <p className="text-slate-500 font-medium">Track your referrals and earnings</p>
        </div>
      </div>

      {error ? (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-6 rounded-3xl flex items-center gap-3 shadow-sm border border-red-100 dark:border-red-900/30">
          <AlertCircle size={28} />
          <p className="text-lg font-medium">{error}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Tracking Link Card */}
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 shadow-sm">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Your Tracking Link</h3>
            <div className="flex gap-4">
              <div className="flex-1 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-2xl px-6 py-4 text-slate-900 dark:text-white font-mono text-lg flex items-center justify-between">
                <span>{window.location.origin}?ref={affiliateData?.id}</span>
                <button
                  onClick={() => copyToClipboard(affiliateData?.id)}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-100 dark:bg-indigo-900/30 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 rounded-xl text-indigo-700 dark:text-indigo-400 font-bold transition-colors"
                >
                  {copiedCode === affiliateData?.id ? <CheckCircle2 size={20} /> : <Copy size={20} />}
                  {copiedCode === affiliateData?.id ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <p className="text-slate-500 dark:text-zinc-400 mt-4 text-sm">
              Share this link to earn 30% commission on every user who signs up and pays for a plan.
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <MousePointerClick size={24} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Link Clicks</div>
                  <div className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">{affiliateData?.clicks || 0}</div>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-2xl flex items-center justify-center text-orange-600 dark:text-orange-400">
                  <Users size={24} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Signups</div>
                  <div className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">{affiliateData?.signups || 0}</div>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm ring-1 ring-emerald-500/20">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <TrendingUp size={24} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-500 uppercase tracking-wider">Paid Users</div>
                  <div className="text-2xl sm:text-3xl font-bold text-emerald-700 dark:text-emerald-400">{affiliateData?.paidConversions || 0}</div>
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-3xl p-6 shadow-lg shadow-indigo-200 dark:shadow-indigo-900/20 text-white">
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-white/20 backdrop-blur-sm rounded-xl">
                    <TrendingUp size={20} />
                  </div>
                  <span className="text-[10px] font-bold bg-emerald-400 text-emerald-900 px-2 py-0.5 rounded-full uppercase tracking-tighter">Balance</span>
                </div>
                <div className="mt-auto">
                  <div className="text-xs font-semibold text-indigo-100 uppercase tracking-wider mb-1">Pending Payout</div>
                  <div className="text-2xl sm:text-3xl font-bold">₦{(affiliateData?.pendingBalance || 0).toLocaleString()}</div>
                  <div className="text-[10px] text-indigo-100 mt-2 font-medium">Total Earned: ₦{(affiliateData?.totalEarned || 0).toLocaleString()}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Payout Threshold Progress Visualizer & Commission Structure */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Threshold Visualizer */}
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-slate-900 dark:text-white text-base">Payout Threshold Progress</h4>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
                    ₦{(affiliateData?.pendingBalance || 0).toLocaleString()} / ₦5,000
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-slate-100 dark:bg-zinc-800 h-3 rounded-full overflow-hidden mb-3">
                  <div 
                    className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, ((affiliateData?.pendingBalance || 0) / 5000) * 100))}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
                  {(affiliateData?.pendingBalance || 0) >= 5000 ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                      <CheckCircle2 size={14} /> Threshold unlocked! You can request your ₦{(affiliateData?.pendingBalance || 0).toLocaleString()} payout below.
                    </span>
                  ) : (
                    <span>
                      You need <strong className="text-slate-900 dark:text-white">₦{(5000 - (affiliateData?.pendingBalance || 0)).toLocaleString()}</strong> more in earnings to request a bank transfer.
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* 30% Flat Commission Breakdown */}
            <div className="bg-slate-50 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm">
              <h4 className="font-bold text-slate-900 dark:text-white text-base mb-3 flex items-center gap-2">
                <span>💰</span> 30% Commission Earnings Model
              </h4>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-white dark:bg-zinc-800/80 p-3 rounded-2xl border border-slate-100 dark:border-zinc-700/50">
                  <div className="text-slate-500 font-medium">Monthly Scholar Plan</div>
                  <div className="text-slate-900 dark:text-white font-bold text-sm mt-0.5">Student pays ₦1,500</div>
                  <div className="text-emerald-600 dark:text-emerald-400 font-bold mt-1">Tutor gets ₦450 (30%)</div>
                </div>
                <div className="bg-white dark:bg-zinc-800/80 p-3 rounded-2xl border border-slate-100 dark:border-zinc-700/50">
                  <div className="text-slate-500 font-medium">Semester Bundle</div>
                  <div className="text-slate-900 dark:text-white font-bold text-sm mt-0.5">Student pays ₦4,500</div>
                  <div className="text-emerald-600 dark:text-emerald-400 font-bold mt-1">Tutor gets ₦1,350 (30%)</div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Payment Details */}
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                   <CreditCard size={20} />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Payment Details</h3>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g. Guarantee Trust Bank"
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Account Name</label>
                  <input
                    type="text"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Account Number</label>
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="0123456789"
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all dark:text-white"
                  />
                </div>
                
                <button
                    onClick={handleSavePayoutDetails}
                    disabled={isSavingPayout}
                    className="w-full mt-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-colors flex items-center justify-center disabled:opacity-50"
                  >
                  {isSavingPayout ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Details'}
                </button>
              </div>
            </div>

            {/* Request Payout */}
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 shadow-sm flex flex-col">
               <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                   <Send size={20} />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Request Payout</h3>
              </div>
              
              <div className="flex-1 flex flex-col justify-center gap-6">
                  <div className="text-center">
                      <div className="text-sm font-semibold text-slate-500 mb-2 uppercase tracking-wider">Available for Payout</div>
                      <div className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 dark:text-white">₦{(affiliateData?.pendingBalance || 0).toLocaleString()}</div>
                      <p className="text-sm text-slate-500 dark:text-zinc-400 mt-4 px-6">
                          Minimum payout threshold is ₦5,000. Payouts are usually processed within 2-3 business days.
                      </p>
                  </div>
                  
                  <button
                    onClick={handleRequestPayout}
                    disabled={isRequestingPayout || (affiliateData?.pendingBalance || 0) < 5000 || !affiliateData?.payoutDetails?.bankName}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors flex items-center justify-center text-lg disabled:opacity-50 disabled:hover:bg-emerald-600"
                  >
                    {isRequestingPayout ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Request Payout'}
                  </button>
              </div>
            </div>
          </div>

          {/* Payout History */}
          {payoutHistories.length > 0 && (
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 shadow-sm">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6">Payout History</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-zinc-800 text-sm font-medium text-slate-500 dark:text-slate-400">
                      <th className="pb-4 font-medium px-4">Date</th>
                      <th className="pb-4 font-medium px-4">Amount</th>
                      <th className="pb-4 font-medium px-4">Account</th>
                      <th className="pb-4 font-medium px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutHistories.map((h, i) => (
                      <tr key={i} className="border-b border-slate-100 dark:border-zinc-800/50 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors">
                        <td className="py-4 px-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400">
                           {h.createdAt ? new Date(h.createdAt?.toDate ? h.createdAt.toDate() : h.createdAt).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="py-4 px-4 font-bold text-emerald-600 dark:text-emerald-400">
                          ₦{(h.amount || 0).toLocaleString()}
                        </td>
                        <td className="py-4 px-4 text-sm text-slate-700 dark:text-slate-300">
                          {h.payoutDetails?.bankName} - {h.payoutDetails?.accountNumber}
                        </td>
                        <td className="py-4 px-4">
                          <span className={`px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
                            h.status === 'pending' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                            h.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                            'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          }`}>
                            {h.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
