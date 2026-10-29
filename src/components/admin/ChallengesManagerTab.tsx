import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Trophy, Swords, Flame, Star, Target, Zap, Plus, Trash2, Edit3, Save, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { ArenaChallenge, ChallengesService } from '../../services/challengesConfig';

export default function ChallengesManagerTab() {
  const [challenges, setChallenges] = useState<ArenaChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [editingChallenge, setEditingChallenge] = useState<ArenaChallenge | null>(null);

  useEffect(() => {
    const unsubscribe = ChallengesService.subscribeChallenges((liveChallenges) => {
      setChallenges(liveChallenges);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSave = async (updatedChallenges?: ArenaChallenge[]) => {
    setSaving(true);
    setSaveStatus('idle');
    try {
      await ChallengesService.saveChallenges(updatedChallenges || challenges);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (e) {
      console.error('Failed to save challenges:', e);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddNewChallenge = () => {
    const newChallenge: ArenaChallenge = {
      id: `quest_${Date.now()}`,
      title: 'New Daily Quest',
      description: 'Complete 2 Quizzes with perfect score',
      reward: 100,
      rewardType: 'sparks',
      iconType: 'star',
      targetCount: 2,
      category: 'quiz',
      active: true
    };
    setEditingChallenge(newChallenge);
  };

  const handleSaveChallengeModal = () => {
    if (!editingChallenge) return;
    const existingIdx = challenges.findIndex(c => c.id === editingChallenge.id);
    let updated = [...challenges];
    if (existingIdx >= 0) {
      updated[existingIdx] = editingChallenge;
    } else {
      updated.push(editingChallenge);
    }
    setChallenges(updated);
    handleSave(updated);
    setEditingChallenge(null);
  };

  const handleDelete = (id: string) => {
    if (!confirm('Are you sure you want to delete this quest?')) return;
    const updated = challenges.filter(c => c.id !== id);
    setChallenges(updated);
    handleSave(updated);
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'swords': return <Swords size={20} className="text-rose-500" />;
      case 'trophy': return <Trophy size={20} className="text-amber-500" />;
      case 'flame': return <Flame size={20} className="text-orange-500" />;
      case 'star': return <Star size={20} className="text-yellow-500" />;
      case 'target': return <Target size={20} className="text-blue-500" />;
      default: return <Zap size={20} className="text-purple-500" />;
    }
  };

  return (
    <div className="space-y-6" id="challenges-manager-tab">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-zinc-800 p-6 rounded-2xl border border-slate-200 dark:border-zinc-700 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="text-amber-500" size={24} />
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Arena & Daily Quests Manager</h2>
          </div>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
            Configure live gamification quests, battle reward multipliers, Sparks payouts, and targets.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleAddNewChallenge}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold text-sm transition-colors shadow-sm"
          >
            <Plus size={16} /> Add Daily Quest
          </button>
          <button
            onClick={() => handleSave()}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-zinc-100 rounded-xl font-semibold text-sm transition-colors shadow-sm disabled:opacity-50"
          >
            {saving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
            {saving ? 'Saving...' : 'Publish to Live'}
          </button>
        </div>
      </div>

      {saveStatus === 'success' && (
        <div className="flex items-center gap-2 p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl text-sm font-medium">
          <CheckCircle size={18} />
          Daily challenges and quest pool successfully synced!
        </div>
      )}

      {saveStatus === 'error' && (
        <div className="flex items-center gap-2 p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-xl text-sm font-medium">
          <AlertCircle size={18} />
          Failed to sync quests. Check network connection and admin authorization.
        </div>
      )}

      {/* Challenges Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {challenges.map((c) => (
          <div
            key={c.id}
            className="bg-white dark:bg-zinc-800 rounded-2xl border border-slate-200 dark:border-zinc-700 p-6 flex flex-col justify-between"
          >
            <div>
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-slate-50 dark:bg-zinc-700/60 rounded-xl border border-slate-100 dark:border-zinc-700">
                    {getIcon(c.iconType)}
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-slate-900 dark:text-white">{c.title}</h3>
                    <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 dark:text-zinc-500">
                      Category: {c.category}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditingChallenge(c)}
                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-zinc-400 mb-4">{c.description}</p>

              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold px-2.5 py-1 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 rounded-lg border border-amber-200/60 dark:border-amber-800/40">
                  +{c.reward} {c.rewardType.toUpperCase()}
                </span>
                <span className="text-xs text-slate-500 dark:text-zinc-400">Target: {c.targetCount}x</span>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-zinc-700/60 flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400 mt-3">
              <span>Status: {c.active ? '🟢 Active in App' : '⚪ Inactive'}</span>
              <span>ID: {c.id}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Edit Modal */}
      {editingChallenge && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-zinc-800 rounded-2xl max-w-md w-full p-6 border border-slate-200 dark:border-zinc-700 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
              {editingChallenge.id.startsWith('quest_') ? 'Add Daily Quest' : `Edit Quest: ${editingChallenge.title}`}
            </h3>

            <div className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Quest Title</label>
                <input
                  type="text"
                  value={editingChallenge.title}
                  onChange={(e) => setEditingChallenge({ ...editingChallenge, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Description / Prompt</label>
                <input
                  type="text"
                  value={editingChallenge.description}
                  onChange={(e) => setEditingChallenge({ ...editingChallenge, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Reward Value</label>
                  <input
                    type="number"
                    value={editingChallenge.reward}
                    onChange={(e) => setEditingChallenge({ ...editingChallenge, reward: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Reward Type</label>
                  <select
                    value={editingChallenge.rewardType}
                    onChange={(e) => setEditingChallenge({ ...editingChallenge, rewardType: e.target.value as any })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                  >
                    <option value="sparks">Sparks</option>
                    <option value="xp">XP</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Icon Style</label>
                  <select
                    value={editingChallenge.iconType}
                    onChange={(e) => setEditingChallenge({ ...editingChallenge, iconType: e.target.value as any })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                  >
                    <option value="swords">Swords (PvP)</option>
                    <option value="trophy">Trophy (Victory)</option>
                    <option value="flame">Flame (Streak)</option>
                    <option value="star">Star (Quiz)</option>
                    <option value="target">Target (Practice)</option>
                    <option value="zap">Zap (Sparks)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Target Count</label>
                  <input
                    type="number"
                    value={editingChallenge.targetCount}
                    onChange={(e) => setEditingChallenge({ ...editingChallenge, targetCount: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={editingChallenge.active}
                    onChange={(e) => setEditingChallenge({ ...editingChallenge, active: e.target.checked })}
                    className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                  />
                  Active & Display in Student Arena
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-zinc-700">
              <button
                onClick={() => setEditingChallenge(null)}
                className="px-4 py-2 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl text-sm font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveChallengeModal}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold transition-colors shadow-sm"
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
