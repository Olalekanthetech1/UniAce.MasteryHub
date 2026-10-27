import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Users, Link as LinkIcon, Plus, Copy, CheckCircle2, TrendingUp, AlertCircle, X, Loader2, Save, Percent, ShieldCheck, Settings } from 'lucide-react';
import { auth } from '../firebase';

export default function AdminAffiliates() {
  const [affiliates, setAffiliates] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newAffiliateCode, setNewAffiliateCode] = useState('');
  const [newAffiliateName, setNewAffiliateName] = useState('');
  const [newAffiliateEmail, setNewAffiliateEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  
  // Payouts state
  const [activeTab, setActiveTab] = useState<'overview' | 'payouts'>('overview');
  const [payouts, setPayouts] = useState<any[]>([]);
  const [isLoadingPayouts, setIsLoadingPayouts] = useState(false);
  const [processingPayout, setProcessingPayout] = useState<string | null>(null);

  // Commission settings
  const [globalCommissionRate, setGlobalCommissionRate] = useState<number>(30); // in percentage
  const [isSavingCommission, setIsSavingCommission] = useState(false);

  useEffect(() => {
    fetchOverview();
  }, []);

  const fetchOverview = async () => {
    setIsLoading(true);
    setIsLoadingPayouts(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/affiliates-overview', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error('Failed to load affiliates overview');
      const data = await res.json();
      setAffiliates(Array.isArray(data.affiliates) ? data.affiliates : []);
      setPayouts(Array.isArray(data.payouts) ? data.payouts : []);
      if (typeof data.commissionRate === 'number') {
        setGlobalCommissionRate(data.commissionRate <= 1 ? data.commissionRate * 100 : data.commissionRate);
      }
    } catch (e) {
      console.error(e);
      setError('Failed to load affiliates.');
    } finally {
      setIsLoading(false);
      setIsLoadingPayouts(false);
    }
  };

  const fetchPayouts = () => fetchOverview();
  const fetchAffiliates = () => fetchOverview();

  const handleUpdateStatus = async (payoutId: string, status: 'approved' | 'rejected') => {
    setProcessingPayout(payoutId);
    try {
      if (!auth || !auth.currentUser) throw new Error("Unauthorized");
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/admin/payout-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ payoutId, status })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setSuccess(`Payout ${status} successfully!`);
      setTimeout(() => setSuccess(''), 3000);
      await fetchOverview();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to update payout');
    } finally {
      setProcessingPayout(null);
    }
  };

  const saveCommissionRate = async () => {
    setIsSavingCommission(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/commissions', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ rate: globalCommissionRate / 100 })
      });
      if (!res.ok) throw new Error('Failed to update commission rate');
      setSuccess('Commission rate updated successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      console.error(e);
      setError('Failed to update commission rate.');
    } finally {
      setIsSavingCommission(false);
    }
  };

  const createAffiliate = async () => {
    const code = newAffiliateCode.trim().toUpperCase();
    if (!code || !newAffiliateName.trim()) {
      setError('Name and Referral Code are required.');
      return;
    }
    
    // Check if code exists
    if (affiliates.some(a => a.id === code)) {
      setError('This referral code already exists.');
      return;
    }

    setIsCreating(true);
    setError('');
    try {
      if (!auth) throw new Error("Firebase not initialized");
      
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Unauthorized");

      const response = await fetch('/api/admin/create-affiliate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          code,
          name: newAffiliateName.trim(),
          userEmail: newAffiliateEmail.trim().toLowerCase()
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create affiliate');
      }

      setSuccess(data.message || 'Affiliate created successfully!');
      setNewAffiliateCode('');
      setNewAffiliateName('');
      setNewAffiliateEmail('');
      setTimeout(() => setSuccess(''), 3000);
      fetchAffiliates();
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Failed to create affiliate.');
    } finally {
      setIsCreating(false);
    }
  };

  const copyToClipboard = (code: string) => {
    const url = `${window.location.origin}?ref=${code}`;
    navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Affiliates & Payouts</h2>
          <p className="text-slate-500 dark:text-zinc-400">Manage referral codes, view conversions, and handle payouts.</p>
        </div>
      </div>

      <div className="flex gap-4 border-b border-slate-200 dark:border-zinc-800 pb-px">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'overview' 
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' 
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
          }`}
        >
          Overview & Settings
        </button>
        <button
          onClick={() => setActiveTab('payouts')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'payouts' 
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' 
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
          }`}
        >
          Payout Requests
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-2xl flex items-center gap-3">
          <AlertCircle size={20} />
          <p>{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 p-4 rounded-2xl flex items-center gap-3">
          <CheckCircle2 size={20} />
          <p>{success}</p>
        </div>
      )}

      {activeTab === 'overview' && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Affiliate Card */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <Plus size={20} className="text-indigo-600" />
            Create New Affiliate
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tutor/Partner Name</label>
              <input 
                type="text" 
                value={newAffiliateName}
                onChange={(e) => setNewAffiliateName(e.target.value)}
                placeholder="e.g. John Doe, Math Academy"
                className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Custom Referral Code</label>
              <div className="relative">
                <input 
                  type="text" 
                  value={newAffiliateCode}
                  onChange={(e) => setNewAffiliateCode(e.target.value.toUpperCase())}
                  placeholder="e.g. TUTOR30"
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white"
                />
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tutor Email (Optional - Links to existing User)</label>
              <input 
                type="email" 
                value={newAffiliateEmail}
                onChange={(e) => setNewAffiliateEmail(e.target.value)}
                placeholder="tutor@example.com (will auto-link their dashboard to this code)"
                className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white"
              />
            </div>
          </div>
          <div className="mt-4">
            <button
              onClick={createAffiliate}
              disabled={isCreating}
              className="w-full h-[50px] bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {isCreating ? <Loader2 className="animate-spin" size={20} /> : <Plus size={20} />}
              Create Affiliate Link
            </button>
          </div>
        </div>

        {/* Global Commission Settings */}
        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <Settings size={20} className="text-indigo-600" />
            Commission Policy
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Global Commission Rate (%)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Percent size={18} className="text-slate-400" />
                </div>
                <input 
                  type="number" 
                  value={globalCommissionRate}
                  onChange={(e) => setGlobalCommissionRate(Number(e.target.value))}
                  placeholder="30"
                  min="0"
                  max="100"
                  className="w-full pl-11 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white font-bold"
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                This rate applies to all affiliates. 30% means they earn ₦300 for every ₦1,000 paid by their referrals.
              </p>
            </div>
            
            <button
              onClick={saveCommissionRate}
              disabled={isSavingCommission}
              className="w-full h-[50px] bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-sm"
            >
              {isSavingCommission ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              Save Policy
            </button>

            <div className="pt-4 border-t border-slate-100 dark:border-zinc-800">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 mb-1">
                <ShieldCheck size={14} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Dynamic Rule Active</span>
              </div>
              <p className="text-[10px] text-slate-400">
                Changes will apply to all future payments instantly. Existing earnings are not recalculated.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Affiliates List */}
      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6">Active Affiliates & Tutors</h3>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-indigo-600" size={32} />
          </div>
        ) : affiliates.length === 0 ? (
          <div className="text-center py-12">
            <Users className="mx-auto h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-medium text-slate-900 dark:text-white">No affiliates yet</h3>
            <p className="text-slate-500 max-w-sm mx-auto mt-2">
              Create a custom referral code above to start partnering with tutors.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-zinc-800 text-sm font-medium text-slate-500 dark:text-slate-400">
                  <th className="pb-4 font-medium px-4">Partner Name</th>
                  <th className="pb-4 font-medium px-4">Referral Code</th>
                  <th className="pb-4 font-medium px-4 text-center">Tracking Link</th>
                  <th className="pb-4 font-medium px-4 text-center">Clicks</th>
                  <th className="pb-4 font-medium px-4 text-center">Users Joined</th>
                  <th className="pb-4 font-medium px-4 text-center">Paid Users</th>
                  <th className="pb-4 font-medium px-4 text-center">Total Earnings</th>
                </tr>
              </thead>
              <tbody>
                {affiliates.map((aff) => (
                  <tr key={aff.id} className="border-b border-slate-100 dark:border-zinc-800/50 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="py-4 px-4">
                      <p className="font-bold text-slate-900 dark:text-white">{aff.name || 'System Generated'}</p>
                      <p className="text-xs text-slate-500">
                        Added {aff.createdAt ? new Date(aff.createdAt.toDate()).toLocaleDateString() : 'Auto Tracked'}
                      </p>
                    </td>
                    <td className="py-4 px-4 font-mono font-medium text-indigo-600 dark:text-indigo-400">
                      {aff.id}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex justify-center">
                        <button
                          onClick={() => copyToClipboard(aff.id)}
                          className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 rounded-lg text-slate-700 dark:text-slate-300 text-sm font-medium transition-colors"
                        >
                          {copiedCode === aff.id ? <CheckCircle2 size={16} className="text-green-500" /> : <Copy size={16} />}
                          {copiedCode === aff.id ? 'Copied URL!' : 'Copy Link'}
                        </button>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <LinkIcon size={16} className="text-slate-400" />
                        <span className="font-bold text-slate-900 dark:text-white">{aff.clicks || 0}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Users size={16} className="text-slate-400" />
                        <span className="font-bold text-slate-900 dark:text-white">{aff.signups || 0}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <TrendingUp size={16} className="text-green-500" />
                        <span className="font-bold text-slate-900 dark:text-white">{aff.paidConversions || 0}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-center">
                      <span className="font-bold text-slate-900 dark:text-white">₦{(aff.totalEarned || 0).toLocaleString()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    )}

      {activeTab === 'payouts' && (
        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6">Payout Requests</h3>
          
          {isLoadingPayouts ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-indigo-600" size={32} />
            </div>
          ) : payouts.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="mx-auto h-12 w-12 text-slate-400 mb-4" />
              <h3 className="text-lg font-medium text-slate-900 dark:text-white">All caught up!</h3>
              <p className="text-slate-500 max-w-sm mx-auto mt-2">
                No pending payout requests at the moment.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-zinc-800 text-sm font-medium text-slate-500 dark:text-slate-400">
                    <th className="pb-4 font-medium px-4">Date</th>
                    <th className="pb-4 font-medium px-4">Affiliate</th>
                    <th className="pb-4 font-medium px-4">Amount</th>
                    <th className="pb-4 font-medium px-4">Bank Details</th>
                    <th className="pb-4 font-medium px-4">Status</th>
                    <th className="pb-4 font-medium px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((payout) => (
                    <tr key={payout.id} className="border-b border-slate-100 dark:border-zinc-800/50 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors text-sm">
                      <td className="py-4 px-4 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {payout.createdAt ? new Date(payout.createdAt?.toDate ? payout.createdAt.toDate() : payout.createdAt).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="py-4 px-4 font-bold text-slate-900 dark:text-white">
                        {payout.affiliateId}
                      </td>
                      <td className="py-4 px-4 font-bold text-emerald-600 dark:text-emerald-400">
                        ₦{(payout.amount || 0).toLocaleString()}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-700 dark:text-slate-200">{payout.payoutDetails?.bankName}</span>
                          <span className="text-slate-600 dark:text-slate-400">{payout.payoutDetails?.accountNumber}</span>
                          <span className="text-xs text-slate-500">{payout.payoutDetails?.accountName}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className={`px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
                          payout.status === 'pending' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                          payout.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                          'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }`}>
                          {payout.status}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        {payout.status === 'pending' && (
                          <div className="flex justify-end gap-2">
                            <button
                                onClick={() => handleUpdateStatus(payout.id, 'approved')}
                                disabled={processingPayout === payout.id}
                                className="px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 dark:text-emerald-400 rounded-lg font-medium transition-colors disabled:opacity-50"
                            >
                                {processingPayout === payout.id ? '...' : 'Approve'}
                            </button>
                            <button
                                onClick={() => handleUpdateStatus(payout.id, 'rejected')}
                                disabled={processingPayout === payout.id}
                                className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 rounded-lg font-medium transition-colors disabled:opacity-50"
                            >
                                Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}
    </div>
  );
}
