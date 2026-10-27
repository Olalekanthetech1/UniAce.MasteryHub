import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Edit2, BarChart2, ChevronRight, Mail, User, BookMarked, Moon, Sun, HelpCircle, Star, LogOut, ShieldCheck, Zap, FileText, BookOpen, Settings, CreditCard, Clock, CheckCircle2, Camera, Upload, Loader2, Gift, Copy, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUserProgress } from '../hooks/useUserProgress';
import { useTheme } from '../context/ThemeContext';
import { View, Department, Level, Semester } from '../types';
import { useFeatureSwitches } from '../hooks/useFeatureSwitches';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { motion, AnimatePresence } from 'motion/react';
import { safeFetchJson } from '../utils/safeFetch';

interface PaymentRecord {
  id: string;
  amount: number;
  plan_type: string;
  reference: string;
  status: string;
  createdAt?: string;
  timestamp?: any;
  sparks_added: number;
}

interface UserProfileProps {
  onBack: () => void;
  onNavigate: (view: View) => void;
}

const LEVELS: Level[] = ['100', '200', '300', '400', '500'];
const SEMESTERS: Semester[] = ['1st Semester', '2nd Semester'];

import { useInstitution } from '../context/InstitutionContext';

export default function UserProfile({ onBack, onNavigate }: UserProfileProps) {
  const { departments: DEPARTMENTS } = useInstitution();
  const { user, logout, profile, updateProfileData } = useAuth();
  const { switches } = useFeatureSwitches();
  const { progress } = useUserProgress();
  const { theme, toggleTheme } = useTheme();
  const isDarkMode = theme === 'dark';

  const isAdmin = Boolean(user && profile?.role === 'admin');
  const isTutor = profile?.role === 'tutor' || isAdmin;

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const currentAvatar = profile?.photoURL || user?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.uid || 'User'}`;
  const [selectedAvatar, setSelectedAvatar] = useState(currentAvatar);
  const [selectedTheme, setSelectedTheme] = useState(profile?.themeColor || 'blue');
  const [displayName, setDisplayName] = useState(profile?.displayName || user?.displayName || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [department, setDepartment] = useState<Department | ''>((profile?.department as Department) || '');
  const [academicLevel, setAcademicLevel] = useState<Level | ''>((profile?.academic_level as Level) || '');
  const [semester, setSemester] = useState<Semester | ''>((profile?.semester as Semester) || '');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const themes = [
    { id: 'blue', name: 'Blue', color: 'bg-blue-500', lightColor: 'bg-blue-100', text: 'text-blue-600' },
    { id: 'emerald', name: 'Emerald', color: 'bg-emerald-500', lightColor: 'bg-emerald-100', text: 'text-emerald-600' },
    { id: 'purple', name: 'Purple', color: 'bg-purple-500', lightColor: 'bg-purple-100', text: 'text-purple-600' },
    { id: 'rose', name: 'Rose', color: 'bg-rose-500', lightColor: 'bg-rose-100', text: 'text-rose-600' },
    { id: 'amber', name: 'Amber', color: 'bg-amber-500', lightColor: 'bg-amber-100', text: 'text-amber-600' },
  ];

  const activeTheme = themes.find(t => t.id === (profile?.themeColor || 'blue')) || themes[0];

  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [isLoadingPayments, setIsLoadingPayments] = useState(false);

  useEffect(() => {
    const fetchPayments = async () => {
      if (!user?.uid) return;

      setIsLoadingPayments(true);
      try {
        const token = await user.getIdToken();
        const result = await safeFetchJson<{ payments?: PaymentRecord[] }>('/api/user/payments', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (result.ok && result.data) {
          setPayments(Array.isArray(result.data.payments) ? result.data.payments : []);
        }
      } catch (error: any) {
        console.warn("Could not fetch payments:", error);
      } finally {
        setIsLoadingPayments(false);
      }
    };

    fetchPayments();
  }, [user?.uid]);

  const avatars = [
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.uid || 'User'}`,
    `https://api.dicebear.com/7.x/avataaars/svg?seed=Felix`,
    `https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka`,
    `https://api.dicebear.com/7.x/avataaars/svg?seed=Mimi`,
    `https://api.dicebear.com/7.x/bottts/svg?seed=Robot1`,
    `https://api.dicebear.com/7.x/bottts/svg?seed=Robot2`,
    `https://api.dicebear.com/7.x/micah/svg?seed=Micah1`,
    `https://api.dicebear.com/7.x/micah/svg?seed=Micah2`,
  ];

  const handleSaveProfile = async () => {
    if (updateProfileData) {
      await updateProfileData({ 
        photoURL: selectedAvatar, 
        themeColor: selectedTheme,
        displayName: displayName || 'Scholar',
        bio: bio,
        department: department as Department,
        academic_level: academicLevel as Level,
        semester: semester as Semester
      });
    }
    setIsEditingProfile(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.uid) return;

    // Basic validation
    if (file.size > 5 * 1024 * 1024) {
      alert("Image size should be less than 5MB");
      return;
    }

    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 250;
          const MAX_HEIGHT = 250;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            // Compress to JPEG with 0.8 quality
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            setSelectedAvatar(dataUrl);
            setIsUploading(false);
          } else {
            throw new Error("Could not get canvas context");
          }
        };
        img.onerror = () => {
          alert("Failed to read image file.");
          setIsUploading(false);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Error processing image:", error);
      alert("Failed to process image. Please try again.");
      setIsUploading(false);
    }
  };

  const menuItems = [
    {
      icon: BarChart2,
      label: 'Performance Analysis',
      color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
      onClick: () => onNavigate('mastery')
    },
    {
      icon: BookMarked,
      label: 'Bookmarks',
      color: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
      onClick: () => onNavigate('notebook')
    },
    {
      icon: isDarkMode ? Sun : Moon,
      label: 'Device Appearance',
      color: 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
      onClick: toggleTheme,
      value: isDarkMode ? 'Dark Mode' : 'Light Mode'
    },
    {
      icon: HelpCircle,
      label: 'Help and Support',
      color: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
      onClick: () => onNavigate('help-support')
    },
    ...(isAdmin ? [
      {
        icon: ShieldCheck,
        label: 'Support Dashboard',
        color: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400',
        onClick: () => onNavigate('admin-support')
      },
      {
        icon: Settings,
        label: 'Admin Dashboard',
        color: 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
        onClick: () => onNavigate('admin-dashboard')
      }
    ] : []),
    {
      icon: Star,
      label: 'Rate App',
      color: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
      onClick: () => alert('Thank you for rating us 5 stars!')
    }
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-900 p-4 sm:p-6 lg:p-12 pb-24 lg:pb-12 transition-colors">
      <div className="w-full max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between lg:pl-4 xl:pl-0">
          <button 
            onClick={onBack}
            className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="text-lg">Home</span>
          </button>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Account</h1>
          <div className="w-10" /> {/* Spacer for centering */}
        </div>

        {/* Profile Card */}
        {!isEditingProfile ? (
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 flex items-center justify-between shadow-sm border border-slate-100 dark:border-slate-700">
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-full overflow-hidden border-2 border-white dark:border-slate-600 shadow-md ${activeTheme.lightColor}`}>
                <img 
                  src={currentAvatar} 
                  alt="Profile" 
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">{profile?.displayName || user?.displayName || 'Scholar'}</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm">{user?.email || 'No email linked'}</p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                    <Zap size={12} />
                    {progress.streak} Day Streak
                  </span>
                  {profile?.department && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                      {profile.department}
                    </span>
                  )}
                  {profile?.academic_level && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                      {profile.academic_level}L
                    </span>
                  )}
                  {profile?.semester && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                      {profile.semester}
                    </span>
                  )}
                </div>
                {profile?.bio && (
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 italic line-clamp-2">
                    "{profile.bio}"
                  </p>
                )}
              </div>
            </div>
            <button 
              onClick={() => {
                setSelectedAvatar(currentAvatar);
                setSelectedTheme(profile?.themeColor || 'blue');
                setIsEditingProfile(true);
              }}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              <Edit2 size={20} />
            </button>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-sm border border-slate-100 dark:border-slate-700 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Customize Profile</h3>
              <div className="flex gap-2">
                <button 
                  onClick={() => setIsEditingProfile(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSaveProfile}
                  className={`px-4 py-2 text-sm font-bold text-white ${activeTheme.color} rounded-xl shadow-sm hover:opacity-90 transition-opacity`}
                >
                  Save Changes
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Display Name</label>
                <input 
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Bio</label>
                <textarea 
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell us about yourself..."
                  rows={3}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Department</label>
                <select
                  value={department || ''}
                  onChange={(e) => setDepartment(e.target.value as Department)}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                >
                  <option value="" disabled>Select Department</option>
                  {DEPARTMENTS.map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Level</label>
                  <select
                    value={academicLevel || ''}
                    onChange={(e) => setAcademicLevel(e.target.value as Level)}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  >
                    <option value="" disabled>Select Level</option>
                    {LEVELS.map(level => (
                      <option key={level} value={level}>{level}L</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Semester</label>
                  <select
                    value={semester || ''}
                    onChange={(e) => setSemester(e.target.value as Semester)}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  >
                    <option value="" disabled>Select Semester</option>
                    {SEMESTERS.map(sem => (
                      <option key={sem} value={sem}>{sem}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Choose Avatar</p>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                >
                  {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Upload Custom
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageUpload} 
                  accept="image/*" 
                  className="hidden" 
                />
              </div>
              <div className="grid grid-cols-4 gap-3">
                {avatars.map((avatar, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedAvatar(avatar)}
                    className={`aspect-square rounded-2xl overflow-hidden border-2 transition-all ${
                      selectedAvatar === avatar 
                        ? `border-${activeTheme.id}-500 shadow-md scale-105` 
                        : 'border-transparent hover:border-slate-200 dark:hover:border-slate-600'
                    } ${activeTheme.lightColor}`}
                  >
                    <img src={avatar} alt={`Avatar ${idx + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Theme Color</p>
              <div className="flex gap-3">
                {themes.map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => setSelectedTheme(theme.id)}
                    className={`w-10 h-10 rounded-full ${theme.color} flex items-center justify-center transition-transform ${
                      selectedTheme === theme.id ? 'scale-110 ring-4 ring-offset-2 ring-offset-white dark:ring-offset-slate-800 ring-' + theme.id + '-500' : 'hover:scale-105'
                    }`}
                    title={theme.name}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Subscription Card */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-sm border border-slate-100 dark:border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Subscription</h3>
            <button 
              onClick={() => onNavigate('pricing')}
              className={`text-sm font-bold ${activeTheme.text} hover:opacity-80`}
            >
              Manage
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-2xl">
              <p className="text-xs text-slate-500 dark:text-slate-400">Status</p>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-900 dark:text-white capitalize">
                  {isAdmin ? 'Admin' : (profile?.plan_type || 'Free')}
                </p>
                {!isAdmin && profile?.subscription_status && profile.subscription_status !== 'none' && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                    profile.subscription_status === 'active' 
                      ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' 
                      : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                  }`}>
                    {profile.subscription_status}
                  </span>
                )}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-2xl">
              <p className="text-xs text-slate-500 dark:text-slate-400">AI Sparks</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{isAdmin ? 'Unlimited' : (profile?.ai_sparks || 0)}</p>
            </div>
            {profile?.subscription_start_date && (
              <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-2xl">
                <p className="text-xs text-slate-500 dark:text-slate-400">Started On</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {new Date(profile.subscription_start_date).toLocaleDateString(undefined, { 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                  })}
                </p>
              </div>
            )}
            {profile?.subscription_expiry && (
              <div className={`${profile?.subscription_start_date ? '' : 'col-span-2'} bg-slate-50 dark:bg-slate-700/50 p-4 rounded-2xl`}>
                <p className="text-xs text-slate-500 dark:text-slate-400">Expires On</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {new Date(profile.subscription_expiry).toLocaleDateString(undefined, { 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                  })}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Refer & Earn Card */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-sm border border-slate-100 dark:border-slate-700 relative overflow-hidden group">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-indigo-50 dark:bg-indigo-900/20 rounded-full blur-3xl group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/30 transition-colors" />
          
          <div className="flex items-center justify-between mb-4 relative z-10">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/40 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Gift size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Refer & Earn</h3>
                <p className="text-xs text-slate-500 font-medium">Get 50 AI Sparks for every friend</p>
              </div>
            </div>
            {profile?.referral_count !== undefined && (
              <div className="text-right">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Friends Joined</div>
                <div className="text-xl font-bold text-indigo-600 dark:text-indigo-400">{profile.referral_count || 0}</div>
              </div>
            )}
          </div>

          <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 relative z-10 leading-relaxed">
            Invite your friends to UniAce. When they join using your code, <span className="font-bold text-indigo-600 dark:text-indigo-400">you both get 50 AI Sparks</span> instantly!
          </p>

          <div className="space-y-4 relative z-10">
            <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/50">
              <div className="flex-1 overflow-hidden">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Your Referral Link</p>
                <p className="font-mono text-sm font-semibold text-slate-700 dark:text-slate-200 truncate select-all">
                  {window.location.origin}?ref={profile?.referralCode}
                </p>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}?ref=${profile?.referralCode}`);
                  alert('Referral link copied to clipboard!');
                }}
                className="p-3 bg-white dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 transition-all active:scale-95"
                title="Copy Link"
              >
                <Copy size={18} />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const text = `Hey! Join me on UniAce to ace your exams with AI. Use my link to get 50 free AI Sparks: ${window.location.origin}?ref=${profile?.referralCode}`;
                  window.open(`https://wa.send?text=${encodeURIComponent(text)}`, '_blank');
                }}
                className="flex-1 py-3 px-4 bg-[#25D366] hover:bg-[#22c35e] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-transform active:scale-95 shadow-sm"
              >
                <div className="w-5 h-5 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                </div>
                WhatsApp
              </button>
              <button
                onClick={() => {
                  const text = `Ace your exams with AI on UniAce! Use my link to get 50 free AI Sparks: ${window.location.origin}?ref=${profile?.referralCode} #UniAce #StudyAI`;
                  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
                }}
                className="flex-1 py-3 px-4 bg-slate-900 dark:bg-slate-700 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-transform active:scale-95 shadow-sm"
              >
                <div className="w-5 h-5 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </div>
                Twitter
              </button>
            </div>

            {isTutor && (
              <button
                onClick={() => onNavigate('tutor-dashboard')}
                className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-700 text-white rounded-2xl font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-3 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/30 group/btn transition-all hover:scale-[1.02] active:scale-95"
              >
                <TrendingUp size={20} className="group-hover/btn:translate-x-1 group-hover/btn:-translate-y-1 transition-transform" />
                Switch to Tutor Dashboard
              </button>
            )}
          </div>
        </div>

        {/* Payment History */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-sm border border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={20} className={activeTheme.text} />
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Payment History</h3>
          </div>
          
          <div className="space-y-3">
            {isLoadingPayments ? (
              <div className="flex justify-center py-4">
                <div className={`w-6 h-6 border-2 ${activeTheme.color} border-t-transparent rounded-full animate-spin`} />
              </div>
            ) : payments.length > 0 ? (
              payments.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-2xl border border-slate-100 dark:border-slate-600/50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center">
                      <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white capitalize">
                        {payment.plan_type.replace('_', ' ')}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        {(payment.createdAt ? new Date(payment.createdAt) : payment.timestamp?.toDate?.() || new Date()).toLocaleDateString()} • Ref: {(payment.reference || '').slice(-6)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">₦{payment.amount.toLocaleString()}</p>
                    <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">+{payment.sparks_added} Sparks</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CreditCard size={24} className="text-slate-400" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">No transactions yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Quick Access (Mobile Only) */}
        <div className="lg:hidden space-y-4">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white px-2">Quick Access</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Syllabus', icon: BookMarked, color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400', view: 'course-syllabus' },
              { label: 'Mastery', icon: BarChart2, color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400', view: 'mastery' },
              { label: 'Formulas', icon: HelpCircle, color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400', view: 'formulas' },
              { label: 'Quizzes', icon: Star, color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400', view: 'quizzes' },
              { label: 'Flashcards', icon: Zap, color: 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400', view: 'flashcards' },
              { label: 'Skill & CBT', icon: FileText, color: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400', view: 'past-questions' },
              { label: 'Notebook', icon: BookOpen, color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400', view: 'notebook' },
              ...(isAdmin ? [{ label: 'Admin Dashboard', icon: Settings, color: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400', view: 'admin-dashboard' }] : []),
              ...(!isAdmin && isTutor && switches.tutor_dashboard ? [{ label: 'Tutor Dashboard', icon: Settings, color: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400', view: 'tutor-dashboard' }] : []),
            ].map((item, idx) => (
              <button
                key={idx}
                onClick={() => onNavigate(item.view as View)}
                className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm flex flex-col items-center gap-3 hover:shadow-md transition-all active:scale-95"
              >
                <div className={`p-3 rounded-xl ${item.color} dark:bg-opacity-10`}>
                  <item.icon size={24} />
                </div>
                <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm">{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Menu Items */}
        <div className="space-y-4">
          {menuItems.map((item, index) => (
            <button 
              key={index}
              onClick={item.onClick}
              className="w-full bg-white dark:bg-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md hover:border-slate-200 dark:hover:border-slate-600 transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform ${item.color} dark:bg-opacity-10`}>
                  <item.icon size={24} />
                </div>
                <div className="text-left">
                  <span className="block text-lg font-semibold text-slate-900 dark:text-white">{item.label}</span>
                  {item.value && <span className="text-xs text-slate-500 dark:text-slate-400">{item.value}</span>}
                </div>
              </div>
              <ChevronRight size={20} className="text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 group-hover:translate-x-1 transition-all" />
            </button>
          ))}

          <button 
            onClick={logout}
            className="w-full bg-red-50 dark:bg-red-900/10 p-4 rounded-2xl flex items-center justify-between border border-red-100 dark:border-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/20 transition-all group mt-8"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400 group-hover:scale-110 transition-transform">
                <LogOut size={24} />
              </div>
              <span className="text-lg font-semibold text-red-600 dark:text-red-400">Log Out</span>
            </div>
            <ChevronRight size={20} className="text-red-400 group-hover:translate-x-1 transition-all" />
          </button>
        </div>
      </div>
    </div>
  );
}
