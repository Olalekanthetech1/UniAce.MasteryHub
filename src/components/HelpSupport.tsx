import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Search, ChevronDown, ChevronUp, Play, Send, CheckCircle2, MessageSquare, BookOpen, HelpCircle, Mail, User, Bot, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { SupportService, FaqItem, TutorialItem, DEFAULT_FAQS, DEFAULT_TUTORIALS } from '../services/supportConfig';

interface HelpSupportProps {
  onBack: () => void;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: any;
}

enum OperationType {
  GET = 'get',
  LIST = 'list',
  WRITE = 'write',
}

export default function HelpSupport({ onBack }: HelpSupportProps) {
  const { user } = useAuth();
  const [faqs, setFaqs] = useState<FaqItem[]>(DEFAULT_FAQS);
  const [tutorials, setTutorials] = useState<TutorialItem[]>(DEFAULT_TUTORIALS);
  const [searchQuery, setSearchQuery] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [formStatus, setFormStatus] = useState<'idle' | 'sending' | 'success'>('idle');
  const [formData, setFormData] = useState({ name: user?.displayName || '', email: user?.email || '', subject: '', message: '' });

  useEffect(() => {
    const unsubscribe = SupportService.subscribeSupportConfig((config) => {
      if (config.faqs && config.faqs.length > 0) {
        setFaqs(config.faqs);
      }
      if (config.tutorials && config.tutorials.length > 0) {
        setTutorials(config.tutorials);
      }
    });
    return () => unsubscribe();
  }, []);

  const filteredFaqs = faqs.filter(faq => 
    faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Chat State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);

  const scrollCarousel = (direction: 'left' | 'right') => {
    if (carouselRef.current) {
      const scrollAmount = 340; // Card width + gap
      carouselRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const handleFirestoreError = (error: any, operationType: OperationType, path: string) => {
    const errInfo = {
      error: error.message || String(error),
      operationType,
      path,
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
      }
    };
    console.error('Firestore Error:', JSON.stringify(errInfo));
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Poll for chat messages from Neon PostgreSQL
  useEffect(() => {
    if (!user || !isChatOpen) return;

    const cid = `chat_${user.uid}`;
    setChatId(cid);

    let active = true;
    const fetchMessages = async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/support/chats/${encodeURIComponent(cid)}/messages`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok && active) {
          const data = await res.json();
          setChatMessages(Array.isArray(data.messages) ? data.messages : []);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, `support_chats/${cid}/messages`);
      }
    };

    void fetchMessages();
    const timer = setInterval(fetchMessages, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user, isChatOpen]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newMessage.trim() || !chatId) return;

    const msg = newMessage;
    setNewMessage('');

    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/support/chats/${encodeURIComponent(chatId)}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          text: msg,
          senderName: user.displayName || 'Student',
          userName: user.displayName || 'Student'
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.messages)) {
          setChatMessages(data.messages);
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    setFormStatus('sending');
    
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          subject: formData.subject,
          message: formData.message
        })
      });
      if (!res.ok) throw new Error('Failed to submit ticket');
      
      setFormStatus('success');
      setFormData({ ...formData, subject: '', message: '' });
      setTimeout(() => setFormStatus('idle'), 3000);
    } catch (error) {
      console.error('Error submitting ticket:', error);
      setFormStatus('idle');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-900 p-4 sm:p-6 lg:p-12 pb-24 lg:pb-12 transition-colors">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 lg:pl-4 xl:pl-0">
          <div className="space-y-2">
            <button 
              onClick={onBack}
              className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium transition-colors mb-4"
            >
              <ArrowLeft size={20} />
              <span>Back to Profile</span>
            </button>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">Help & Support</h1>
            <p className="text-slate-500 dark:text-slate-400">Everything you need to master your learning journey.</p>
          </div>
          
          <div className="relative w-full md:w-72">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text"
              placeholder="Search help articles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all dark:text-white"
            />
          </div>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { icon: HelpCircle, label: "FAQs", color: "bg-blue-500", count: faqs.length },
            { icon: Play, label: "Tutorials", color: "bg-purple-500", count: tutorials.length },
            { icon: MessageSquare, label: "Live Chat", color: "bg-emerald-500", count: "24/7", onClick: () => setIsChatOpen(true) }
          ].map((link, i) => (
            <button 
              key={i} 
              onClick={link.onClick}
              className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-sm flex items-center gap-4 hover:shadow-md transition-all text-left"
            >
              <div className={`${link.color} p-3 rounded-2xl text-white shadow-lg shadow-${link.color.split('-')[1]}-500/20`}>
                <link.icon size={24} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white">{link.label}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{link.count} items available</p>
              </div>
            </button>
          ))}
        </div>

        {/* FAQs Section */}
        <section className="space-y-6">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <div className="w-2 h-8 bg-blue-500 rounded-full" />
            Frequently Asked Questions
          </h2>
          <div className="space-y-3">
            {filteredFaqs.map((faq, index) => (
              <div 
                key={index}
                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden"
              >
                <button 
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <span className="font-bold text-slate-900 dark:text-white">{faq.question}</span>
                  {openFaq === index ? <ChevronUp className="text-slate-400" /> : <ChevronDown className="text-slate-400" />}
                </button>
                <AnimatePresence>
                  {openFaq === index && (
                    <motion.div 
                       initial={{ height: 0, opacity: 0 }}
                       animate={{ height: 'auto', opacity: 1 }}
                       exit={{ height: 0, opacity: 0 }}
                       className="px-6 pb-4 text-slate-600 dark:text-slate-400 text-sm leading-relaxed"
                    >
                      {faq.answer}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </section>

        {/* Tutorials Section */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <div className="w-2 h-8 bg-purple-500 rounded-full" />
              Video Tutorials
            </h2>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => scrollCarousel('left')}
                className="p-2 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
              >
                <ChevronLeft size={20} />
              </button>
              <button 
                onClick={() => scrollCarousel('right')}
                className="p-2 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
          <div 
            ref={carouselRef}
            className="flex gap-6 overflow-x-auto snap-x snap-mandatory pb-6 -mb-6 no-scrollbar"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {tutorials.map((tutorial, i) => (
              <div 
                key={i} 
                className="min-w-[280px] md:min-w-[320px] max-w-[320px] flex-shrink-0 snap-start bg-white dark:bg-slate-800 rounded-[2rem] overflow-hidden border border-slate-100 dark:border-slate-700 shadow-sm group cursor-pointer"
              >
                <div className="relative aspect-video">
                  <img src={tutorial.thumbnail} alt={tutorial.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                    <div className="bg-white/90 p-3 rounded-full text-purple-600 scale-90 group-hover:scale-100 transition-transform">
                      <Play size={20} fill="currentColor" />
                    </div>
                  </div>
                  <div className="absolute bottom-3 right-3 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded-md backdrop-blur-md">
                    {tutorial.duration}
                  </div>
                </div>
                <div className="p-5 space-y-2">
                  <h3 className="font-bold text-slate-900 dark:text-white leading-tight">{tutorial.title}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{tutorial.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Contact Form Section */}
        <section className="space-y-6">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <div className="w-2 h-8 bg-emerald-500 rounded-full" />
            Still need help?
          </h2>
          <div className="bg-white dark:bg-slate-800 rounded-[3rem] p-8 md:p-12 border border-slate-100 dark:border-slate-700 shadow-sm">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div className="space-y-6">
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">Send us a message</h3>
                <p className="text-slate-500 dark:text-slate-400">Our support team typically responds within 2-4 hours. We're here to help you succeed!</p>
                
                <div className="space-y-4 pt-4">
                  {[
                    { icon: Mail, label: "Email Support", value: import.meta.env.VITE_SUPPORT_EMAIL || "support@example.com" },
                    { icon: MessageSquare, label: "Live Chat", value: "Available 9am - 6pm" }
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300">
                        <item.icon size={20} />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{item.label}</p>
                        <p className="font-bold text-slate-900 dark:text-white">{item.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider ml-1">Name</label>
                    <input 
                      required
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all dark:text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider ml-1">Email</label>
                    <input 
                      required
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all dark:text-white"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider ml-1">Subject</label>
                  <input 
                    required
                    type="text"
                    value={formData.subject}
                    onChange={(e) => setFormData({...formData, subject: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider ml-1">Message</label>
                  <textarea 
                    required
                    rows={4}
                    value={formData.message}
                    onChange={(e) => setFormData({...formData, message: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all dark:text-white resize-none"
                  />
                </div>
                <button 
                  disabled={formStatus !== 'idle'}
                  className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all ${
                    formStatus === 'success' 
                      ? 'bg-emerald-500 text-white' 
                      : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:scale-[1.02] active:scale-95'
                  }`}
                >
                  {formStatus === 'idle' && <><Send size={18} /> Send Message</>}
                  {formStatus === 'sending' && <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {formStatus === 'success' && <><CheckCircle2 size={18} /> Message Sent!</>}
                </button>
              </form>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center py-12 border-t border-slate-200 dark:border-slate-800">
          <p className="text-slate-500 dark:text-slate-400 text-sm">© 2026 UniAce Mastery Hub. All rights reserved.</p>
        </div>
      </div>

      {/* Live Chat Modal */}
      <AnimatePresence>
        {isChatOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-end p-6 pointer-events-none">
            <motion.div 
              initial={{ opacity: 0, y: 100, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 100, scale: 0.9 }}
              className="w-full max-w-md h-[600px] bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-700 flex flex-col pointer-events-auto overflow-hidden"
            >
              {/* Chat Header */}
              <div className="bg-slate-900 p-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center text-white">
                    <MessageSquare size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">Support Chat</h3>
                    <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest">Online</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsChatOpen(false)}
                  className="p-2 hover:bg-white/10 rounded-xl text-white/60 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Chat Messages */}
              <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50 dark:bg-slate-900/50"
              >
                {chatMessages.length === 0 && (
                  <div className="text-center py-12 space-y-4">
                    <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-slate-400 mx-auto">
                      <Bot size={32} />
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">Hello! How can we help you today?</p>
                  </div>
                )}
                {chatMessages.map((msg) => (
                  <div 
                    key={msg.id}
                    className={`flex ${msg.senderId === user?.uid ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[80%] p-4 rounded-2xl text-sm ${
                      msg.senderId === user?.uid 
                        ? 'bg-slate-900 text-white rounded-tr-none' 
                        : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-100 dark:border-slate-700 rounded-tl-none'
                    }`}>
                      <p className="font-bold text-[10px] mb-1 opacity-60">{msg.senderName}</p>
                      <p>{msg.text}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Chat Input */}
              <form onSubmit={handleSendMessage} className="p-4 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700">
                <div className="flex gap-2">
                  <input 
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type your message..."
                    className="flex-1 px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all dark:text-white"
                  />
                  <button 
                    type="submit"
                    className="p-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20"
                  >
                    <Send size={20} />
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
