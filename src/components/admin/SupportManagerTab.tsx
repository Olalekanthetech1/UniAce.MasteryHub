import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { HelpCircle, Plus, Trash2, Edit3, Save, CheckCircle, AlertCircle, RefreshCw, Video, Mail, MessageSquare } from 'lucide-react';
import { FaqItem, TutorialItem, SupportConfig, SupportService } from '../../services/supportConfig';

export default function SupportManagerTab() {
  const [config, setConfig] = useState<SupportConfig>({ faqs: [], tutorials: [] });
  const [activeSubTab, setActiveSubTab] = useState<'faqs' | 'tutorials' | 'settings'>('faqs');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [editingFaq, setEditingFaq] = useState<FaqItem | null>(null);
  const [editingTutorial, setEditingTutorial] = useState<TutorialItem | null>(null);

  useEffect(() => {
    const unsubscribe = SupportService.subscribeSupportConfig((liveConfig) => {
      setConfig(liveConfig);
    });
    return () => unsubscribe();
  }, []);

  const handleSave = async (updatedConfig?: SupportConfig) => {
    setSaving(true);
    setSaveStatus('idle');
    try {
      await SupportService.saveSupportConfig(updatedConfig || config);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (e) {
      console.error('Failed to save support config:', e);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddFaq = () => {
    const newFaq: FaqItem = {
      id: `faq_${Date.now()}`,
      question: 'New Frequently Asked Question',
      answer: 'Detailed explanation and instructions for students.',
      category: 'General'
    };
    setEditingFaq(newFaq);
  };

  const handleSaveFaqModal = () => {
    if (!editingFaq) return;
    const existingIdx = config.faqs.findIndex(f => f.id === editingFaq.id);
    let updatedFaqs = [...config.faqs];
    if (existingIdx >= 0) {
      updatedFaqs[existingIdx] = editingFaq;
    } else {
      updatedFaqs.push(editingFaq);
    }
    const updated = { ...config, faqs: updatedFaqs };
    setConfig(updated);
    handleSave(updated);
    setEditingFaq(null);
  };

  const handleDeleteFaq = (id: string) => {
    if (!confirm('Are you sure you want to delete this FAQ?')) return;
    const updated = { ...config, faqs: config.faqs.filter(f => f.id !== id) };
    setConfig(updated);
    handleSave(updated);
  };

  const handleAddTutorial = () => {
    const newTutorial: TutorialItem = {
      id: `tut_${Date.now()}`,
      title: 'New Video Guide',
      duration: '3:00',
      thumbnail: 'https://picsum.photos/seed/guide/400/225',
      description: 'Quick walkthrough on navigating university lecture topics.'
    };
    setEditingTutorial(newTutorial);
  };

  const handleSaveTutorialModal = () => {
    if (!editingTutorial) return;
    const existingIdx = config.tutorials.findIndex(t => t.id === editingTutorial.id);
    let updatedTuts = [...config.tutorials];
    if (existingIdx >= 0) {
      updatedTuts[existingIdx] = editingTutorial;
    } else {
      updatedTuts.push(editingTutorial);
    }
    const updated = { ...config, tutorials: updatedTuts };
    setConfig(updated);
    handleSave(updated);
    setEditingTutorial(null);
  };

  const handleDeleteTutorial = (id: string) => {
    if (!confirm('Are you sure you want to delete this tutorial?')) return;
    const updated = { ...config, tutorials: config.tutorials.filter(t => t.id !== id) };
    setConfig(updated);
    handleSave(updated);
  };

  return (
    <div className="space-y-6" id="support-manager-tab">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-zinc-800 p-6 rounded-2xl border border-slate-200 dark:border-zinc-700 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <HelpCircle className="text-blue-500" size={24} />
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Help, FAQs & Video Tutorials</h2>
          </div>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
            Dynamically update knowledge base articles, video guides, and support contact channels.
          </p>
        </div>
        <div className="flex items-center gap-3">
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
          Support and FAQ content updated successfully!
        </div>
      )}

      {saveStatus === 'error' && (
        <div className="flex items-center gap-2 p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-xl text-sm font-medium">
          <AlertCircle size={18} />
          Failed to sync support data. Check network and admin privileges.
        </div>
      )}

      {/* Sub tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-zinc-700 pb-2">
        <button
          onClick={() => setActiveSubTab('faqs')}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            activeSubTab === 'faqs'
              ? 'bg-blue-500 text-white shadow-sm'
              : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700'
          }`}
        >
          Frequently Asked Questions ({config.faqs.length})
        </button>
        <button
          onClick={() => setActiveSubTab('tutorials')}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            activeSubTab === 'tutorials'
              ? 'bg-blue-500 text-white shadow-sm'
              : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700'
          }`}
        >
          Video Guides & Tutorials ({config.tutorials.length})
        </button>
        <button
          onClick={() => setActiveSubTab('settings')}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            activeSubTab === 'settings'
              ? 'bg-blue-500 text-white shadow-sm'
              : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700'
          }`}
        >
          Contact Channels
        </button>
      </div>

      {/* FAQs list */}
      {activeSubTab === 'faqs' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={handleAddFaq}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-xs transition-colors shadow-sm"
            >
              <Plus size={14} /> Add New FAQ
            </button>
          </div>
          <div className="space-y-3">
            {config.faqs.map((faq) => (
              <div
                key={faq.id}
                className="bg-white dark:bg-zinc-800 rounded-2xl border border-slate-200 dark:border-zinc-700 p-5 flex items-start justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold rounded-md">
                      {faq.category || 'General'}
                    </span>
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm">{faq.question}</h4>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-zinc-300 pl-1">{faq.answer}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setEditingFaq(faq)}
                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    onClick={() => handleDeleteFaq(faq.id)}
                    className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tutorials list */}
      {activeSubTab === 'tutorials' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={handleAddTutorial}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-xs transition-colors shadow-sm"
            >
              <Plus size={14} /> Add Video Guide
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {config.tutorials.map((tut) => (
              <div
                key={tut.id}
                className="bg-white dark:bg-zinc-800 rounded-2xl border border-slate-200 dark:border-zinc-700 overflow-hidden flex flex-col justify-between"
              >
                <div>
                  <div className="relative aspect-video bg-slate-100 dark:bg-zinc-700">
                    <img src={tut.thumbnail} alt={tut.title} className="w-full h-full object-cover" />
                    <span className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/70 text-white text-[10px] font-bold rounded">
                      {tut.duration}
                    </span>
                  </div>
                  <div className="p-4">
                    <h4 className="font-bold text-sm text-slate-900 dark:text-white">{tut.title}</h4>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">{tut.description}</p>
                  </div>
                </div>
                <div className="p-4 pt-0 flex justify-end gap-1">
                  <button
                    onClick={() => setEditingTutorial(tut)}
                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    onClick={() => handleDeleteTutorial(tut.id)}
                    className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Settings / Contact channels */}
      {activeSubTab === 'settings' && (
        <div className="bg-white dark:bg-zinc-800 p-6 rounded-2xl border border-slate-200 dark:border-zinc-700 space-y-4 max-w-lg">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Official Support Email</label>
            <input
              type="email"
              value={config.contactEmail || ''}
              onChange={(e) => setConfig({ ...config, contactEmail: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white text-sm"
              placeholder="uniace.support@gmail.com"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">WhatsApp Support Link/Number</label>
            <input
              type="text"
              value={config.whatsappSupport || ''}
              onChange={(e) => setConfig({ ...config, whatsappSupport: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white text-sm"
              placeholder="+2348012345678"
            />
          </div>
          <button
            onClick={() => handleSave()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-xs transition-colors shadow-sm"
          >
            Save Contact Details
          </button>
        </div>
      )}

      {/* Edit FAQ Modal */}
      {editingFaq && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-zinc-800 rounded-2xl max-w-md w-full p-6 border border-slate-200 dark:border-zinc-700 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Edit FAQ</h3>
            <div className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Category</label>
                <input
                  type="text"
                  value={editingFaq.category}
                  onChange={(e) => setEditingFaq({ ...editingFaq, category: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Question</label>
                <input
                  type="text"
                  value={editingFaq.question}
                  onChange={(e) => setEditingFaq({ ...editingFaq, question: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Answer</label>
                <textarea
                  rows={4}
                  value={editingFaq.answer}
                  onChange={(e) => setEditingFaq({ ...editingFaq, answer: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-zinc-700">
              <button
                onClick={() => setEditingFaq(null)}
                className="px-4 py-2 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl text-sm font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveFaqModal}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-sm"
              >
                Save FAQ
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Edit Tutorial Modal */}
      {editingTutorial && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-zinc-800 rounded-2xl max-w-md w-full p-6 border border-slate-200 dark:border-zinc-700 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Edit Video Guide</h3>
            <div className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Title</label>
                <input
                  type="text"
                  value={editingTutorial.title}
                  onChange={(e) => setEditingTutorial({ ...editingTutorial, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Duration</label>
                  <input
                    type="text"
                    value={editingTutorial.duration}
                    onChange={(e) => setEditingTutorial({ ...editingTutorial, duration: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                    placeholder="3:45"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Thumbnail URL</label>
                  <input
                    type="text"
                    value={editingTutorial.thumbnail}
                    onChange={(e) => setEditingTutorial({ ...editingTutorial, thumbnail: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Description</label>
                <textarea
                  rows={3}
                  value={editingTutorial.description}
                  onChange={(e) => setEditingTutorial({ ...editingTutorial, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-zinc-600 rounded-lg bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-zinc-700">
              <button
                onClick={() => setEditingTutorial(null)}
                className="px-4 py-2 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl text-sm font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTutorialModal}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-sm"
              >
                Save Video Guide
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
