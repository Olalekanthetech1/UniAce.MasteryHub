import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, MessageSquare, Ticket, CheckCircle2, Clock, User, Send, Search, Filter, MessageCircle, Bell, Megaphone, Sparkles, AlertTriangle, X, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth } from '../firebase';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

enum OperationType {
  GET = 'get',
  LIST = 'list',
  WRITE = 'write',
}

interface AdminSupportProps {
  onBack: () => void;
}

interface SupportTicket {
  id: string;
  userId: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: 'open' | 'resolved';
  createdAt: any;
}

interface SupportChat {
  id: string;
  userId: string;
  userName: string;
  status: 'active' | 'closed';
  lastMessage: string;
  updatedAt: any;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: any;
}

export default function AdminSupport({ onBack }: AdminSupportProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'tickets' | 'chats' | 'notifications' | 'spark-adjustment'>('tickets');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [chats, setChats] = useState<SupportChat[]>([]);
  const [selectedChat, setSelectedChat] = useState<SupportChat | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifWhatsappLink, setNotifWhatsappLink] = useState('');
  const [notifType, setNotifType] = useState<'info' | 'success' | 'warning' | 'error'>('info');
  const [isSendingNotif, setIsSendingNotif] = useState(false);
  
  // Spark adjustment state
  const [sparkEmail, setSparkEmail] = useState('');
  const [sparkAmount, setSparkAmount] = useState(0);
  const [isAdjustingSparks, setIsAdjustingSparks] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleAdjustSparks = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sparkEmail.trim() || sparkAmount === 0) return;

    setIsAdjustingSparks(true);
    try {
      const response = await fetch('/api/admin/adjust-sparks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await user?.getIdToken()}`
        },
        body: JSON.stringify({ email: sparkEmail, amount: sparkAmount })
      });

      if (!response.ok) throw new Error('Failed to adjust sparks');
      
      alert('Sparks adjusted successfully!');
      setSparkEmail('');
      setSparkAmount(0);
    } catch (error) {
      console.error('Error adjusting sparks:', error);
      alert('Error adjusting sparks. Please check the email and try again.');
    } finally {
      setIsAdjustingSparks(false);
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

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    const titleClean = notifTitle.trim();
    const messageClean = notifMessage.trim();
    const ctaUrlClean = notifWhatsappLink.trim();

    if (titleClean.length < 2) {
      toast.error("Title must be at least 2 characters.");
      return;
    }
    if (messageClean.length < 5) {
      toast.error("Message content must be at least 5 characters.");
      return;
    }
    if (ctaUrlClean && !/^https?:\/\//i.test(ctaUrlClean)) {
      toast.error("CTA Link must begin with http:// or https://");
      return;
    }

    setIsSendingNotif(true);
    try {
      const idToken = await user?.getIdToken();
      const bRes = await fetch('/api/admin/support/broadcast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({
          title: titleClean,
          message: messageClean,
          ctaUrl: ctaUrlClean || null,
          type: notifType
        })
      });
      if (!bRes.ok) throw new Error('Failed to publish broadcast');

      // Backend push broadcasts
      try {
        fetch('/api/admin/broadcast-push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            title: titleClean,
            message: messageClean,
            type: notifType
          })
        }).catch(e => console.error('Push error:', e));
      } catch (error) {
        console.error('Error sending backend broadcasts:', error);
      }

      toast.success("Broadcast published as a dynamic global announcement!");
      setNotifTitle('');
      setNotifMessage('');
      setNotifWhatsappLink('');
    } catch (error) {
      console.error('Error sending broadcast:', error);
      toast.error("Failed to send broadcast");
    } finally {
      setIsSendingNotif(false);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const fetchSupportOverview = async () => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/support/overview', {
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        setTickets(Array.isArray(data.tickets) ? data.tickets : []);
        setChats(Array.isArray(data.chats) ? data.chats : []);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'admin_support_overview');
    }
  };

  useEffect(() => {
    void fetchSupportOverview();
    const timer = setInterval(fetchSupportOverview, 6000);
    return () => clearInterval(timer);
  }, []);

  // Poll messages in selected chat
  useEffect(() => {
    if (!selectedChat) return;
    let active = true;
    const fetchChatMessages = async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        const res = await fetch(`/api/support/chats/${encodeURIComponent(selectedChat.id)}/messages`, {
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {}
        });
        if (res.ok && active) {
          const data = await res.json();
          setChatMessages(Array.isArray(data.messages) ? data.messages : []);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, `support_chats/${selectedChat.id}/messages`);
      }
    };
    void fetchChatMessages();
    const timer = setInterval(fetchChatMessages, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedChat]);

  const handleResolveTicket = async (ticketId: string) => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      await fetch(`/api/admin/support/tickets/${encodeURIComponent(ticketId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({ status: 'resolved' })
      });
      await fetchSupportOverview();
    } catch (error) {
      console.error('Error resolving ticket:', error);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newMessage.trim() || !selectedChat) return;

    const msg = newMessage;
    setNewMessage('');

    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/support/chats/${encodeURIComponent(selectedChat.id)}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          text: msg,
          senderName: 'Support Team',
          userName: selectedChat.userName || 'Student'
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

  return (
    <div className="flex-1 h-screen flex flex-col bg-slate-50 dark:bg-slate-900 transition-colors overflow-hidden">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-6 flex items-center justify-between shrink-0 lg:pl-6">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
          >
            <ArrowLeft size={20} className="text-slate-600 dark:text-slate-400" />
          </button>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white">Support Dashboard</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Manage user inquiries and live chats</p>
          </div>
        </div>

        <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-2xl">
          <button 
            onClick={() => setActiveTab('tickets')}
            className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${
              activeTab === 'tickets' 
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' 
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Tickets ({tickets.filter(t => t.status === 'open').length})
          </button>
          <button 
            onClick={() => setActiveTab('chats')}
            className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${
              activeTab === 'chats' 
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' 
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Live Chats ({chats.filter(c => c.status === 'active').length})
          </button>
          <button 
            onClick={() => setActiveTab('notifications')}
            className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${
              activeTab === 'notifications' 
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' 
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Broadcast
          </button>
          <button 
            onClick={() => setActiveTab('spark-adjustment')}
            className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${
              activeTab === 'spark-adjustment' 
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' 
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Sparks
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'spark-adjustment' ? (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-12 pb-24 lg:pb-12">
            <div className="max-w-2xl mx-auto space-y-8">
              <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-sm border border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-12 h-12 bg-amber-50 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center text-amber-600 dark:text-amber-400">
                    <Sparkles size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-slate-900 dark:text-white">Adjust AI Sparks</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Manually add or remove sparks for a user</p>
                  </div>
                </div>

                <form onSubmit={handleAdjustSparks} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">User Email</label>
                    <input 
                      type="email"
                      value={sparkEmail}
                      onChange={(e) => setSparkEmail(e.target.value)}
                      placeholder="user@example.com"
                      className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-amber-500 outline-none transition-all dark:text-white"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Amount (Use negative to subtract)</label>
                    <input 
                      type="number"
                      value={sparkAmount}
                      onChange={(e) => setSparkAmount(parseInt(e.target.value) || 0)}
                      className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-amber-500 outline-none transition-all dark:text-white"
                      required
                    />
                  </div>

                  <button 
                    type="submit"
                    disabled={isAdjustingSparks}
                    className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-bold hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-slate-900/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isAdjustingSparks ? 'Updating...' : (
                      <>
                        Update Sparks <Sparkles size={18} />
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Sidebar List */}
            <div className="w-full md:w-96 border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-y-auto">
              {activeTab === 'tickets' ? (
                <div className="p-4 space-y-4">
                  {tickets.map(ticket => (
                    <div 
                      key={ticket.id}
                      className={`p-4 rounded-2xl border transition-all ${
                        ticket.status === 'open' 
                          ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700' 
                          : 'bg-slate-50 dark:bg-slate-900/50 border-transparent opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${ticket.status === 'open' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{ticket.status}</span>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {ticket.createdAt?.toDate 
                            ? ticket.createdAt.toDate().toLocaleDateString() 
                            : new Date(ticket.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className="font-bold text-slate-900 dark:text-white mb-1">{ticket.subject}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 line-clamp-2">{ticket.message}</p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold">
                            {ticket.name[0]}
                          </div>
                          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{ticket.name}</span>
                        </div>
                        {ticket.status === 'open' && (
                          <button 
                            onClick={() => handleResolveTicket(ticket.id)}
                            className="p-2 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition-colors"
                            title="Mark as Resolved"
                          >
                            <CheckCircle2 size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 space-y-2">
                  {chats.map(chat => (
                    <button 
                      key={chat.id}
                      onClick={() => setSelectedChat(chat)}
                      className={`w-full p-4 rounded-2xl border transition-all text-left ${
                        selectedChat?.id === chat.id
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">{chat.userName}</span>
                        <span className="text-[10px] opacity-60">
                          {chat.updatedAt?.toDate 
                            ? chat.updatedAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
                            : new Date(chat.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className={`text-sm font-bold mb-1 ${selectedChat?.id === chat.id ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                        {chat.lastMessage}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Main Content / Chat Window */}
            <div className="flex-1 bg-slate-50 dark:bg-slate-900 flex flex-col overflow-hidden">
              {activeTab === 'notifications' ? (
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-12 pb-24 lg:pb-12">
                  <div className="max-w-2xl mx-auto space-y-8">
                    <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-sm border border-slate-100 dark:border-slate-700">
                      <div className="flex items-center gap-4 mb-8">
                        <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                          <Megaphone size={24} />
                        </div>
                        <div>
                          <h2 className="text-xl font-black text-slate-900 dark:text-white">Send Broadcast</h2>
                          <p className="text-sm text-slate-500 dark:text-slate-400">Send an in-app notification to all registered users</p>
                        </div>
                      </div>

                      <form onSubmit={handleSendBroadcast} className="space-y-6">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Notification Title</label>
                          <input 
                            type="text"
                            value={notifTitle}
                            onChange={(e) => setNotifTitle(e.target.value)}
                            placeholder="e.g. New Course Material Available!"
                            className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">WhatsApp Link (Option A)</label>
                          <input 
                            type="url"
                            value={notifWhatsappLink}
                            onChange={(e) => setNotifWhatsappLink(e.target.value)}
                            placeholder="e.g. https://wa.me/yournumber"
                            className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
                          />
                          <p className="text-[10px] text-slate-500">Students will see a "JOIN WHATSAPP" button in the notification banner.</p>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Message Content</label>
                          <textarea 
                            value={notifMessage}
                            onChange={(e) => setNotifMessage(e.target.value)}
                            placeholder="Describe the update in detail..."
                            rows={4}
                            className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white resize-none"
                            required
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Type</label>
                            <select 
                              value={notifType}
                              onChange={(e) => setNotifType(e.target.value as any)}
                              className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
                            >
                              <option value="info">Information (Blue)</option>
                              <option value="success">Success (Green)</option>
                              <option value="warning">Warning (Amber)</option>
                              <option value="error">Alert (Red)</option>
                            </select>
                          </div>
                          <div className="flex items-end">
                            <button 
                              type="submit"
                              disabled={isSendingNotif}
                              className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-bold hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-slate-900/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                              {isSendingNotif ? 'Sending...' : (
                                <>
                                  Send Notification <Send size={18} />
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </form>
                    </div>

                    {/* Preview Card */}
                    <div className="bg-slate-100 dark:bg-slate-900/50 p-6 rounded-[2rem] border border-dashed border-slate-300 dark:border-slate-700">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Live Preview</h3>
                      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex gap-3">
                        <div className="mt-1">
                          {notifType === 'success' ? <CheckCircle2 className="text-emerald-500" size={18} /> : 
                           notifType === 'warning' ? <AlertTriangle className="text-amber-500" size={18} /> :
                           notifType === 'error' ? <X className="text-red-500" size={18} /> :
                           <Info className="text-blue-500" size={18} />}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{notifTitle || 'Notification Title'}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{notifMessage || 'Your message will appear here...'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : activeTab === 'chats' && selectedChat ? (
                <>
                  {/* Chat Header */}
                  <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300">
                        <User size={20} />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 dark:text-white">{selectedChat.userName}</h3>
                        <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">Active Chat</p>
                      </div>
                    </div>
                  </div>

                  {/* Chat Messages */}
                  <div 
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto p-6 space-y-4"
                  >
                    {chatMessages.map((msg) => (
                      <div 
                        key={msg.id}
                        className={`flex ${msg.senderId === user?.uid ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className={`max-w-[70%] p-4 rounded-2xl text-sm ${
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
                  <form onSubmit={handleSendMessage} className="p-6 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex gap-3">
                      <input 
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Type your response..."
                        className="flex-1 px-6 py-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-slate-900 outline-none transition-all dark:text-white"
                      />
                      <button 
                        type="submit"
                        className="px-8 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-bold hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-slate-900/20"
                      >
                        <Send size={20} />
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center p-12 text-center">
                  <div className="max-w-sm space-y-4">
                    <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-[2rem] flex items-center justify-center text-slate-400 mx-auto">
                      {activeTab === 'tickets' ? <Ticket size={40} /> : <MessageCircle size={40} />}
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                      {activeTab === 'tickets' ? 'Select a ticket to view details' : 'Select a chat to start responding'}
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {activeTab === 'tickets' 
                        ? 'Tickets are formal inquiries sent via the contact form.' 
                        : 'Live chats allow real-time communication with active users.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
