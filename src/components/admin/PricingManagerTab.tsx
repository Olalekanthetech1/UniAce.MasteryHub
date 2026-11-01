import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { CreditCard, Plus, Trash2, Edit3, Save, CheckCircle, AlertCircle, RefreshCw, Zap, Shield, Sparkles } from 'lucide-react';
import { PricingPlan, PricingConfig, PricingService } from '../../services/pricingConfig';

export default function PricingManagerTab() {
  const [config, setConfig] = useState<PricingConfig>({ plans: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [editingPlan, setEditingPlan] = useState<PricingPlan | null>(null);
  const [featureInput, setFeatureInput] = useState('');

  useEffect(() => {
    const unsubscribe = PricingService.subscribePricingConfig((liveConfig) => {
      setConfig(liveConfig);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSave = async (updatedConfig?: PricingConfig) => {
    setSaving(true);
    setSaveStatus('idle');
    try {
      await PricingService.savePricingConfig(updatedConfig || config);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (e) {
      console.error('Failed to save pricing config:', e);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddNewPlan = () => {
    const newPlan: PricingPlan = {
      id: `plan_${Date.now()}`,
      name: 'New Custom Tier',
      price: 2000,
      sparks: '3,000',
      duration: '30 Days',
      features: ['3,000 AI Sparks', 'Exam Readiness Prediction', 'Priority Support'],
      popular: false,
      enabled: true
    };
    setEditingPlan(newPlan);
  };

  const handleSavePlanModal = () => {
    if (!editingPlan) return;
    const existingIndex = config.plans.findIndex(p => p.id === editingPlan.id);
    let updatedPlans = [...config.plans];
    if (existingIndex >= 0) {
      updatedPlans[existingIndex] = editingPlan;
    } else {
      updatedPlans.push(editingPlan);
    }
    const updated = { ...config, plans: updatedPlans };
    setConfig(updated);
    handleSave(updated);
    setEditingPlan(null);
  };

  const handleDeletePlan = (planId: string) => {
    if (!confirm('Are you sure you want to delete this pricing tier?')) return;
    const updated = { ...config, plans: config.plans.filter(p => p.id !== planId) };
    setConfig(updated);
    handleSave(updated);
  };

  const handleAddFeature = () => {
    if (!featureInput.trim() || !editingPlan) return;
    setEditingPlan({
      ...editingPlan,
      features: [...editingPlan.features, featureInput.trim()]
    });
    setFeatureInput('');
  };

  const handleRemoveFeature = (index: number) => {
    if (!editingPlan) return;
    setEditingPlan({
      ...editingPlan,
      features: editingPlan.features.filter((_, i) => i !== index)
    });
  };

  return (
    <div className="space-y-6" id="pricing-manager-tab">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-zinc-800 p-6 rounded-2xl border border-slate-200 dark:border-zinc-700 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <CreditCard className="text-emerald-600 dark:text-emerald-400" size={24} />
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Dynamic Pricing & Subscriptions</h2>
          </div>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
            Manage Paystack payment plans, AI sparks bundles, duration, and feature offerings in real-time.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleAddNewPlan}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-colors shadow-sm"
          >
            <Plus size={16} /> Add Plan Tier
          </button>
          <button
            onClick={() => handleSave()}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-zinc-100 rounded-xl font-semibold text-sm transition-colors shadow-sm disabled:opacity-50"
          >
            {saving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
            {saving ? 'Publishing...' : 'Publish to Live'}
          </button>
        </div>
      </div>

      {saveStatus === 'success' && (
        <div className="flex items-center gap-2 p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl text-sm font-medium">
          <CheckCircle size={18} />
          Pricing configuration saved and broadcast to all live students!
        </div>
      )}

      {saveStatus === 'error' && (
        <div className="flex items-center gap-2 p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-xl text-sm font-medium">
          <AlertCircle size={18} />
          Failed to publish pricing config. Check network and admin permissions.
        </div>
      )}

      {/* Plan Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {config.plans.map((plan) => (
          <div
            key={plan.id}
            className={`relative bg-white dark:bg-zinc-800 rounded-2xl border ${
              plan.popular ? 'border-emerald-500 shadow-md ring-1 ring-emerald-500' : 'border-slate-200 dark:border-zinc-700'
            } p-6 flex flex-col justify-between`}
          >
            {plan.popular && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                Most Popular
              </span>
            )}

            <div>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-lg text-slate-900 dark:text-white">{plan.name}</h3>
                  <span className="text-xs font-medium text-slate-500 dark:text-zinc-400">ID: {plan.id}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditingPlan(plan)}
                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    onClick={() => handleDeletePlan(plan.id)}
                    className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="mb-4">
                <span className="text-3xl font-extrabold text-slate-900 dark:text-white">₦{plan.price.toLocaleString()}</span>
                <span className="text-sm text-slate-500 dark:text-zinc-400 font-medium"> / {plan.duration}</span>
              </div>

              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-bold mb-4">
                <Zap size={14} className="fill-amber-500 text-amber-500" />
                {plan.sparks} AI Sparks Included
              </div>

              <ul className="space-y-2 mb-6">
                {plan.features.map((feat, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-xs text-slate-600 dark:text-zinc-300">
                    <CheckCircle size={14} className="text-emerald-500 flex-shrink-0" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-zinc-700/60 flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400">
              <span>Status: {plan.enabled !== false ? '🟢 Active' : '⚪ Disabled'}</span>
              <span>Code: {plan.paystackPlanCode || 'None'}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Edit / Create Modal */}
      {editingPlan && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-zinc-800 rounded-2xl max-w-lg w-full p-6 border border-slate-200 dark:border-zinc-700 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
              {editingPlan.id.startsWith('plan_') ? 'Add New Pricing Tier' : `Edit Tier: ${editingPlan.name}`}
            </h3>

            <div className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Tier Name</label>
                <input
                  type="text"
                  value={editingPlan.name}
                  onChange={(e) => setEditingPlan({ ...editingPlan, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Price (NGN ₦)</label>
                  <input
                    type="number"
                    value={editingPlan.price}
                    onChange={(e) => setEditingPlan({ ...editingPlan, price: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Sparks Count</label>
                  <input
                    type="text"
                    value={editingPlan.sparks}
                    onChange={(e) => setEditingPlan({ ...editingPlan, sparks: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                    placeholder="2,000"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Duration Label</label>
                  <input
                    type="text"
                    value={editingPlan.duration}
                    onChange={(e) => setEditingPlan({ ...editingPlan, duration: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                    placeholder="30 Days"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Paystack Plan Code</label>
                  <input
                    type="text"
                    value={editingPlan.paystackPlanCode || ''}
                    onChange={(e) => setEditingPlan({ ...editingPlan, paystackPlanCode: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                    placeholder="PLN_xxxx"
                  />
                </div>
              </div>

              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={editingPlan.popular || false}
                    onChange={(e) => setEditingPlan({ ...editingPlan, popular: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Mark as 'Most Popular'
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={editingPlan.enabled !== false}
                    onChange={(e) => setEditingPlan({ ...editingPlan, enabled: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Tier Enabled
                </label>
              </div>

              {/* Features List */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Features Included</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={featureInput}
                    onChange={(e) => setFeatureInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddFeature()}
                    placeholder="Add a feature (e.g. Unlimited AI Flashcards)"
                    className="flex-1 px-3 py-1.5 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white text-xs"
                  />
                  <button
                    onClick={handleAddFeature}
                    className="px-3 py-1.5 bg-slate-200 dark:bg-zinc-700 text-slate-800 dark:text-zinc-200 font-semibold rounded-lg text-xs hover:bg-slate-300 dark:hover:bg-zinc-600 transition-colors"
                  >
                    Add
                  </button>
                </div>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {editingPlan.features.map((feat, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-slate-50 dark:bg-zinc-900/60 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 text-xs">
                      <span>{feat}</span>
                      <button onClick={() => handleRemoveFeature(idx)} className="text-rose-500 hover:text-rose-700">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-zinc-700">
              <button
                onClick={() => setEditingPlan(null)}
                className="px-4 py-2 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl text-sm font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePlanModal}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-sm"
              >
                Apply & Save
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
