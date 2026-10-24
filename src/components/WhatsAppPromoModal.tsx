import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { MessageCircle, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LogService } from '../services/logService';
import toast from 'react-hot-toast';

export default function WhatsAppPromoModal({ onClose }: { onClose?: () => void }) {
  const [whatsappLink, setWhatsappLink] = useState('');
  const [isVisible, setIsVisible] = useState(true);
  const { user, updateProfileData } = useAuth();

  useEffect(() => {
    const fetchLink = async () => {
      try {
        const res = await fetch('/api/system/config/community');
        if (res.ok) {
          const json = await res.json();
          if (json.data?.whatsappLink) {
            setWhatsappLink(json.data.whatsappLink);
          }
        }
      } catch (e) {
        console.warn("Failed to fetch whatsapp link from Neon system_config:", e);
      }
    };
    fetchLink();
  }, []);

  const handleDismiss = async (action: 'clicked' | 'skipped') => {
    setIsVisible(false);
    if (user && updateProfileData) {
      try {
        await updateProfileData({ has_seen_whatsapp: true });
        await LogService.log('info', 'user', `whatsapp_promo_${action}`, { source: 'promo_modal' });
      } catch (e) {
        console.error("Failed to update user profile dismissal:", e);
        toast.error("Failed to save preference. Please try again.");
      }
    }
    if (onClose) onClose();
  };

  const handleJoin = () => {
    handleDismiss('clicked');
  };

  const handleSkip = () => {
    handleDismiss('skipped');
  };

  if (!whatsappLink || !isVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 dark:border-zinc-800 p-8 text-center relative"
      >
        <button 
          onClick={handleSkip}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 dark:bg-zinc-800 rounded-full transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
        
        <div className="w-20 h-20 bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mx-auto mb-6">
          <MessageCircle size={40} className="ml-1" />
        </div>
        
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">Join the Community!</h2>
        <p className="text-slate-600 dark:text-zinc-400 mb-8 max-w-[280px] mx-auto">
          Get instant updates and stay connected with our community on WhatsApp.
        </p>

        <div className="space-y-4">
          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleJoin}
            className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-3 shadow-lg shadow-green-500/30 hover:shadow-green-500/40 hover:-translate-y-0.5"
          >
            <MessageCircle size={24} />
            Join us on WhatsApp
          </a>
          
          <button
            onClick={handleSkip}
            className="w-full text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200 font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            Skip for now <ArrowRight size={16} />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
