import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Plus, CheckCircle, Loader2, BookOpen, AlertCircle, Settings, Trash2, Users, Activity, Database, Search, Zap, Trophy, Star, Bot, Shield, BarChart3, Globe, Edit2, RefreshCw, Clock, FileQuestion, MessageSquare, ArrowLeft, HeartPulse, X, ArrowRight, Layers, Key, Cpu, Share2, Download, Filter, Send, ChevronLeft, ChevronRight, Mic, Book, Terminal, Sparkles, TrendingUp, CreditCard, HelpCircle, Calculator, Video, Film, Landmark, ToggleRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';
import { useCourses } from '../context/CourseContext';
import { useAuth } from '../context/AuthContext';
import { db, storage, auth } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc, getDoc, collection, getDocs, deleteDoc, query, where, limit, writeBatch, serverTimestamp, orderBy, addDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import AdminQuestionBank from './AdminQuestionBank';
import { ApiDebuggerPage } from './ApiDebuggerPage';
import CourseEditModal from './CourseEditModal';
import CourseCreateModal from './CourseCreateModal';
import ApiKeyManagerModal from './ApiKeyManagerModal';
import { CurriculumManager } from './CurriculumManager';
import { MathEditableInput } from './MathEditableInput';
import PricingManagerTab from './admin/PricingManagerTab';
import ChallengesManagerTab from './admin/ChallengesManagerTab';
import SupportManagerTab from './admin/SupportManagerTab';
import FormulasManagerTab from './admin/FormulasManagerTab';
import MathEngineTab from './admin/MathEngineTab';
import AcademicMCPDashboard from './admin/AcademicMCPDashboard';
import DemoStudioTab from './admin/DemoStudioTab';
import GoldenSetTrustTab from './admin/GoldenSetTrustTab';
import DatabaseAccountingTab from './admin/DatabaseAccountingTab';
import DatabaseEngineTab from './admin/DatabaseEngineTab';
import FeatureSwitchesTab from './admin/FeatureSwitchesTab';
import { AIService } from '../services/ai';
import { generateCourseContent, generateCourseSkeleton, generateModuleContent, generateCourseFormulas } from '../services/aiCourseGenerator';
import { CourseService, sanitizeForFirestore } from '../services/courseService';
import { Course, UserProgress, CourseId, Department, Level, Semester, Subject, CourseScope } from '../types';
import { LEVELS, SEMESTERS } from '../constants';
import { LogService, SystemLog } from '../services/logService';
import { CurriculumIntegrityService } from '../services/curriculumIntegrity';
import { usePermissions } from '../hooks/usePermissions';
import { useInstitution } from '../context/InstitutionContext';
import AdminAffiliates from './AdminAffiliates';
import MarkdownRenderer from './MarkdownRenderer';

import { jsonrepair } from 'jsonrepair';

function parseFirestoreDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val.toDate === 'function') {
    try {
      return val.toDate();
    } catch (e) {}
  }
  if (typeof val.seconds === 'number') {
    return new Date(val.seconds * 1000);
  }
  if (typeof val._seconds === 'number') {
    return new Date(val._seconds * 1000);
  }
  if (val.seconds && typeof val.seconds.seconds === 'number') {
    return new Date(val.seconds.seconds * 1000);
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export default function AdminDashboard() {
  const { courses, refreshCourses } = useCourses();
  const [archivedCourses, setArchivedCourses] = useState<Record<string, Course>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [isLoadingArchived, setIsLoadingArchived] = useState(false);

  const fetchArchivedCourses = async () => {
    if (!db) return;
    setIsLoadingArchived(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'archived_courses'));
      const archived: Record<string, Course> = {};
      querySnapshot.forEach((doc) => {
        archived[doc.id] = doc.data() as Course;
      });
      setArchivedCourses(archived);
    } catch (error) {
      console.error("Error fetching archived courses:", error);
    } finally {
      setIsLoadingArchived(false);
    }
  };

  useEffect(() => {
    if (showArchived) {
      fetchArchivedCourses();
    }
  }, [showArchived]);
  const { user, profile } = useAuth();
  const permissions = usePermissions(profile);
  const { 
    isAdmin, 
    isTutor, 
    isModerator, 
    canManageCourses, 
    canUseAI, 
    canManageUsers, 
    canViewLogs, 
    canManageSystem, 
    canCommunicate, 
    canManageCurriculum,
    role: userRole
  } = permissions;

  const { departments, faculties, departmentToFaculty, addDepartment, removeDepartment } = useInstitution();

  const DEPARTMENTS = departments;
  const FACULTIES = faculties;
  const DEPARTMENT_TO_FACULTY = departmentToFaculty;

  // Add aliases for backward compatibility or specific checks if needed
  const canManageRAG = canManageCourses;
  const canManageCommunications = canCommunicate;
  const canManageAI = canUseAI;

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  
  // Phase 2: Knowledge Base Ingestion State
  const [kbContent, setKbContent] = useState('');
  const [kbCourseCode, setKbCourseCode] = useState('');
  const [kbModuleName, setKbModuleName] = useState('');
  const [kbTopicName, setKbTopicName] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestionStatus, setIngestionStatus] = useState('');
  const [kbStats, setKbStats] = useState({ totalChunks: 0 });
  const [activeTab, setActiveTab] = useState<'overview' | 'demo-studio' | 'courses' | 'users' | 'rag' | 'communications' | 'settings' | 'logs' | 'question-bank' | 'curriculum-health' | 'curriculum-manager' | 'curriculum-requests' | 'api-debugger' | 'affiliates' | 'analytics' | 'api-status' | 'pricing' | 'challenges' | 'support' | 'formulas' | 'math-engine' | 'academic-mcp' | 'golden-set' | 'db-accounting' | 'database-engine' | 'feature-switches'>('overview');

  useEffect(() => {
    // Redirect if current tab is not allowed for the role
    if (activeTab === 'logs' && !canViewLogs) setActiveTab('overview');
    if (activeTab === 'settings' && !canManageAI) setActiveTab('overview');
    if (activeTab === 'users' && !canManageUsers) setActiveTab('overview');
    if (activeTab === 'courses' && !canManageCourses) setActiveTab('overview');
    if (activeTab === 'rag' && !canManageRAG) setActiveTab('overview');
    if (activeTab === 'communications' && !canManageCommunications) setActiveTab('overview');
    if (activeTab === 'question-bank' && !canManageCourses) setActiveTab('overview');
    if (activeTab === 'curriculum-health' && !canManageCurriculum) setActiveTab('overview');
    if (activeTab === 'curriculum-manager' && !canManageCurriculum) setActiveTab('overview');
    if (activeTab === 'affiliates' && !canManageUsers) setActiveTab('overview');
    if (activeTab === 'db-accounting' && !canManageSystem) setActiveTab('overview');
    if (activeTab === 'database-engine' && !canManageSystem) setActiveTab('overview');
  }, [userRole, activeTab, canViewLogs, canManageAI, canManageUsers, canManageCourses, canManageRAG, canManageCommunications, canManageCurriculum, canManageSystem]);

  const [integrityIssues, setIntegrityIssues] = useState<any[]>([]);
  const [isLoadingIntegrity, setIsLoadingIntegrity] = useState(false);
  const [allCurriculums, setAllCurriculums] = useState<any[]>([]);
  const [selectedIssueCell, setSelectedIssueCell] = useState<{ dept: string, level: string } | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const [isRemediating, setIsRemediating] = useState(false);
  const [notificationText, setNotificationText] = useState('');
  const [whatsappLink, setWhatsappLink] = useState('');
  const [isSendingNotification, setIsSendingNotification] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailFromName, setEmailFromName] = useState('UniAce Team');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [struggleAnalytics, setStruggleAnalytics] = useState<any[]>([]);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [chatAnalytics, setChatAnalytics] = useState<{topTopics: any[], recentQueries: any[]}>({ topTopics: [], recentQueries: [] });
  const [isLoadingChatAnalytics, setIsLoadingChatAnalytics] = useState(false);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };
  const [systemStats, setSystemStats] = useState({
    totalSparksConsumed: 0,
    totalQuestionsAsked: 0,
    averageMastery: 0,
    popularCourse: 'N/A'
  });
  const [aiProviderStatus, setAiProviderStatus] = useState<Record<string, { active: boolean; totalKeys: number; exhaustedKeys: number; usingEnv: boolean; usingDb: boolean }>>({
    gemini_direct: { active: false, totalKeys: 0, exhaustedKeys: 0, usingEnv: false, usingDb: false },
    openrouter_free: { active: false, totalKeys: 0, exhaustedKeys: 0, usingEnv: false, usingDb: false },
    groq: { active: false, totalKeys: 0, exhaustedKeys: 0, usingEnv: false, usingDb: false },
    mistral_direct: { active: false, totalKeys: 0, exhaustedKeys: 0, usingEnv: false, usingDb: false },
    cohere: { active: false, totalKeys: 0, exhaustedKeys: 0, usingEnv: false, usingDb: false },
    huggingface: { active: false, totalKeys: 0, exhaustedKeys: 0, usingEnv: false, usingDb: false },
    nvidia: { active: false, totalKeys: 0, exhaustedKeys: 0, usingEnv: false, usingDb: false }
  });
  const [aiMetrics, setAiMetrics] = useState<any>({});
  const [aiChartData, setAiChartData] = useState<any[]>([]);
  const [pingResults, setPingResults] = useState<Record<string, {
    provider: string;
    status: 'online' | 'degraded' | 'offline';
    latencyMs: number | null;
    latencyFormatted: string;
    model?: string;
    textSample?: string;
    error?: string;
    timestamp?: number;
  }>>({});
  const [providerHealth, setProviderHealth] = useState<any>(null);
  const [isPingingAll, setIsPingingAll] = useState(false);
  const [pingingProvider, setPingingProvider] = useState<string | null>(null);
  const [autoPingEnabled, setAutoPingEnabled] = useState(false);
  const [routingConfig, setRoutingConfig] = useState({
    global_provider: '',
    chat: 'groq',
    quiz: 'groq',
    lesson: 'openrouter_free',
    skeleton: 'cohere',
    recommendation: 'cohere',
    formulas: 'cohere',
    flashcard: 'huggingface',
    rag: 'openrouter_free',
    vision: 'gemini_direct',
    past_questions: 'gemini_direct',
    voice_tutor: 'nvidia',
    voice_tutor_model: 'nemotron-voicechat',
    nvidia_text_model: 'nvidia/nemotron-3-super-120b-a12b',
    nvidia_image_model: 'black-forest-labs/flux.1-dev',
    default_personality: 'encouraging'
  });
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logFilter, setLogFilter] = useState<string>('all');
  const [logLevelFilter, setLogLevelFilter] = useState<string>('all');
  const [logSearchTerm, setLogSearchTerm] = useState('');
  const [isLiveLogs, setIsLiveLogs] = useState(true);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userCurrentPage, setUserCurrentPage] = useState(1);
  const usersPerPage = 10;
  
  // Advanced User Management Filters & Modals state
  const [userRoleFilter, setUserRoleFilter] = useState<string>('all');
  const [userDeptFilter, setUserDeptFilter] = useState<string>('all');
  const [userPlanFilter, setUserPlanFilter] = useState<string>('all');
  const [selectedUserForDetails, setSelectedUserForDetails] = useState<any | null>(null);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<any | null>(null);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);

  // Form states for manual user creation/editing
  const [userFormName, setUserFormName] = useState('');
  const [userFormEmail, setUserFormEmail] = useState('');
  const [userFormPassword, setUserFormPassword] = useState('');
  const [userFormRole, setUserFormRole] = useState<'student' | 'tutor' | 'moderator' | 'admin'>('student');
  const [userFormDepartment, setUserFormDepartment] = useState('');
  const [userFormAcademicLevel, setUserFormAcademicLevel] = useState('100');
  const [userFormPlanType, setUserFormPlanType] = useState('free');
  const [userFormSparks, setUserFormSparks] = useState(0);
  const [selectedLogDetails, setSelectedLogDetails] = useState<any>(null);
  const [logLimit, setLogLimit] = useState(100);
  const [logStats, setLogStats] = useState<{ date: string; count: number }[]>([]);
  const [logCounts, setLogCounts] = useState({ error: 0, warning: 0, info: 0, success: 0 });
  const [isCheckingAI, setIsCheckingAI] = useState(false);
  const [isLiveAIUpdate, setIsLiveAIUpdate] = useState(false);
  const [lastAiUpdate, setLastAiUpdate] = useState<Date | null>(null);
  const [isRoleGuideOpen, setIsRoleGuideOpen] = useState(false);
  const [isCreateCourseModalOpen, setIsCreateCourseModalOpen] = useState(false);
  const [activeCommTab, setActiveCommTab] = useState<'broadcast' | 'email' | 'settings' | 'history'>('broadcast');
  const [targetAudience, setTargetAudience] = useState<'all' | 'students' | 'tutors' | 'moderators' | 'department'>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [emailMode, setEmailMode] = useState<'custom' | 'welcome' | 'reminder'>('custom');
  const [commWelcomeTrialDays, setCommWelcomeTrialDays] = useState<number>(7);
  const [commStudentName, setCommStudentName] = useState<string>('');
  const [commDaysLeft, setCommDaysLeft] = useState<number>(1);
  const [selectedProviderForKeyManager, setSelectedProviderForKeyManager] = useState<string | null>(null);

  // New state for manual input and review
  const [courseCode, setCourseCode] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [extractedCourse, setExtractedCourse] = useState<Course | null>(null);
  const [rawJsonText, setRawJsonText] = useState('');
  const [isReviewing, setIsReviewing] = useState(false);
  const [overrideCourseId, setOverrideCourseId] = useState<string>('');
  const [isGeneratingQuick, setIsGeneratingQuick] = useState(false);
  const [isGeneratingSkeleton, setIsGeneratingSkeleton] = useState(false);
  const isCancelledRef = useRef(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationStep, setGenerationStep] = useState<'input' | 'skeleton' | 'generating' | 'error'>('input');
  const [courseSkeleton, setCourseSkeleton] = useState<{
    description?: string;
    modules: any[];
    domainBrief?: any;
    coverageScore?: number;
    confidenceState?: string;
    groundingReferences?: string[];
    learningOutcomes?: any[];
  } | null>(null);
  const [quickCourseName, setQuickCourseName] = useState('');
  const [quickCourseCode, setQuickCourseCode] = useState('');
  const [quickSubject, setQuickSubject] = useState<Subject>('Mathematics');
  const [quickLevel, setQuickLevel] = useState<Level>('100');
  const [quickSemester, setQuickSemester] = useState<Semester>('1st Semester');
  const [quickDepartment, setQuickDepartment] = useState<Department>('Mathematics');
  const [courseScope, setCourseScope] = useState<CourseScope>('DEPARTMENT');
  const [selectedFaculties, setSelectedFaculties] = useState<string[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<Department[]>(['Mathematics']);
  const [quickCourseOutline, setQuickCourseOutline] = useState('');
  const [quickTone, setQuickTone] = useState('academic');
  const [quickDepth, setQuickDepth] = useState('standard');
  const [quickAcademicStandard, setQuickAcademicStandard] = useState<string>('Globally Adaptive (Universal University Standard)');
  const [customAcademicStandard, setCustomAcademicStandard] = useState<string>('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [pdfProcessingProgress, setPdfProcessingProgress] = useState<number | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/pdfWorker.ts', import.meta.url), { type: 'module' });
    return () => {
      workerRef.current?.terminate();
    };
  }, []);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [aiProvider, setAiProvider] = useState<'gemini_direct' | 'openrouter_free' | 'mistral_direct' | 'groq' | 'cohere' | 'huggingface' | 'nvidia'>('gemini_direct');
  const [globalAiMode, setGlobalAiMode] = useState<'normal' | 'fast'>('normal');
  const [isUpdatingAiMode, setIsUpdatingAiMode] = useState(false);
  const [testKeyProvider, setTestKeyProvider] = useState<string>('gemini_direct');
  const [testKeyInput, setTestKeyInput] = useState('');
  const [testKeyResult, setTestKeyResult] = useState<any>(null);
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [routerTestTelemetry, setRouterTestTelemetry] = useState<{ loading: boolean; error?: string; data?: any } | null>(null);
  const [generationJobDetails, setGenerationJobDetails] = useState<{
    currentModule?: string;
    currentLesson?: string;
    completedLessons?: number;
    totalLessons?: number;
    activeProvider?: string;
    elapsedSeconds?: number;
  }>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [systemConfig, setSystemConfig] = useState({
    aiKillswitch: false,
    strictAcademicFilter: true,
    autoFallback: true,
    trialDays: 7
  });

  const [systemHealth, setSystemHealth] = useState<any>(null);
  const [isHealthProbing, setIsHealthProbing] = useState<boolean>(false);
  const [broadcastHistory, setBroadcastHistory] = useState<any[]>([]);
  const [isLoadingBroadcastHistory, setIsLoadingBroadcastHistory] = useState<boolean>(false);
  const [remediatingId, setRemediatingId] = useState<string | null>(null);
  const [systemAlerts, setSystemAlerts] = useState<any[]>([]);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState<boolean>(false);
  const [isResettingPassword, setIsResettingPassword] = useState<boolean>(false);
  const [isPruningLogs, setIsPruningLogs] = useState<boolean>(false);

  useEffect(() => {
    if (user) {
      fetchUsers();
      fetchCurriculumRequests();
      fetchKbStats();
      fetchSystemStats();
      checkAIStatus();
      fetchStruggleAnalytics();
      fetchChatAnalytics();
      fetchSystemConfig();
      fetchRoutingConfig();
      fetchCommunityConfig();
      fetchAiMode();
      fetchLogs();
      fetchIntegrityData();
      fetchSystemHealth();
      fetchBroadcastHistory();
      fetchSystemAlerts();

      // Check for active background course generation jobs to resume real-time tracking across reloads
      const checkActiveGeneration = async () => {
        try {
          const q = query(collection(db, 'courses'), where('generationStatus', '==', 'generating'));
          const snap = await getDocs(q);
          if (!snap.empty) {
            const activeCourseDoc = snap.docs[0];
            const activeData = activeCourseDoc.data();
            const activeCourseId = activeCourseDoc.id;
            console.log(`[Admin] Resuming active course generation tracking: ${activeCourseId}`);
            setQuickCourseCode(activeCourseId);
            setQuickCourseName(activeData.title || activeCourseId);
            setIsGeneratingQuick(true);
            setGenerationStep('generating');
            if (activeData.generationProgress) setGenerationProgress(activeData.generationProgress);
            if (activeData.statusMessage) setStatusMessage(activeData.statusMessage);
            setGenerationJobDetails({
              currentModule: activeData.currentModule,
              currentLesson: activeData.currentLesson,
              completedLessons: activeData.completedLessons,
              totalLessons: activeData.totalLessons,
              activeProvider: activeData.activeProvider,
              elapsedSeconds: activeData.elapsedSeconds
            });

            const unsub = onSnapshot(doc(db, 'courses', activeCourseId), (snapshot) => {
              const live = snapshot.data();
              if (live) {
                if (live.generationProgress !== undefined) setGenerationProgress(live.generationProgress);
                if (live.statusMessage) setStatusMessage(live.statusMessage);
                setGenerationJobDetails({
                  currentModule: live.currentModule,
                  currentLesson: live.currentLesson,
                  completedLessons: live.completedLessons,
                  totalLessons: live.totalLessons,
                  activeProvider: live.activeProvider,
                  elapsedSeconds: live.elapsedSeconds
                });

                if (live.generationStatus === 'completed') {
                  unsub();
                  setIsGeneratingQuick(false);
                  setUploadSuccess(true);
                  setGenerationProgress(100);
                  showToast('Course generated successfully!', 'success');
                  refreshCourses();
                } else if (live.generationStatus === 'failed') {
                  unsub();
                  setIsGeneratingQuick(false);
                  setGenerationError(live.generationError || 'Generation failed on server.');
                  setGenerationStep('error');
                } else if (live.generationStatus === 'cancelled') {
                  unsub();
                  setIsGeneratingQuick(false);
                  setGenerationStep('input');
                }
              }
            });
          }
        } catch (err) {
          console.warn('Could not query active generation jobs:', err);
        }
      };
      checkActiveGeneration();
    }
  }, [user]);

  useEffect(() => {
    let interval: any;
    if (isLiveAIUpdate && activeTab === 'settings') {
      interval = setInterval(() => {
        checkAIStatus();
      }, 30000); // Refresh every 30 seconds
    }
    return () => clearInterval(interval);
  }, [isLiveAIUpdate, activeTab]);

  const handleSourceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setSourceFile(file);
    setIsReadingFile(true);
    
    if (file.type === 'application/pdf') {
      setPdfProcessingProgress(0);
      const reader = new FileReader();
      reader.onloadend = () => {
        if (workerRef.current) {
          workerRef.current.onmessage = (event) => {
            const { type, progress, text, error } = event.data;
            if (type === 'PROGRESS') {
              setPdfProcessingProgress(progress);
            } else if (type === 'SUCCESS') {
              setSourceText(text);
              setPdfProcessingProgress(null);
              setIsReadingFile(false);
              showToast("PDF extracted successfully", "success");
            } else if (type === 'ERROR') {
              showToast(`PDF Parsing Error: ${error}`, "error");
              setPdfProcessingProgress(null);
              setIsReadingFile(false);
            }
          };
          workerRef.current.postMessage({ type: 'PARSE_PDF', fileData: reader.result });
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setSourceText(text);
        setIsReadingFile(false);
        showToast("Source file loaded successfully", "success");
      };
      reader.onerror = () => {
        setIsReadingFile(false);
        showToast("Failed to read source file", "error");
      };
      reader.readAsText(file);
    }
  };

  const fetchIntegrityData = async () => {
    if (!db) return;
    setIsLoadingIntegrity(true);
    try {
      console.log("Fetching unresolved integrity issues...");
      const issues = await CurriculumIntegrityService.getUnresolvedIssues();
      console.log(`Fetched ${issues.length} issues.`);
      setIntegrityIssues(issues);

      console.log("Fetching curriculums...");
      const curriculumSnapshot = await getDocs(collection(db, 'curriculums'));
      const currs = curriculumSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log(`Fetched ${currs.length} curriculums.`);
      setAllCurriculums(currs);
    } catch (error: any) {
      console.error("Error fetching integrity data:", error);
      if (error.message?.includes("permissions")) {
        console.error("Permission denied. Current user:", auth.currentUser?.email, "UID:", auth.currentUser?.uid);
      }
      showToast(`Failed to fetch curriculum health data: ${error.message}`, "error");
    } finally {
      setIsLoadingIntegrity(false);
    }
  };

  const handleRemediate = async (issue: any) => {
    setIsRemediating(true);
    try {
      const success = await CurriculumIntegrityService.remediateIssue(issue);
      if (success) {
        showToast(`Successfully remediated issue for ${issue.userEmail}`, "success");
        await fetchIntegrityData();
      } else {
        showToast("Remediation failed", "error");
      }
    } catch (error: any) {
      showToast(`Remediation Error: ${error.message}`, "error");
    } finally {
      setIsRemediating(false);
    }
  };

  const handleBulkRemediate = async () => {
    if (selectedIssues.length === 0) return;
    
    setIsRemediating(true);
    try {
      const issuesToFix = integrityIssues.filter(i => selectedIssues.includes(i.id));
      const { success, failed } = await CurriculumIntegrityService.bulkRemediate(issuesToFix);
      
      showToast(`Bulk remediation complete: ${success} fixed, ${failed} failed`, success > 0 ? "success" : "error");
      setSelectedIssues([]);
      await fetchIntegrityData();
    } catch (error: any) {
      showToast(`Bulk Remediation Error: ${error.message}`, "error");
    } finally {
      setIsRemediating(false);
    }
  };

  useEffect(() => {
    if (user && isLiveLogs && (activeTab === 'logs' || activeTab === 'overview' || activeTab === 'analytics')) {
      const unsubscribe = LogService.subscribeToLogs((fetchedLogs) => {
        setLogs(fetchedLogs);
      }, (activeTab === 'overview' || activeTab === 'analytics') ? 200 : logLimit, logFilter);
      return () => unsubscribe();
    }
  }, [user, isLiveLogs, activeTab, logLimit, logFilter]);

  useEffect(() => {
    const statsMap: Record<string, number> = {};
    logs.forEach(log => {
      const date = log.timestamp?.toDate
        ? log.timestamp.toDate().toLocaleDateString()
        : (typeof log.timestamp === 'string' ? new Date(log.timestamp).toLocaleDateString() : new Date().toLocaleDateString());
      statsMap[date] = (statsMap[date] || 0) + 1;
    });

    const stats = Object.entries(statsMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(-7);

    setLogStats(stats);

    const counts = logs.reduce((acc, log) => {
      const level = log.level as keyof typeof acc;
      if (acc[level] !== undefined) acc[level]++;
      return acc;
    }, { error: 0, warning: 0, info: 0, success: 0 });
    setLogCounts(counts);
  }, [logs]);

  const handleExportLogs = () => {
    const csvContent = "data:text/csv;charset=utf-8," 
      + "Timestamp,Level,Category,User,Message\n"
      + logs.map(l => {
          const time = l.timestamp?.toDate ? l.timestamp.toDate().toISOString() : 'N/A';
          const message = l.message ? String(l.message).replace(/"/g, '""') : '';
          return `"${time}","${l.level}","${l.category}","${l.userEmail}","${message}"`;
        }).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `system_logs_${new Date().toISOString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClearLogs = () => {
    setConfirmModal({
      title: "Clear System Logs",
      message: "Are you sure you want to clear all system logs? This action cannot be undone.",
      onConfirm: async () => {
        setIsLoadingLogs(true);
        setConfirmModal(null);
        try {
          const idToken = await auth.currentUser?.getIdToken();
          const res = await fetch('/api/admin/logs/cleanup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
            },
            body: JSON.stringify({ clearAll: true })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            showToast(data.message || `Cleared ${data.deletedCount} logs`, "success");
            fetchLogs();
          } else {
            showToast(data.error || "Failed to clear logs", "error");
          }
        } catch (error) {
          showToast("Failed to clear logs", "error");
        } finally {
          setIsLoadingLogs(false);
        }
      }
    });
  };

  const fetchLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const fetchedLogs = await LogService.getLogs(logLimit, logFilter);
      setLogs(fetchedLogs);
      
      // Calculate stats for the chart
      const statsMap: Record<string, number> = {};
      fetchedLogs.forEach(log => {
        const date = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleDateString() : new Date().toLocaleDateString();
        statsMap[date] = (statsMap[date] || 0) + 1;
      });
      
      const stats = Object.entries(statsMap)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(-7); // Last 7 days
        
      setLogStats(stats);

      // Calculate counts
      const counts = fetchedLogs.reduce((acc, log) => {
        const level = log.level as keyof typeof acc;
        if (acc[level] !== undefined) acc[level]++;
        return acc;
      }, { error: 0, warning: 0, info: 0, success: 0 });
      setLogCounts(counts);
    } catch (error) {
      console.error("Error fetching logs:", error);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const fetchChatAnalytics = async () => {
    setIsLoadingChatAnalytics(true);
    try {
      const analytics = await AIService.getChatAnalytics();
      setChatAnalytics({
        topTopics: Array.isArray(analytics?.topTopics) ? analytics.topTopics : [],
        recentQueries: Array.isArray(analytics?.recentQueries) ? analytics.recentQueries : []
      });
    } catch (error) {
      console.error("Error fetching chat analytics:", error);
      setChatAnalytics({ topTopics: [], recentQueries: [] });
    } finally {
      setIsLoadingChatAnalytics(false);
    }
  };

  const fetchRoutingConfig = async () => {
    if (!db) return;
    try {
      const docRef = doc(db, 'system_config', 'routing');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setRoutingConfig(prev => ({ ...prev, ...docSnap.data() }));
      }
    } catch (error) {
      console.error("Error fetching routing config:", error);
    }
  };

  const [communityLink, setCommunityLink] = useState('');
  const [isUpdatingCommunity, setIsUpdatingCommunity] = useState(false);

  const fetchCommunityConfig = async () => {
    if (!db) return;
    try {
      const docRef = doc(db, 'system_config', 'community');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists() && docSnap.data().whatsappLink) {
        setCommunityLink(docSnap.data().whatsappLink);
      }
    } catch (error) {
      console.error("Error fetching community config:", error);
    }
  };

  const updateCommunityConfig = async () => {
    if (!db) return;
    setIsUpdatingCommunity(true);
    try {
      await setDoc(doc(db, 'system_config', 'community'), { whatsappLink: communityLink }, { merge: true });
      showToast('Community WhatsApp link updated', 'success');
      LogService.log('info', 'admin', `Updated community whatsapp link`);
    } catch (error) {
      console.error("Error updating community config:", error);
      showToast("Failed to update link", "error");
    } finally {
      setIsUpdatingCommunity(false);
    }
  };

  const fetchAiMode = async () => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/ai-mode', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setGlobalAiMode(data.mode || 'normal');
      }
    } catch (error) {
      console.error("Error fetching AI mode:", error);
    }
  };

  const updateAiMode = async (mode: 'normal' | 'fast') => {
    setIsUpdatingAiMode(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/ai-mode', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ mode })
      });
      if (res.ok) {
        setGlobalAiMode(mode);
        showToast(`Global AI Mode updated to ${mode === 'fast' ? 'Fast Mode (Groq)' : 'Normal Mode'}`, 'success');
      }
    } catch (error) {
      showToast("Failed to update AI mode", "error");
    } finally {
      setIsUpdatingAiMode(false);
    }
  };

  const handleTestApiKey = async () => {
    if (!testKeyInput) {
      showToast("Please enter an API key to test", "error");
      return;
    }
    setIsTestingKey(true);
    setTestKeyResult(null);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/test-api-key', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ provider: testKeyProvider, key: testKeyInput })
      });
      const data = await res.json();
      setTestKeyResult(data);
      if (data.success) {
        showToast("API Key test successful!", "success");
      } else {
        showToast("API Key test failed", "error");
      }
    } catch (error) {
      showToast("Error testing API key", "error");
    } finally {
      setIsTestingKey(false);
    }
  };

  const updateRoutingConfig = async (task: string, provider: string) => {
    const newConfig = { ...routingConfig, [task]: provider };
    setRoutingConfig(newConfig as any);
    try {
      await setDoc(doc(db, 'system_config', 'routing'), newConfig);
      showToast(`Routing for ${task} updated to ${provider}`, 'success');
      LogService.log('info', 'admin', `Updated AI routing for ${task} to ${provider}`);
    } catch (error) {
      console.error("Error updating routing config:", error);
      showToast("Failed to update routing", "error");
    }
  };

  const fetchSystemConfig = async () => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/config', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setSystemConfig(data);
      }
    } catch (error) {
      console.error("Error fetching system config:", error);
    }
  };

  const updateSystemConfig = async (updates: Partial<typeof systemConfig>) => {
    const newConfig = { ...systemConfig, ...updates };
    setSystemConfig(newConfig); // Optimistic update
    try {
      const idToken = await auth.currentUser?.getIdToken();
      await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });
    } catch (error) {
      console.error("Error updating system config:", error);
      fetchSystemConfig(); // Rollback
    }
  };

  const fetchStruggleAnalytics = async () => {
    setIsLoadingAnalytics(true);
    try {
      const analytics = await AIService.getStruggleAnalytics();
      setStruggleAnalytics(Array.isArray(analytics) ? analytics : []);
    } catch (error) {
      console.error("Error fetching struggle analytics:", error);
      setStruggleAnalytics([]);
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  const checkAIStatus = async () => {
    setIsCheckingAI(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        console.warn("No auth token available for AI status check");
        return;
      }
      
      const res = await fetch('/api/admin/ai-status', {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        if (data.status) {
          setAiProviderStatus(data.status);
        } else {
          setAiProviderStatus(data);
        }
        if (data.metrics) {
          setAiMetrics(data.metrics);
        }
        if (data.chartData) {
          setAiChartData(data.chartData);
        }
        if (data.pingResults) {
          setPingResults(prev => ({ ...prev, ...data.pingResults }));
        }
        if (data.stats) {
          setSystemStats(prev => ({
            ...prev,
            totalQuestionsAsked: data.stats.totalQuestions || prev.totalQuestionsAsked,
            popularCourse: data.stats.popularCourse || prev.popularCourse
          }));
        }
        setLastAiUpdate(new Date());

        // Fetch live circuit breaker & real-time provider health
        try {
          const healthRes = await fetch('/api/admin/provider-health', {
            headers: { 'Authorization': `Bearer ${idToken}` }
          });
          if (healthRes.ok) {
            const healthData = await healthRes.json();
            if (healthData.health) {
              setProviderHealth(healthData.health);
            }
          }
        } catch (hErr) {
          console.warn('Provider health fetch warning:', hErr);
        }
      } else {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const errData = await res.json().catch(() => null);
          console.warn("AI status not available:", errData?.error || res.status);
        } else {
          console.warn(`AI status check: server warming up or non-JSON returned (${res.status})`);
        }
      }
    } catch (error: any) {
      console.warn("Notice checking AI status:", error?.message || error);
    } finally {
      setIsCheckingAI(false);
    }
  };

  const fetchSystemHealth = async () => {
    setIsHealthProbing(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/system-health', {
        headers: {
          ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
        }
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setSystemHealth(data);
      }
    } catch (err) {
      console.error("Error probing system health:", err);
    } finally {
      setIsHealthProbing(false);
    }
  };

  const fetchBroadcastHistory = async () => {
    setIsLoadingBroadcastHistory(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/broadcast-history', {
        headers: {
          ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
        }
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setBroadcastHistory(data.history || []);
      }
    } catch (err) {
      console.error("Error fetching broadcast history:", err);
    } finally {
      setIsLoadingBroadcastHistory(false);
    }
  };

  const handleRemediateLesson = async (item: any) => {
    try {
      setRemediatingId(item.subTopicId);
      showToast(`Generating AI remediation for "${item.subTopicTitle}"...`, 'info');
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/remediate-lesson', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          subTopicId: item.subTopicId,
          subTopicTitle: item.subTopicTitle,
          moduleTitle: item.moduleTitle,
          courseId: item.courseId,
          struggleCount: item.count
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Remediation generated! Saved to curriculum & question bank.`, 'success');
        fetchStruggleAnalytics();
      } else {
        showToast(`Remediation error: ${data.error || 'Failed to remediate'}`, 'error');
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setRemediatingId(null);
    }
  };

  const fetchSystemAlerts = async () => {
    setIsLoadingAlerts(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/system-alerts', {
        headers: {
          ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
        }
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setSystemAlerts(data.alerts || []);
      }
    } catch (err) {
      console.error("Error fetching system alerts:", err);
    } finally {
      setIsLoadingAlerts(false);
    }
  };

  const handleDismissAlert = (alertId: string) => {
    setSystemAlerts(prev => prev.filter(a => a.id !== alertId));
    showToast('Alert dismissed', 'info');
  };

  const handleResetUserPassword = async (email: string) => {
    if (!email) return;
    setIsResettingPassword(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Reset link created: ${data.resetLink ? 'Copied link' : 'Sent'}`, 'success');
        if (data.resetLink) {
          navigator.clipboard?.writeText(data.resetLink);
        }
      } else {
        showToast(`Password reset failed: ${data.error || 'Unknown error'}`, 'error');
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleCleanOldLogs = async (days: number = 30) => {
    setIsPruningLogs(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/logs/cleanup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({ daysToKeep: days })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.message || `Pruned ${data.deletedCount || 0} old logs.`, 'success');
        fetchLogs();
      } else {
        showToast(`Log cleanup failed: ${data.error || 'Error'}`, 'error');
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setIsPruningLogs(false);
    }
  };

  const pingAllProviders = async (singleProvider?: string) => {
    if (singleProvider) {
      setPingingProvider(singleProvider);
    } else {
      setIsPingingAll(true);
    }

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;

      const res = await fetch('/api/admin/ping-providers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify(singleProvider ? { provider: singleProvider } : {})
      });

      if (res.ok) {
        const data = await res.json();
        if (data.results) {
          setPingResults(prev => ({
            ...prev,
            ...data.results
          }));
        }
        showToast(
          singleProvider 
            ? `Pinged ${singleProvider} endpoint successfully` 
            : 'Pinging all AI model endpoints complete!', 
          'success'
        );
      } else {
        showToast('Failed to ping AI endpoints', 'error');
      }
    } catch (err) {
      console.error("Error pinging providers:", err);
      showToast('Error connecting to ping endpoint', 'error');
    } finally {
      setIsPingingAll(false);
      setPingingProvider(null);
    }
  };

  const handleGenerateSkeleton = async () => {
    if (!quickCourseName || !quickCourseCode) {
      showToast('Please provide both course code and name', 'error');
      return;
    }
    if (!quickDepartment) {
      showToast('Please select a target Department for course generation', 'error');
      return;
    }

    setIsGeneratingSkeleton(true);
    setStatusMessage('AI is brainstorming the course structure...');
    
    try {
      let skeleton = null;
      let retries = 2;

      const activeAcademicStandard = quickAcademicStandard === 'Custom Academic Benchmark'
        ? (customAcademicStandard.trim() || 'Custom Dynamic Academic Benchmark')
        : quickAcademicStandard;

      while (retries > 0 && !skeleton) {
        try {
          skeleton = await generateCourseSkeleton(
            quickCourseName, 
            `A comprehensive course on ${quickCourseName} for university students.`,
            quickCourseOutline,
            aiProvider,
            [],
            quickLevel,
            quickSemester,
            quickDepartment,
            undefined, // curriculumBenchmark
            quickTone,
            quickDepth,
            sourceText,
            activeAcademicStandard,
            courseScope,
            courseScope === 'FACULTY' ? selectedFaculties : [],
            courseScope === 'DEPARTMENT' ? selectedDepartments : []
          );
        } catch (err) {
          retries--;
          if (retries > 0) {
            setStatusMessage(`Retrying structure generation... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            throw err;
          }
        }
      }
      
      if (!skeleton || !skeleton.modules || !Array.isArray(skeleton.modules) || skeleton.modules.length === 0) {
        console.error("Invalid skeleton structure received:", skeleton);
        throw new Error("The AI failed to generate a valid course structure. This often happens if the AI response is truncated or malformed. Please try again or try a different AI provider.");
      }

      setCourseSkeleton(skeleton);
      setGenerationStep('skeleton');
      showToast('Course structure generated! Please review.', 'info');
    } catch (error: any) {
      console.warn('Skeleton generation issue:', error?.message || error);
      showToast('Failed to generate structure: ' + (error?.message || 'Server error'), 'error');
    } finally {
      setIsGeneratingSkeleton(false);
    }
  };

  const handleCancelGeneration = async () => {
    isCancelledRef.current = true;
    try {
      const courseId = quickCourseCode.replace(/\s+/g, '').toUpperCase();
      const user = auth.currentUser;
      const idToken = await user?.getIdToken();
      await fetch('/api/course/cancel-job', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ courseId })
      });
      showToast('Course generation cancelled.', 'info');
    } catch (e: any) {
      console.warn('Failed to call cancel endpoint:', e);
    } finally {
      setIsGeneratingQuick(false);
      setGenerationStep('input');
    }
  };

  const handleFinalizeGeneration = async (opts?: { resume?: boolean }) => {
    if (!courseSkeleton) return;
    if (!quickDepartment) {
      showToast('Please select a target Department before generating full content', 'error');
      return;
    }

    setIsGeneratingQuick(true);
    isCancelledRef.current = false;
    setGenerationError(null);
    setGenerationStep('generating');
    setGenerationProgress(opts?.resume ? 20 : 5);
    setStatusMessage(opts?.resume ? 'Resuming course generation from last saved checkpoint...' : 'Contacting server to coordinate course creation...');
    
    try {
      const courseId = quickCourseCode.replace(/\s+/g, '').toUpperCase();
      const user = auth.currentUser;
      if (!user) throw new Error('You must be logged in.');
      const idToken = await user.getIdToken();

      const activeAcademicStandard = quickAcademicStandard === 'Custom Academic Benchmark'
        ? (customAcademicStandard.trim() || 'Custom Dynamic Academic Benchmark')
        : quickAcademicStandard;

      // Call our server-coordinated endpoint
      const response = await fetch('/api/course/generate-coordinated', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          courseId,
          courseName: quickCourseName,
          courseDescription: courseSkeleton.description,
          outline: quickCourseOutline,
          provider: aiProvider,
          level: quickLevel,
          semester: quickSemester,
          department: quickDepartment,
          tone: quickTone,
          depth: quickDepth,
          sourceText,
          academicStandard: activeAcademicStandard,
          subject: quickSubject,
          scope: courseScope,
          selectedFaculties: courseScope === 'FACULTY' ? selectedFaculties : [],
          selectedDepartments: courseScope === 'DEPARTMENT' ? selectedDepartments : [],
          approvedModules: courseSkeleton.modules,
          domainBrief: courseSkeleton.domainBrief,
          learningOutcomes: courseSkeleton.learningOutcomes,
          coverageScore: courseSkeleton.coverageScore,
          rubricAudit: (courseSkeleton as any).rubricAudit,
          groundingReferences: courseSkeleton.groundingReferences,
          resume: opts?.resume === true
        })
      });

      const ct = response.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        const text = await response.text().catch(() => '');
        if (text.includes('<!doctype') || text.includes('Starting Server') || !response.ok) {
          throw new Error('Application server is warming up or temporarily busy. Please retry shortly.');
        }
        throw new Error(`Unexpected server response format (${response.status}).`);
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Server failed to start coordinated course generation.');
      }

      const initData = await response.json();
      console.log('Coordinated generation started:', initData);

      // Subscribe to real-time updates from Firestore Course Document + server status fallback
      const courseRef = doc(db, 'courses', courseId);
      let unsubscribe: () => void = () => {};
      let isFinished = false;

      const handleCourseStatusData = (data: any) => {
        if (!data || isFinished || isCancelledRef.current) return;
        if (data.generationProgress !== undefined) {
          setGenerationProgress(data.generationProgress);
        }
        if (data.statusMessage) {
          setStatusMessage(data.statusMessage);
        }
        setGenerationJobDetails({
          currentModule: data.currentModule,
          currentLesson: data.currentLesson,
          completedLessons: data.completedLessons,
          totalLessons: data.totalLessons,
          activeProvider: data.activeProvider,
          elapsedSeconds: data.elapsedSeconds
        });

        if (data.generationStatus === 'cancelled') {
          isFinished = true;
          clearInterval(keepAliveInterval);
          unsubscribe();
          setIsGeneratingQuick(false);
          setGenerationStep('input');
          showToast('Course generation was cancelled.', 'info');
        } else if (data.generationStatus === 'completed') {
          isFinished = true;
          clearInterval(keepAliveInterval);
          unsubscribe();
          setIsGeneratingQuick(false);
          setUploadSuccess(true);
          setGenerationProgress(100);
          showToast('Course generated successfully!', 'success');
          refreshCourses();

          // Reset fields after a delay
          setTimeout(() => {
            setGenerationStep('input');
            setCourseSkeleton(null);
            setQuickCourseName('');
            setQuickCourseCode('');
            setQuickCourseOutline('');
            setGenerationProgress(0);
            setUploadSuccess(false);
          }, 3000);
        } else if (data.generationStatus === 'failed') {
          isFinished = true;
          clearInterval(keepAliveInterval);
          unsubscribe();
          setIsGeneratingQuick(false);
          setGenerationError(data.generationError || 'Generation failed on the server.');
          setGenerationStep('error');
          showToast('Failed to complete generation: ' + (data.generationError || 'Internal Error'), 'error');
        }
      };

      const keepAliveInterval = setInterval(async () => {
        if (isCancelledRef.current || isFinished) {
          clearInterval(keepAliveInterval);
          return;
        }
        try {
          const statusRes = await fetch(`/api/course/status/${encodeURIComponent(courseId)}`, {
            headers: { 'Authorization': `Bearer ${idToken}` }
          });
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            handleCourseStatusData(statusData);
          }
        } catch {
          // Ignore transient polling error
        }
      }, 3000);

      unsubscribe = onSnapshot(courseRef, (snapshot) => {
        if (isCancelledRef.current || isFinished) {
          clearInterval(keepAliveInterval);
          unsubscribe();
          return;
        }
        handleCourseStatusData(snapshot.data());
      }, (error) => {
        console.warn('Snapshot subscription fallback to server polling:', error);
      });

    } catch (error: any) {
      console.error('Final generation error:', error);
      setGenerationError(error.message);
      setGenerationStep('error');
      showToast('Failed to complete generation: ' + error.message, 'error');
      setIsGeneratingQuick(false);
    }
  };

  const fetchSystemStats = async () => {
    if (!db) return;
    try {
      const querySnapshot = await getDocs(collection(db, 'users'));
      let sparks = 0;
      let masterySum = 0;
      let topicCount = 0;
      const courseCounts: Record<string, number> = {};
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        sparks += (data.total_sparks_used || 0);
        if (data.mastery) {
          Object.values(data.mastery).forEach((m: any) => {
            masterySum += m;
            topicCount++;
          });
        }
        if (data.enrolledCourses && Array.isArray(data.enrolledCourses)) {
          data.enrolledCourses.forEach((cId: string) => {
            courseCounts[cId] = (courseCounts[cId] || 0) + 1;
          });
        }
      });

      let popularCourseName = '';
      let maxCount = 0;
      Object.entries(courseCounts).forEach(([cId, count]) => {
        if (count > maxCount) {
          maxCount = count;
          const courseObj = courses[cId];
          popularCourseName = courseObj ? (courseObj.title || courseObj.id || cId) : cId;
        }
      });

      if (!popularCourseName) {
        const firstCourse = Object.values(courses)[0];
        if (firstCourse) {
          popularCourseName = firstCourse.title || firstCourse.id || 'GST 111';
        } else {
          popularCourseName = 'GST 111';
        }
      }

      setSystemStats({
        totalSparksConsumed: sparks,
        totalQuestionsAsked: Math.floor(sparks / 10),
        averageMastery: topicCount > 0 ? Math.round(masterySum / topicCount) : 0,
        popularCourse: popularCourseName
      });
    } catch (error) {
      console.error("Error fetching system stats:", error);
    }
  };

  const handleSendNotification = async () => {
    if (!notificationText || !db) return;
    const msgClean = notificationText.trim();
    const urlClean = whatsappLink.trim();

    if (msgClean.length < 5) {
      showToast("Announcement message must be at least 5 characters.", "error");
      return;
    }
    if (urlClean && !/^https?:\/\//i.test(urlClean)) {
      showToast("CTA URL must begin with http:// or https://", "error");
      return;
    }

    setIsSendingNotification(true);
    try {
      const announcementRef = doc(collection(db, 'announcements'));
      const aud = targetAudience === 'students' ? 'all' : (targetAudience as any) || 'all';

      await setDoc(announcementRef, {
        id: announcementRef.id,
        title: 'System Announcement',
        message: msgClean,
        active: true,
        severity: 'info',
        audience: aud,
        ctaUrl: urlClean || null,
        ctaLabel: urlClean ? 'Join WhatsApp' : null,
        createdAt: serverTimestamp(),
        publishedBy: user?.email || 'admin',
        impressions: 0,
        dismissalsCount: 0
      });

      // Deactivate legacy global_alert
      await setDoc(doc(db, 'notifications', 'global_alert'), { active: false }, { merge: true }).catch(() => {});

      // Send individual inbox notifications
      try {
        let usersQuery = collection(db, 'users');
        const usersSnapshot = await getDocs(usersQuery);
        const batch = writeBatch(db);
        
        usersSnapshot.docs.forEach(userDoc => {
          const userData = userDoc.data();
          let shouldSend = false;

          switch (targetAudience) {
            case 'all': shouldSend = true; break;
            case 'students': shouldSend = userData.role === 'student'; break;
            case 'tutors': shouldSend = userData.role === 'tutor'; break;
            case 'moderators': shouldSend = userData.role === 'moderator'; break;
            default: shouldSend = true;
          }

          if (shouldSend) {
            const notifRef = doc(collection(db, 'notifications'));
            batch.set(notifRef, {
              userId: userDoc.id,
              title: 'Admin Announcement',
              message: msgClean,
              link: urlClean,
              type: 'info',
              read: false,
              createdAt: serverTimestamp()
            });
          }
        });
        await batch.commit();
      } catch (batchError) {
        console.error("Error sending batch notifications:", batchError);
      }

      showToast("Dynamic announcement published successfully!", "success");
      LogService.log('info', 'admin', `Published announcement (${announcementRef.id}) to ${targetAudience}: ${msgClean.substring(0, 50)}...`);
      setNotificationText('');
      setWhatsappLink('');
    } catch (error) {
      console.error("Error sending notification:", error);
      showToast("Failed to publish announcement.", "error");
    } finally {
      setIsSendingNotification(false);
    }
  };

  const handleSendEmail = async () => {
    if (!emailTo || !emailSubject || !emailBody) {
      showToast("Please fill in all required email fields.", "error");
      return;
    }
    setIsSendingEmail(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          to: emailTo,
          subject: emailSubject,
          body: emailBody,
          fromName: emailFromName
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to send email');

      showToast("Email sent successfully!", "success");
      LogService.log('info', 'admin', `Sent personal email to ${emailTo}: ${emailSubject}`);
      setEmailTo('');
      setEmailSubject('');
      setEmailBody('');
    } catch (error: any) {
      console.error("Email Error:", error);
      showToast(`Failed to send email: ${error.message}`, "error");
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleResetSparks = async (userId: string) => {
    if (!db) return;
    setConfirmModal({
      title: "Reset Sparks",
      message: "Are you sure you want to reset this user's sparks to 10,000?",
      onConfirm: async () => {
        try {
          await setDoc(doc(db, 'users', userId), { ai_sparks: 10000 }, { merge: true });
          showToast("Sparks reset successfully!", "success");
          LogService.log('warning', 'admin', `Reset sparks for user ${userId} to 10,000`);
          fetchUsers();
        } catch (error) {
          console.error("Error resetting sparks:", error);
          showToast("Failed to reset sparks.", "error");
        }
        setConfirmModal(null);
      }
    });
  };

  const handleUpdateRole = async (targetUserId: string, newRole: string) => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;

      const res = await fetch('/api/admin/update-user-role', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ targetUserId, newRole })
      });

      if (res.ok) {
        // Send notification to user
        if (db) {
          try {
            const newNotifRef = doc(collection(db, 'notifications'));
            await setDoc(newNotifRef, {
              userId: targetUserId,
              title: 'Role Updated',
              message: `Your account role has been updated to ${newRole}. Please refresh or re-login to see changes.`,
              type: 'info',
              read: false,
              createdAt: serverTimestamp()
            }, { merge: true });
          } catch (notifErr) {
            console.error("Failed to send role update notification:", notifErr);
          }
        }
        
        // Dynamically send email if promoting to admin or other roles
        const targetUser = users.find(u => u.id === targetUserId);
        if (targetUser && targetUser.email) {
          try {
            await fetch('/api/admin/send-email', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ 
                to: targetUser.email, 
                subject: `Your UniAce Account Role has been updated to ${newRole}`, 
                body: `<p>Hello ${targetUser.displayName || 'User'},</p><p>Your account role on UniAce has been updated to <strong>${newRole}</strong>.</p><p>Please refresh your dashboard or log in again to see these changes.</p>`,
                fromName: 'UniAce Admin Team'
              })
            });
          } catch (emailErr) {
            console.error("Failed to send role update email:", emailErr);
          }
        }
        
        showToast(`User role updated to ${newRole}`, 'success');
        LogService.log('warning', 'admin', `Updated user role for ${targetUserId} to ${newRole}`);
        fetchUsers();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to update role', 'error');
      }
    } catch (error) {
      console.error('Error updating role:', error);
      showToast('An error occurred while updating role', 'error');
    }
  };

  const handleCreateUser = async () => {
    if (!userFormEmail || !userFormPassword || !userFormName) {
      showToast('Name, Email and Password are required', 'error');
      return;
    }
    setIsSavingUser(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;

      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: userFormEmail,
          password: userFormPassword,
          displayName: userFormName,
          role: userFormRole,
          department: userFormDepartment,
          academic_level: userFormAcademicLevel,
          plan_type: userFormPlanType,
          ai_sparks: Number(userFormSparks)
        })
      });

      if (res.ok) {
        showToast('User created successfully!', 'success');
        LogService.log('info', 'admin', `Created user account manually: ${userFormEmail} (${userFormRole})`);
        setIsAddUserModalOpen(false);
        // Clear form
        setUserFormName('');
        setUserFormEmail('');
        setUserFormPassword('');
        setUserFormRole('student');
        setUserFormDepartment('');
        setUserFormAcademicLevel('100');
        setUserFormPlanType('free');
        setUserFormSparks(0);
        fetchUsers();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to create user', 'error');
      }
    } catch (error) {
      console.error('Error creating user:', error);
      showToast('An error occurred while creating user', 'error');
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleUpdateUser = async () => {
    if (!selectedUserForEdit) return;
    setIsSavingUser(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;

      const payload: any = {
        targetUserId: selectedUserForEdit.id,
        displayName: userFormName,
        email: userFormEmail,
        role: userFormRole,
        department: userFormDepartment,
        academic_level: userFormAcademicLevel,
        plan_type: userFormPlanType,
        ai_sparks: Number(userFormSparks)
      };

      if (userFormPassword) {
        payload.password = userFormPassword;
      }

      const res = await fetch('/api/admin/update-user', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showToast('User updated successfully!', 'success');
        LogService.log('info', 'admin', `Updated user account details manually: ${userFormEmail}`);
        setSelectedUserForEdit(null);
        fetchUsers();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to update user', 'error');
      }
    } catch (error) {
      console.error('Error updating user:', error);
      showToast('An error occurred while updating user', 'error');
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleDeleteUser = async (targetUserId: string) => {
    if (!db) return;
    const targetUser = users.find(u => u.id === targetUserId);
    if (!targetUser) return;

    setConfirmModal({
      title: "Delete User Permanently",
      message: `Are you sure you want to permanently delete user ${targetUser.displayName || targetUser.email || targetUserId}? This will revoke login access and remove all Firestore profile documents! This action is irreversible.`,
      onConfirm: async () => {
        try {
          const idToken = await auth.currentUser?.getIdToken();
          if (!idToken) return;

          const res = await fetch('/api/admin/delete-user', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${idToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ targetUserId })
          });

          if (res.ok) {
            showToast("User deleted successfully!", "success");
            LogService.log('warning', 'admin', `Deleted user ${targetUserId} permanently.`);
            fetchUsers();
          } else {
            const err = await res.json();
            showToast(err.error || "Failed to delete user", "error");
          }
        } catch (error) {
          console.error("Error deleting user:", error);
          showToast("Failed to delete user.", "error");
        }
        setConfirmModal(null);
      }
    });
  };

  const fetchKbStats = async () => {
    if (!db) return;
    try {
      const snapshot = await getDocs(query(collection(db, 'knowledge_base'), limit(1)));
      // This is a rough estimate, Firestore doesn't provide easy count for large collections
      setKbStats({ totalChunks: snapshot.empty ? 0 : snapshot.size });
    } catch (error: any) {
      console.error("Error fetching KB stats:", error);
      if (error.message?.includes('permissions') || error.code === 'permission-denied') {
        setIngestionStatus("Note: Knowledge Base stats hidden due to Firestore rules. This is normal if you haven't set public read rules.");
      }
    }
  };

  const handleIngestKB = async () => {
    if (!kbContent || !kbCourseCode) {
      showToast("Please provide at least content and course code.", "error");
      return;
    }

    setIsIngesting(true);
    setIngestionStatus('Preparing ingestion...');

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not authenticated");
      const idToken = await user.getIdToken();

      setIngestionStatus('Calling backend ingestion API...');
      const response = await fetch('/api/admin/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          content: kbContent,
          course_code: kbCourseCode,
          module_name: kbModuleName,
          topic_name: kbTopicName
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Ingestion failed');

      setIngestionStatus(`Success: ${data.message}`);
      showToast("Knowledge Base updated!", "success");
      LogService.log('success', 'admin', `Ingested content into Knowledge Base for ${kbCourseCode}`, { course: kbCourseCode, module: kbModuleName });
      setKbContent('');
      setKbCourseCode('');
      setKbModuleName('');
      setKbTopicName('');
      await fetchKbStats();
    } catch (error: any) {
      console.error("Ingestion Error:", error);
      setIngestionStatus(`Error: ${error.message}`);
      showToast(`Ingestion failed: ${error.message}`, "error");
    } finally {
      setIsIngesting(false);
    }
  };

  const ingestCourseToKB = async (course: Course) => {
    if (!course.syllabus || course.syllabus.length === 0) return;
    
    setStatusMessage('Step 2: Ingesting content into Knowledge Base...');
    
    const user = auth.currentUser;
    if (!user) return;
    const idToken = await user.getIdToken();

    let totalIngested = 0;
    const totalTopics = (course.syllabus || []).reduce((acc, mod) => acc + (mod.subTopics || []).length, 0);

    for (const module of course.syllabus) {
      for (const subTopic of module.subTopics) {
        try {
          totalIngested++;
          setStatusMessage(`Ingesting: ${subTopic.title} (${totalIngested}/${totalTopics})...`);
          
          await fetch('/api/admin/ingest', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
              content: subTopic.content,
              course_code: course.id,
              module_name: module.title,
              topic_name: subTopic.title
            })
          });
        } catch (error) {
          console.error(`Failed to ingest topic ${subTopic.title}:`, error);
        }
      }
    }
    
    await fetchKbStats();
  };

  const [emailDebugInfo, setEmailDebugInfo] = useState<any>(null);
  const [isDebuggingEmail, setIsDebuggingEmail] = useState(false);
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);

  const handleSendTestEmail = async (toEmail: string) => {
    setIsSendingTestEmail(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/test-email', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ to: toEmail })
      });
      if (res.ok) {
        showToast("Test email sent successfully!", "success");
      } else {
        const data = await res.json();
        showToast(`Failed to send test email: ${data.error || 'Unknown error'}`, "error");
      }
    } catch (error: any) {
      console.error("Error sending test email:", error);
      showToast(`Error sending test email: ${error.message}`, "error");
    } finally {
      setIsSendingTestEmail(false);
    }
  };

  const [isSendingWelcomeEmail, setIsSendingWelcomeEmail] = useState(false);
  const [isSendingTrialReminderEmail, setIsSendingTrialReminderEmail] = useState(false);

  const handleSendWelcomeEmail = async (toEmail: string, name: string, trialDays: number) => {
    setIsSendingWelcomeEmail(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/test-email', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          to: toEmail, 
          template: 'welcome', 
          trialDays: trialDays
        })
      });
      if (res.ok) {
        showToast("Welcome Email sent successfully!", "success");
      } else {
        const data = await res.json();
        showToast(`Failed to send Welcome Email: ${data.error || 'Unknown error'}`, "error");
      }
    } catch (error: any) {
      console.error("Error sending Welcome Email:", error);
      showToast(`Error sending Welcome Email: ${error.message}`, "error");
    } finally {
      setIsSendingWelcomeEmail(false);
    }
  };

  const handleSendTrialReminderEmail = async (toEmail: string, name: string, daysLeft: number, trialDays: number) => {
    setIsSendingTrialReminderEmail(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/send-reminder', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          to: toEmail, 
          displayName: name, 
          daysLeft: daysLeft,
          trialDays: trialDays
        })
      });
      if (res.ok) {
        showToast("Trial Expiration Reminder sent successfully!", "success");
      } else {
        const data = await res.json();
        showToast(`Failed to send Trial Expiration Reminder: ${data.error || 'Unknown error'}`, "error");
      }
    } catch (error: any) {
      console.error("Error sending Trial Expiration Reminder:", error);
      showToast(`Error sending Trial Expiration Reminder: ${error.message}`, "error");
    } finally {
      setIsSendingTrialReminderEmail(false);
    }
  };

  const handleDebugEmail = async () => {
    setIsDebuggingEmail(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/debug-email', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setEmailDebugInfo(data);
        if (data.connection.success) {
          showToast("SMTP Connection Successful!", "success");
        } else {
          showToast("SMTP Connection Failed", "error");
        }
      } else {
        showToast("Failed to fetch email debug info", "error");
      }
    } catch (error) {
      console.error("Error debugging email:", error);
      showToast("Error debugging email", "error");
    } finally {
      setIsDebuggingEmail(false);
    }
  };

  const [userStats, setUserStats] = useState({
    total: 0,
    students: 0,
    tutors: 0,
    admins: 0,
    moderators: 0,
    activeToday: 0
  });

  // Memoized platform analytics data utilizing real-time Firestore collections
  const analyticsChartData = React.useMemo(() => {
    const dayList = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      dayList.push(d);
    }

    const getLogDate = (l: any) => {
      if (!l.timestamp) return null;
      if (l.timestamp.toDate) return l.timestamp.toDate();
      if (l.timestamp.seconds) return new Date(l.timestamp.seconds * 1000);
      return new Date(l.timestamp);
    };

    const dailyRealLogs: Record<string, { ai: number; user: number; admin: number; system: number; activeUsers: Set<string>; enrollments: number }> = {};
    
    dayList.forEach(day => {
      dailyRealLogs[day.toDateString()] = {
        ai: 0,
        user: 0,
        admin: 0,
        system: 0,
        activeUsers: new Set<string>(),
        enrollments: 0
      };
    });

    logs.forEach(l => {
      const logDate = getLogDate(l);
      if (!logDate) return;
      const dateStr = logDate.toDateString();
      
      if (dailyRealLogs[dateStr] !== undefined) {
        const category = l.category || 'system';
        if (category === 'ai') dailyRealLogs[dateStr].ai++;
        else if (category === 'user') dailyRealLogs[dateStr].user++;
        else if (category === 'admin') dailyRealLogs[dateStr].admin++;
        else dailyRealLogs[dateStr].system++;

        const userIdent = l.userId || l.userEmail || 'anonymous';
        if (userIdent !== 'system' && userIdent !== 'anonymous') {
          dailyRealLogs[dateStr].activeUsers.add(userIdent);
        }

        if (l.message && (l.message.includes('Enrolled') || l.message.includes('enrolled') || l.message.includes('Enroll') || l.message.includes('enroll'))) {
          dailyRealLogs[dateStr].enrollments++;
        }
      }
    });

    const currentTotalEnrollments = users.reduce((acc, u) => acc + (u.enrolledCourses?.length || 0), 0);

    const engagementTrend: any[] = [];
    const dauTrend: any[] = [];
    const enrollmentTrend: any[] = [];

    let cumulativeEnrollment = currentTotalEnrollments;

    for (let i = 6; i >= 0; i--) {
      const day = dayList[i];
      const dateStr = day.toDateString();
      const dayReal = dailyRealLogs[dateStr];
      const isToday = i === 6;

      const userCount = dayReal?.user || 0;
      const aiCount = dayReal?.ai || 0;
      const adminCount = dayReal?.admin || 0;
      const systemCount = dayReal?.system || 0;

      engagementTrend.unshift({
        date: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        weekday: day.toLocaleDateString('en-US', { weekday: 'short' }),
        'Student Actions': userCount,
        'AI Tutor Hits': aiCount,
        'Admin Actions': adminCount,
        'System Services': systemCount,
        Total: userCount + aiCount + adminCount + systemCount
      });

      let dauValue = dayReal?.activeUsers.size || 0;
      if (isToday) {
        dauValue = Math.max(dauValue, userStats.activeToday);
      }

      dauTrend.unshift({
        date: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        weekday: day.toLocaleDateString('en-US', { weekday: 'short' }),
        DAU: dauValue,
        'Unique Logged Users': dayReal?.activeUsers.size || 0
      });

      enrollmentTrend.unshift({
        date: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        Enrollments: Math.max(cumulativeEnrollment, 0),
        New: dayReal?.enrollments || 0
      });

      const enrollsOnThisDay = dayReal?.enrollments || 0;
      cumulativeEnrollment = Math.max(cumulativeEnrollment - enrollsOnThisDay, 0);
    }

    return {
      engagementTrend,
      dauTrend,
      enrollmentTrend
    };
  }, [logs, users, courses, userStats, systemStats]);

  const [curriculumRequests, setCurriculumRequests] = useState<any[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);

  const fetchCurriculumRequests = async () => {
    if (!db) return;
    setIsLoadingRequests(true);
    try {
      const q = query(collection(db, 'curriculum_requests'), orderBy('timestamp', 'desc'));
      const querySnapshot = await getDocs(q);
      const requests = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCurriculumRequests(requests);
    } catch (error) {
      console.error("Error fetching curriculum requests:", error);
    } finally {
      setIsLoadingRequests(false);
    }
  };

  const fetchUsers = async () => {
    if (!db) return;
    setIsLoadingUsers(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'users'));
      const userList: any[] = [];
      const stats = {
        total: 0,
        students: 0,
        tutors: 0,
        admins: 0,
        moderators: 0,
        activeToday: 0
      };

      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        userList.push({ id: doc.id, ...data });
        
        stats.total++;
        const role = data.role || 'student';
        if (role === 'student') stats.students++;
        else if (role === 'tutor') stats.tutors++;
        else if (role === 'admin') stats.admins++;
        else if (role === 'moderator') stats.moderators++;

        if (data.lastActive) {
          const lastActive = parseFirestoreDate(data.lastActive);
          if (lastActive && !isNaN(lastActive.getTime()) && lastActive > oneDayAgo) stats.activeToday++;
        }
      });
      
      setUsers(userList);
      setUserStats(stats);
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const [isPruningOrphans, setIsPruningOrphans] = useState(false);

  const handlePruneOrphans = async () => {
    if (!isAdmin) {
      showToast('Unauthorized: Admin access required', 'error');
      return;
    }
    
    setConfirmModal({
      title: 'Prune Orphaned User Records?',
      message: 'This will compare all user accounts in Firestore against Firebase Authentication. Any Firestore user document that has no corresponding active Authentication record (e.g., users deleted from Firebase console directly) will be permanently pruned. This keeps your directory perfectly synchronized.',
      onConfirm: async () => {
        setConfirmModal(null);
        setIsPruningOrphans(true);
        try {
          const idToken = await auth.currentUser?.getIdToken();
          const response = await fetch('/api/admin/prune-orphans', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
            }
          });
          
          const data = await response.json();
          if (response.ok) {
            showToast(data.message || `Prune complete. Removed ${data.prunedCount} orphaned records.`, 'success');
            fetchUsers();
          } else {
            showToast(data.error || 'Failed to prune orphaned users', 'error');
          }
        } catch (error: any) {
          console.error('Error pruning orphaned users:', error);
          showToast(`Error: ${error.message}`, 'error');
        } finally {
          setIsPruningOrphans(false);
        }
      }
    });
  };

  useEffect(() => {
    if (!db) return;
    setIsLoadingUsers(true);
    const unsubscribe = onSnapshot(collection(db, 'users'), (querySnapshot) => {
      const userList: any[] = [];
      const stats = {
        total: 0,
        students: 0,
        tutors: 0,
        admins: 0,
        moderators: 0,
        activeToday: 0
      };

      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        userList.push({ id: doc.id, ...data });
        
        stats.total++;
        const role = data.role || 'student';
        if (role === 'student') stats.students++;
        else if (role === 'tutor') stats.tutors++;
        else if (role === 'admin') stats.admins++;
        else if (role === 'moderator') stats.moderators++;

        if (data.lastActive) {
          const lastActive = parseFirestoreDate(data.lastActive);
          if (lastActive && !isNaN(lastActive.getTime()) && lastActive > oneDayAgo) stats.activeToday++;
        }
      });
      
      setUsers(userList);
      setUserStats(stats);
      setIsLoadingUsers(false);
    }, (error) => {
      console.error("Error fetching users realtime:", error);
      setIsLoadingUsers(false);
    });

    return () => unsubscribe();
  }, [db]);

  const handleRestoreCourse = async (courseId: string) => {
    showToast("Direct Firestore course writes are paused during Postgres catalog migration. Use Postgres administrative API.", "info");
    return;
  };

  const handleDeleteCourse = async (courseId: string) => {
    showToast("Direct Firestore course writes are paused during Postgres catalog migration. Use Postgres administrative API.", "info");
    return;
  };

  const handlePermanentDeleteCourse = async (courseId: string) => {
    showToast("Direct Firestore course writes are paused during Postgres catalog migration. Use Postgres administrative API.", "info");
    return;
  };

  const handleEditCourse = (course: Course) => {
    setSelectedCourse(course);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setSelectedFile(file);
      setUploadSuccess(false);
      setStatusMessage('');
    } else {
      showToast('Please select a valid PDF file.', 'error');
    }
  };

  const fileToGenerativePart = async (file: File) => {
    return new Promise<{ inlineData: { data: string; mimeType: string } }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
        const base64Data = base64String.split(',')[1];
        resolve({
          inlineData: {
            data: base64Data,
            mimeType: file.type,
          },
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    if (!quickDepartment) {
      showToast('Please select a Department before extracting.', 'error');
      return;
    }

    setIsUploading(true);
    setUploadProgress(10);
    setStatusMessage('Initializing upload...');

    try {
      // 1. Prepare for Gemini
      setStatusMessage('Processing PDF with Gemini 3.0 Flash Preview...');
      const pdfPart = await fileToGenerativePart(selectedFile);
      setUploadProgress(40);

      // 2. Call Gemini API
      setStatusMessage(`Analyzing with Gemini 3.0 Flash Preview...`);

      const prompt = `
        You are an expert curriculum designer and university professor.
        Analyze the attached PDF document, which is a university-level course note.
        Extract the full course syllabus and content into a structured JSON format.

        CRITICAL INSTRUCTIONS FOR DIAGRAMS AND IMAGES:
        1. If you encounter a flowchart, system architecture, graph, or structural diagram, describe it in detail using text or a structured list.
        2. If you encounter a complex photograph or highly detailed illustration (e.g., biology anatomy, real-world photos) that cannot be coded, simply ignore it or replace it with a descriptive placeholder like "[Complex Image: Admin to insert manually]".

        The output must strictly follow this JSON structure:
        {
          "id": "${courseCode || 'COURSE_CODE'}",
          "title": "${courseTitle || 'Course Title'}",
          "description": "A brief summary of the course",
          "department": "${quickDepartment || 'Department'}",
          "syllabus": [
            {
              "id": "module_id",
              "title": "Module Title",
              "subTopics": [
                {
                  "id": "subtopic_id",
                  "title": "Subtopic Title",
                  "content": "The full educational content. Use Markdown. IMPORTANT: Wrap all math formulas in LaTeX using $ for inline (e.g., $x^2$) and $$ for block (e.g., $$ \\int x dx $$)."
                }
              ]
            }
          ]
        }

        Ensure the content is comprehensive, university-level, and well-formatted.
        Do not truncate the content. Extract as much as possible.
        Output ONLY the JSON string. Do not include markdown code blocks like \`\`\`json.
      `;

      const response = await AIService.extractCourseFromPDF(
        pdfPart.inlineData.data,
        pdfPart.inlineData.mimeType,
        prompt,
        courseCode,
        courseTitle,
        quickDepartment,
        quickLevel,
        quickSemester,
        quickSubject
      );

      setUploadProgress(70);
      setStatusMessage('Parsing AI response...');

      const responseText = response.text;
      if (!responseText) throw new Error("No response from AI");
      // Clean up the response if it contains markdown code blocks
      const cleanJson = responseText.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();
      
      let courseData: Course;
      try {
        try {
          courseData = JSON.parse(cleanJson);
        } catch (parseError) {
          const repaired = jsonrepair(cleanJson);
          courseData = JSON.parse(repaired);
        }
      } catch (e) {
        console.error("JSON Parse Error:", e);
        console.log("Raw Response:", responseText);
        throw new Error("Failed to parse AI response. The PDF might be too complex or the AI output was malformed.");
      }

      // 4. Enter Review Mode
      const finalCourse = {
        ...courseData,
        id: (courseCode || courseData.id || `COURSE_${Date.now()}`) as any,
        level: quickLevel,
        semester: quickSemester,
        subject: quickSubject,
        department: quickDepartment
      } as Course;
      setExtractedCourse(finalCourse);
      setRawJsonText(JSON.stringify(finalCourse, null, 2));
      setIsReviewing(true);
      setUploadProgress(100);
      setStatusMessage('Extraction complete. Ready for review.');

    } catch (error: any) {
      console.error("Upload/Extraction Error:", error);
      setStatusMessage(`Error: ${error.message}`);
      setUploadProgress(0);
      setIsUploading(false);
    } finally {
      setIsUploading(false);
    }
  };

  const handlePublishCourse = async () => {
    if (!selectedFile) return;
    
    let finalCourseData: Course;
    try {
      finalCourseData = JSON.parse(rawJsonText);
    } catch (e) {
      showToast("Invalid JSON format. Please fix any syntax errors before publishing.", "error");
      return;
    }

    const sanitizedId = finalCourseData.id.replace(/\s+/g, '').toUpperCase();
    setIsUploading(true);
    setStatusMessage('Saving course to database...');
    try {
      if (!db) throw new Error("Firestore not initialized");

      showToast("Direct Firestore course writes are paused during Postgres catalog migration. Use Postgres migration API.", "info");
      setStatusMessage("Direct Firestore course writes are paused during Postgres catalog migration.");
      setIsUploading(false);
      return;

      LogService.log('success', 'admin', `Published new course: ${finalCourseData.title} (${finalCourseData.id})`);

      // Phase 2: Automatic Ingestion
      await ingestCourseToKB(finalCourseData);

      setUploadSuccess(true);
      setStatusMessage('Course published and ingested successfully!');
      showToast('Course published successfully!', 'success');
      setSelectedFile(null);
      setExtractedCourse(null);
      setRawJsonText('');
      setIsReviewing(false);
      setCourseCode('');
      setCourseTitle('');
      
      await refreshCourses();
    } catch (error: any) {
      console.error("Publish Error:", error);
      showToast("Failed to publish course: " + error.message, "error");
    } finally {
      setIsUploading(false);
    }
  };

  const handleFastTrackAIBuild = async (req: any) => {
    setActiveTab('courses');
    setQuickDepartment(req.department);
    setQuickLevel(req.level);
    if (req.semester) {
      setQuickSemester(req.semester);
    }
    
    try {
      if (req.status !== 'in_progress') {
        await updateDoc(doc(db, 'curriculum_requests', req.id), { status: 'in_progress' });
        showToast('Request marked as In Progress. Fast track building initiated!', 'success');
        fetchCurriculumRequests();
      } else {
        showToast('Fast track building initiated!', 'success');
      }
    } catch (e) {
      console.error(e);
      showToast('Error updating status.', 'error');
    }
  };

  const handleMarkFulfilled = async (req: any) => {
    try {
      await updateDoc(doc(db, 'curriculum_requests', req.id), { status: 'fulfilled' });
      showToast('Request marked as Fulfilled.', 'success');
      fetchCurriculumRequests();
    } catch (e) {
      console.error(e);
      showToast('Failed to mark request.', 'error');
    }
  };

  const renderCurriculumRequests = () => {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Curriculum Requests</h2>
            <p className="text-slate-500">View what users are explicitly requesting for their profile.</p>
          </div>
          <button 
            onClick={fetchCurriculumRequests}
            disabled={isLoadingRequests}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw size={18} className={isLoadingRequests ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {isLoadingRequests ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-slate-400" size={32} />
          </div>
        ) : curriculumRequests.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            No curriculum requests yet.
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400 text-sm border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="p-4 font-semibold">User</th>
                    <th className="p-4 font-semibold">Department</th>
                    <th className="p-4 font-semibold">Level & Semester</th>
                    <th className="p-4 font-semibold">Status</th>
                    <th className="p-4 font-semibold">Requested At</th>
                    <th className="p-4 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {(curriculumRequests || []).map((req) => (
                    <tr key={req.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="p-4">
                        <div className="font-medium text-slate-900 dark:text-white">{req.email}</div>
                      </td>
                      <td className="p-4 text-slate-700 dark:text-slate-300">
                        {req.department}
                      </td>
                      <td className="p-4 text-slate-700 dark:text-slate-300">
                        {req.level} Level, {req.semester}
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 text-xs font-bold rounded-full ${
                          req.status === 'fulfilled' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                          req.status === 'in_progress' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                          'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}>
                          {req.status === 'fulfilled' ? 'Fulfilled' : req.status === 'in_progress' ? 'In Progress' : 'Pending'}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-slate-500">
                        {req.timestamp?.toDate ? new Date(req.timestamp.toDate()).toLocaleString() : 'Recent'}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => handleFastTrackAIBuild(req)}
                            className="p-2 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                            title="AI Build Fast-Track"
                          >
                            <Zap size={18} />
                          </button>
                          {req.status !== 'fulfilled' && (
                            <button 
                              onClick={() => handleMarkFulfilled(req)}
                              className="p-2 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                              title="Mark as Fulfilled"
                            >
                              <CheckCircle size={18} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderCurriculumHealth = () => {
    // Group issues by dept and level
    const heatmapData: Record<string, Record<string, number>> = {};
    DEPARTMENTS.forEach(dept => {
      heatmapData[dept] = {};
      LEVELS.forEach(level => {
        heatmapData[dept][level] = 0;
      });
    });

    integrityIssues.forEach((issue: any) => {
      if (heatmapData[issue.department] && heatmapData[issue.department][issue.level] !== undefined) {
        heatmapData[issue.department][issue.level]++;
      }
    });

    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Curriculum Health Monitor</h2>
            <p className="text-slate-500">Real-time alignment heatmap across departments and levels</p>
          </div>
          <button 
            onClick={fetchIntegrityData}
            disabled={isLoadingIntegrity}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-50 shadow-lg shadow-indigo-500/20"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingIntegrity ? 'animate-spin' : ''}`} />
            Refresh Scan
          </button>
        </div>

        {/* Heatmap Grid */}
        <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-sm overflow-x-auto">
          <div className="min-w-[800px]">
            <div 
              className="grid gap-4 mb-6"
              style={{ gridTemplateColumns: `200px repeat(${LEVELS.length}, 1fr)` }}
            >
              <div className="font-bold text-slate-400 text-xs uppercase tracking-widest text-left">Department</div>
              {LEVELS.map(level => (
                <div key={level} className="text-center font-bold text-slate-400 text-xs uppercase tracking-widest">
                  Level {level}
                </div>
              ))}
            </div>

            {DEPARTMENTS.map(dept => (
              <div 
                key={dept} 
                className="grid gap-4 mb-4"
                style={{ gridTemplateColumns: `200px repeat(${LEVELS.length}, 1fr)` }}
              >
                <div className="flex items-center font-bold text-slate-700 dark:text-slate-300 text-sm">{dept}</div>
                {LEVELS.map(level => {
                  const count = heatmapData[dept][level];
                  let bgColor = 'bg-slate-50 dark:bg-slate-900/50';
                  let textColor = 'text-slate-400';
                  let borderColor = 'border-slate-100 dark:border-slate-800';

                  if (count > 10) {
                    bgColor = 'bg-rose-50 dark:bg-rose-900/20';
                    textColor = 'text-rose-600 dark:text-rose-400';
                    borderColor = 'border-rose-200 dark:border-rose-800';
                  } else if (count > 5) {
                    bgColor = 'bg-amber-50 dark:bg-amber-900/20';
                    textColor = 'text-amber-600 dark:text-amber-400';
                    borderColor = 'border-amber-200 dark:border-amber-800';
                  } else if (count > 0) {
                    bgColor = 'bg-yellow-50 dark:bg-yellow-900/10';
                    textColor = 'text-yellow-600 dark:text-yellow-400';
                    borderColor = 'border-yellow-200 dark:border-yellow-800';
                  } else {
                    bgColor = 'bg-emerald-50 dark:bg-emerald-900/10';
                    textColor = 'text-emerald-600 dark:text-emerald-400';
                    borderColor = 'border-emerald-100 dark:border-emerald-800';
                  }

                  return (
                    <button
                      key={level}
                      onClick={() => setSelectedIssueCell({ dept, level })}
                      className={`h-20 rounded-2xl border ${borderColor} ${bgColor} ${textColor} flex flex-col items-center justify-center transition-all hover:scale-105 hover:shadow-lg relative group`}
                    >
                      <span className="text-2xl font-black">{count}</span>
                      <span className="text-[10px] uppercase font-bold opacity-60">Issues</span>
                      {count > 0 && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full animate-pulse border-2 border-white dark:border-slate-800" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Drill-down Section */}
        <AnimatePresence>
          {selectedIssueCell && (
            <motion.div 
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="bg-white dark:bg-slate-800 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden"
            >
              <div className="p-6 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-800 flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-indigo-100 dark:bg-indigo-800 rounded-2xl text-indigo-600 dark:text-indigo-400">
                    <Search className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-black text-indigo-900 dark:text-indigo-100 text-lg">
                      Diagnostics: {selectedIssueCell.dept} - Level {selectedIssueCell.level}
                    </h3>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-widest">
                      {integrityIssues.filter((i: any) => i.department === selectedIssueCell.dept && i.level === selectedIssueCell.level).length} active issues detected
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {selectedIssues.length > 0 && (
                    <button
                      onClick={handleBulkRemediate}
                      disabled={isRemediating}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                    >
                      {isRemediating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                      Fix Selected ({selectedIssues.length})
                    </button>
                  )}
                  <button 
                    onClick={() => {
                      setSelectedIssueCell(null);
                      setSelectedIssues([]);
                    }}
                    className="p-2 hover:bg-indigo-100 dark:hover:bg-indigo-800 rounded-full text-indigo-400 transition-colors"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>

              <div className="p-8">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 dark:border-slate-700">
                        <th className="pb-4 px-4">
                          <input 
                            type="checkbox"
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            checked={selectedIssues.length === integrityIssues.filter((i: any) => i.department === selectedIssueCell.dept && i.level === selectedIssueCell.level).length && selectedIssues.length > 0}
                            onChange={(e) => {
                              const cellIssues = integrityIssues.filter((i: any) => i.department === selectedIssueCell.dept && i.level === selectedIssueCell.level);
                              if (e.target.checked) {
                                setSelectedIssues(cellIssues.map((i: any) => i.id));
                              } else {
                                setSelectedIssues([]);
                              }
                            }}
                          />
                        </th>
                        <th className="pb-4 px-4">Student</th>
                        <th className="pb-4 px-4">Issue Type</th>
                        <th className="pb-4 px-4">Details</th>
                        <th className="pb-4 px-4">Detected</th>
                        <th className="pb-4 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
                      {integrityIssues
                        .filter((i: any) => i.department === selectedIssueCell.dept && i.level === selectedIssueCell.level)
                        .map((issue: any) => (
                          <tr key={issue.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors group">
                            <td className="py-5 px-4">
                              <input 
                                type="checkbox"
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                checked={selectedIssues.includes(issue.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedIssues(prev => [...prev, issue.id]);
                                  } else {
                                    setSelectedIssues(prev => prev.filter(id => id !== issue.id));
                                  }
                                }}
                              />
                            </td>
                            <td className="py-5 px-4">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-400 font-black text-sm">
                                  {issue.userName?.charAt(0) || 'U'}
                                </div>
                                <div>
                                  <div className="font-bold text-slate-900 dark:text-white">{issue.userName}</div>
                                  <div className="text-xs text-slate-500 font-medium">{issue.userEmail}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-5 px-4">
                              <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                issue.type === 'MISSING_COURSE' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' :
                                issue.type === 'EXTRA_COURSE' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                                'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400'
                              }`}>
                                {issue.type ? String(issue.type).replace(/_/g, ' ') : 'ISSUE'}
                              </span>
                            </td>
                            <td className="py-5 px-4">
                              <div className="text-sm text-slate-600 dark:text-slate-300 max-w-xs font-medium">
                                {issue.details}
                              </div>
                            </td>
                            <td className="py-5 px-4 text-xs text-slate-500 font-mono">
                              {issue.timestamp?.toDate ? issue.timestamp.toDate().toLocaleString() : new Date(issue.timestamp).toLocaleString()}
                            </td>
                            <td className="py-5 px-4 text-right">
                              <button 
                                onClick={() => handleRemediate(issue)}
                                disabled={isRemediating}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-50 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-800 transition-all font-bold text-xs disabled:opacity-50"
                              >
                                {isRemediating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                                Fix Now
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-900 p-3 sm:p-6 lg:p-8 pb-16 transition-colors min-h-screen">
      <div className="w-full max-w-7xl 2xl:max-w-[1600px] mx-auto space-y-6 sm:space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <button 
              onClick={() => window.location.href = '/'}
              className="flex items-center gap-2 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 mb-4 transition-colors font-medium text-sm"
            >
              <ArrowLeft size={16} />
              Back to App
            </button>
            <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
              🎓 Admin Dashboard
              <span className={`text-[10px] px-2 py-1 rounded-lg border uppercase tracking-widest ${
                isAdmin ? 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800' :
                isTutor ? 'bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800' :
                isModerator ? 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800' :
                'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900/20 dark:text-slate-400 dark:border-slate-800'
              }`}>
                {userRole}
              </span>
              <button 
                onClick={() => setIsRoleGuideOpen(true)}
                className="text-[10px] px-2 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-zinc-700 transition-colors uppercase tracking-widest"
              >
                Role Guide
              </button>
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2">
              Phase 3: The Command Center — Global Analytics & Content Control.
            </p>
          </div>
          
          {/* Quick Stats */}
          <div className="flex gap-4">
            <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 flex items-center gap-3">
              <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg text-blue-600 dark:text-blue-400">
                <Users size={20} />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white">{users.length}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase">Users</div>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 flex items-center gap-3">
              <div className="bg-emerald-100 dark:bg-emerald-900/30 p-2 rounded-lg text-emerald-600 dark:text-emerald-400">
                <BookOpen size={20} />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white">{Object.keys(courses).length}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase">Courses</div>
              </div>
            </div>
          </div>
        </div>

        {/* Phase 3 Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {[
            { id: 'overview', label: 'Overview', icon: Activity, show: true },
            { id: 'demo-studio', label: '🎬 Marketing & Demo Studio', icon: Video, show: true },
            { id: 'api-status', label: 'API Status', icon: Activity, show: permissions.canManageSystem },
            { id: 'analytics', label: 'Platform Analytics', icon: BarChart3, show: true },
            { id: 'courses', label: 'Courses & AI', icon: BookOpen, show: permissions.canManageCourses },
            { id: 'question-bank', label: 'Question Bank', icon: FileQuestion, show: permissions.canManageCourses },
            { id: 'rag', label: 'Knowledge Base', icon: Database, show: permissions.canManageCourses },
            { id: 'curriculum-manager', label: 'Curriculum Manager', icon: Layers, show: permissions.canManageCurriculum },
            { id: 'curriculum-health', label: 'Curriculum Health', icon: HeartPulse, show: permissions.canManageCurriculum },
            { id: 'curriculum-requests', label: 'Curriculum Requests', icon: MessageSquare, show: permissions.canManageCurriculum },
            { id: 'users', label: 'User Management', icon: Users, show: permissions.canManageUsers },
            { id: 'affiliates', label: 'Affiliates', icon: Share2, show: permissions.canManageUsers },
            { id: 'pricing', label: 'Pricing & Plans', icon: CreditCard, show: permissions.canManageSystem },
            { id: 'db-accounting', label: 'Database & Accounting', icon: Landmark, show: permissions.canManageSystem },
            { id: 'database-engine', label: 'Database Engine', icon: Database, show: permissions.canManageSystem },
            { id: 'challenges', label: 'Quests & Arena', icon: Trophy, show: permissions.canManageSystem || permissions.canManageCourses },
            { id: 'support', label: 'Support & FAQs', icon: HelpCircle, show: permissions.canManageSystem || permissions.canCommunicate },
            { id: 'formulas', label: 'Formula Library', icon: BookOpen, show: permissions.canManageCourses },
            { id: 'math-engine', label: 'Math & MCP Engine', icon: Calculator, show: permissions.canManageSystem || permissions.canManageCourses },
            { id: 'academic-mcp', label: 'Academic Research MCP', icon: BookOpen, show: permissions.canManageSystem || permissions.canManageCourses },
            { id: 'golden-set', label: 'Golden Set & Trust', icon: Shield, show: permissions.canManageSystem || permissions.canManageCourses || permissions.isTutor },
            { id: 'feature-switches', label: 'Feature Switches', icon: ToggleRight, show: permissions.canManageSystem },
            { id: 'communications', label: 'Communications', icon: Globe, show: permissions.canCommunicate },
            { id: 'logs', label: 'System Logs', icon: FileText, show: permissions.canViewLogs },
            { id: 'settings', label: 'Command Center', icon: Shield, show: permissions.canManageSystem }
          ].filter(tab => tab.show).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-sm transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-lg'
                  : 'bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
              }`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Real-time System Alerts Banner */}
            {(systemAlerts || []).length > 0 && (
              <div className="space-y-3">
                {(systemAlerts || []).map(alert => (
                  <div 
                    key={alert.id}
                    className={`p-4 rounded-2xl border flex items-center justify-between gap-4 transition-all shadow-sm ${
                      alert.severity === 'error' 
                        ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300'
                        : alert.severity === 'warning'
                        ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300'
                        : 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {alert.severity === 'error' ? (
                        <AlertCircle size={20} className="text-rose-600 dark:text-rose-400 shrink-0" />
                      ) : alert.severity === 'warning' ? (
                        <AlertCircle size={20} className="text-amber-600 dark:text-amber-400 shrink-0" />
                      ) : (
                        <Activity size={20} className="text-blue-600 dark:text-blue-400 shrink-0" />
                      )}
                      <div>
                        <h4 className="text-sm font-bold">{alert.title || 'System Notification'}</h4>
                        <p className="text-xs opacity-90 mt-0.5">{alert.message}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDismissAlert(alert.id)}
                      className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-xs font-bold transition-all shrink-0"
                      title="Dismiss Alert"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Top Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Stat Card 1 */}
              <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-sm border border-slate-200 dark:border-slate-700 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Zap size={64} />
                </div>
                <div className="bg-amber-100 dark:bg-amber-900/30 w-12 h-12 rounded-2xl flex items-center justify-center text-amber-600 dark:text-amber-400 mb-6">
                  <Zap size={24} fill="currentColor" />
                </div>
                <div className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">{systemStats.totalSparksConsumed.toLocaleString()}</div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-2">Sparks Consumed</div>
                <div className="mt-6 flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <Activity size={16} />
                  <span>Real-time usage</span>
                </div>
              </div>

              {/* Stat Card 2 */}
              <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-sm border border-slate-200 dark:border-slate-700 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Bot size={64} />
                </div>
                <div className="bg-blue-100 dark:bg-blue-900/30 w-12 h-12 rounded-2xl flex items-center justify-center text-blue-600 dark:text-blue-400 mb-6">
                  <Bot size={24} />
                </div>
                <div className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">{systemStats.totalQuestionsAsked.toLocaleString()}</div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-2">AI Interactions</div>
                <div className="mt-6 flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <Activity size={16} />
                  <span>Live telemetry</span>
                </div>
              </div>

              {/* Stat Card 3 */}
              <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-sm border border-slate-200 dark:border-slate-700 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Trophy size={64} />
                </div>
                <div className="bg-emerald-100 dark:bg-emerald-900/30 w-12 h-12 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-6">
                  <Trophy size={24} />
                </div>
                <div className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">{systemStats.averageMastery}%</div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-2">Avg. Student Mastery</div>
                <div className="mt-6 h-2 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${systemStats.averageMastery}%` }} />
                </div>
              </div>

              {/* Stat Card 4 */}
              <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-sm border border-slate-200 dark:border-slate-700 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Users size={64} />
                </div>
                <div className="bg-indigo-100 dark:bg-indigo-900/30 w-12 h-12 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-6">
                  <Users size={24} />
                </div>
                <div className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">{users.length.toLocaleString()}</div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-2">Total Users</div>
                <div className="mt-6 flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <Activity size={16} />
                  <span>Active platform</span>
                </div>
              </div>

              {/* Stat Card 5 */}
              <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-sm border border-slate-200 dark:border-slate-700 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Star size={64} />
                </div>
                <div className="bg-purple-100 dark:bg-purple-900/30 w-12 h-12 rounded-2xl flex items-center justify-center text-purple-600 dark:text-purple-400 mb-6">
                  <Star size={24} />
                </div>
                <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tight truncate" title={systemStats.popularCourse}>{systemStats.popularCourse}</div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-2">Trending Course</div>
                <div className="mt-6 flex items-center gap-2 text-sm font-medium text-purple-600 dark:text-purple-400">
                  <Users size={16} />
                  <span>High enrollment</span>
                </div>
              </div>
            </div>

            {/* Main Charts & Data Grid Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Global Charts Section */}
              <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Activity className="text-blue-500" size={24} />
                      AI Request Volume
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Real-time token and request metrics across providers.</p>
                  </div>
                  <div className="flex flex-wrap gap-4 bg-slate-50 dark:bg-slate-900/50 p-2 rounded-2xl border border-slate-100 dark:border-slate-700/50">
                    <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-xs font-bold text-slate-600 dark:text-slate-300">
                      <div className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Groq
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-xs font-bold text-slate-600 dark:text-slate-300">
                      <div className="w-2.5 h-2.5 rounded-full bg-purple-500" /> Mistral
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-xs font-bold text-slate-600 dark:text-slate-300">
                      <div className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Gemini
                    </div>
                  </div>
                </div>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={aiChartData.length > 0 ? aiChartData : [
                      { time: '00:00', groq: 0, mistral: 0, gemini: 0 },
                      { time: '04:00', groq: 0, mistral: 0, gemini: 0 },
                      { time: '08:00', groq: 0, mistral: 0, gemini: 0 },
                      { time: '12:00', groq: 0, mistral: 0, gemini: 0 },
                      { time: '16:00', groq: 0, mistral: 0, gemini: 0 },
                      { time: '20:00', groq: 0, mistral: 0, gemini: 0 },
                      { time: '23:59', groq: 0, mistral: 0, gemini: 0 },
                    ]}>
                      <defs>
                        <linearGradient id="colorGroq" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorMistral" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a855f7" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorGemini" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.5} />
                      <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 600 }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 600 }} dx={-10} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', backgroundColor: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(8px)' }}
                        itemStyle={{ fontWeight: 600 }}
                      />
                      <Area type="monotone" dataKey="groq" stroke="#f97316" fillOpacity={1} fill="url(#colorGroq)" strokeWidth={3} activeDot={{ r: 6, strokeWidth: 0 }} />
                      <Area type="monotone" dataKey="mistral" stroke="#a855f7" fillOpacity={1} fill="url(#colorMistral)" strokeWidth={3} activeDot={{ r: 6, strokeWidth: 0 }} />
                      <Area type="monotone" dataKey="gemini" stroke="#3b82f6" fillOpacity={1} fill="url(#colorGemini)" strokeWidth={3} activeDot={{ r: 6, strokeWidth: 0 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Struggle Heatmap */}
              <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col">
                <div className="mb-6">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <AlertCircle className="text-rose-500" size={24} />
                    Struggle Heatmap
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Topics requiring intervention.</p>
                </div>
                
                <div className="flex-1 space-y-5 overflow-y-auto pr-2 custom-scrollbar">
                  {(struggleAnalytics || []).length > 0 ? (
                    (struggleAnalytics || []).map((item, idx) => (
                      <div key={idx} className="group">
                        <div className="flex justify-between text-sm mb-2">
                          <span className="font-bold text-slate-700 dark:text-slate-300 truncate pr-4">{item.subTopicTitle}</span>
                          <span className="text-rose-500 font-black whitespace-nowrap bg-rose-50 dark:bg-rose-900/20 px-2 py-0.5 rounded-md">{item.count} hits</span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 dark:bg-slate-700/50 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-rose-400 to-rose-600 rounded-full transition-all duration-1000 group-hover:opacity-80" 
                            style={{ width: `${Math.min((item.count / (struggleAnalytics[0]?.count || 1)) * 100, 100)}%` }} 
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3">
                      <div className="w-16 h-16 rounded-full bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center border border-slate-100 dark:border-slate-700">
                        <CheckCircle className="text-emerald-500" size={24} />
                      </div>
                      <p className="text-sm font-medium">No struggle data detected.</p>
                    </div>
                  )}
                </div>
                
                <button 
                  onClick={() => setActiveTab('analytics')}
                  className="w-full mt-6 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-all border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-2"
                >
                  <BarChart3 size={18} />
                  Full Analytics Report
                </button>
              </div>
            </div>

            {/* System Health & Recent Activity Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* System Health */}
              <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                  <Shield className="text-emerald-500" size={24} />
                  System Health
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700/50">
                    <div className="text-sm font-bold text-slate-500 mb-1">API Latency</div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white flex items-baseline gap-1">
                      {aiMetrics?.avgLatencyMs
                        ? (Number(aiMetrics.avgLatencyMs) / 1000).toFixed(2)
                        : (aiMetrics?.latency
                            ? String(aiMetrics.latency).replace('s', '')
                            : '0.1')}
                      <span className="text-sm font-bold text-slate-400">s</span>
                    </div>
                    <div className="mt-2 text-xs font-bold text-emerald-500 flex items-center gap-1"><Activity size={12}/> Optimal</div>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700/50">
                    <div className="text-sm font-bold text-slate-500 mb-1">Uptime</div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white flex items-baseline gap-1">
                      {aiMetrics?.successRate != null
                        ? Number(aiMetrics.successRate).toFixed(1)
                        : (aiMetrics?.uptime
                            ? String(aiMetrics.uptime).replace('%', '')
                            : '99.9')}
                      <span className="text-sm font-bold text-slate-400">%</span>
                    </div>
                    <div className="mt-2 text-xs font-bold text-emerald-500 flex items-center gap-1"><CheckCircle size={12}/> All systems operational</div>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700/50">
                    <div className="text-sm font-bold text-slate-500 mb-1">Active Users</div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white flex items-baseline gap-1">
                      {userStats.activeToday || 0}
                    </div>
                    <div className="mt-2 text-xs font-bold text-blue-500 flex items-center gap-1"><Users size={12}/> Active in last 24h</div>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700/50">
                    <div className="text-sm font-bold text-slate-500 mb-1">Database Load</div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white flex items-baseline gap-1">
                      {Math.min(Math.floor((users.length + Object.keys(courses).length) / 10), 45)}<span className="text-sm font-bold text-slate-400">%</span>
                    </div>
                    <div className="mt-2 text-xs font-bold text-emerald-500 flex items-center gap-1"><Database size={12}/> Healthy</div>
                  </div>
                </div>
              </div>

              {/* Recent Activity Feed */}
              <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Clock className="text-indigo-500" size={24} />
                    Recent Activity
                  </h3>
                  <button onClick={() => setActiveTab('logs')} className="text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:underline">
                    View All
                  </button>
                </div>
                <div className="space-y-0 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 dark:before:via-slate-700 before:to-transparent">
                  {logs.slice(0, 5).map((log, idx) => (
                    <div key={idx} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active py-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white dark:border-slate-800 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                        {log.level === 'error' ? <AlertCircle size={16} className="text-rose-500" /> : 
                         log.level === 'success' ? <CheckCircle size={16} className="text-emerald-500" /> : 
                         <Activity size={16} className="text-blue-500" />}
                      </div>
                      <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-sm">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-slate-900 dark:text-white text-sm capitalize">{log.category}</span>
                          <span className="text-[10px] font-bold text-slate-400">{log.timestamp?.toDate ? log.timestamp.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Just now'}</span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{log.message}</p>
                      </div>
                    </div>
                  ))}
                  {logs.length === 0 && (
                    <div className="text-center py-8 text-sm font-medium text-slate-400">
                      No recent activity to display.
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

        {activeTab === 'courses' && (
          <div className="space-y-8">
            {/* Quick AI Generator Section */}
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-4 mb-6">
                <div className="bg-indigo-100 dark:bg-indigo-500/20 p-3 rounded-2xl">
                  <Zap className="text-indigo-600 dark:text-indigo-400" size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Infinite Lesson Engine</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Iterative, high-fidelity university course generation.</p>
                </div>
              </div>

              {/* AI Provider Selection */}
              <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                  <Bot size={16} className="text-indigo-500" />
                  Select AI Provider
                </h3>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => setAiProvider('gemini_direct')}
                    className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                      aiProvider === 'gemini_direct'
                        ? 'bg-blue-100 text-blue-700 border-2 border-blue-500 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'bg-white text-slate-600 border-2 border-slate-200 hover:border-blue-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 dark:hover:border-blue-700'
                    }`}
                  >
                    <Shield size={16} />
                    Gemini
                  </button>
                  <button
                    onClick={() => setAiProvider('groq')}
                    className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                      aiProvider === 'groq'
                        ? 'bg-orange-100 text-orange-700 border-2 border-orange-500 dark:bg-orange-900/30 dark:text-orange-400'
                        : 'bg-white text-slate-600 border-2 border-slate-200 hover:border-orange-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 dark:hover:border-orange-700'
                    }`}
                  >
                    <Zap size={16} />
                    Groq (Turbo)
                  </button>
                  <button
                    onClick={() => setAiProvider('mistral_direct')}
                    className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                      aiProvider === 'mistral_direct'
                        ? 'bg-purple-100 text-purple-700 border-2 border-purple-500 dark:bg-purple-900/30 dark:text-purple-400'
                        : 'bg-white text-slate-600 border-2 border-slate-200 hover:border-purple-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 dark:hover:border-purple-700'
                    }`}
                  >
                    <Star size={16} />
                    Mistral
                  </button>
                  <button
                    onClick={() => setAiProvider('openrouter_free')}
                    className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                      aiProvider === 'openrouter_free'
                        ? 'bg-indigo-100 text-indigo-700 border-2 border-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-400'
                        : 'bg-white text-slate-600 border-2 border-slate-200 hover:border-indigo-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 dark:hover:border-indigo-700'
                    }`}
                  >
                    <Zap size={16} />
                    OpenRouter
                  </button>
                  <button
                    onClick={() => setAiProvider('cohere')}
                    className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                      aiProvider === 'cohere'
                        ? 'bg-emerald-100 text-emerald-700 border-2 border-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-white text-slate-600 border-2 border-slate-200 hover:border-emerald-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 dark:hover:border-emerald-700'
                    }`}
                  >
                    <Bot size={16} />
                    Cohere
                  </button>
                  <button
                    onClick={() => setAiProvider('huggingface')}
                    className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                      aiProvider === 'huggingface'
                        ? 'bg-yellow-100 text-yellow-700 border-2 border-yellow-500 dark:bg-yellow-900/30 dark:text-yellow-400'
                        : 'bg-white text-slate-600 border-2 border-slate-200 hover:border-yellow-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 dark:hover:border-yellow-700'
                    }`}
                  >
                    <Bot size={16} />
                    Hugging Face
                  </button>
                  <button
                    onClick={() => setAiProvider('nvidia')}
                    className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                      aiProvider === 'nvidia'
                        ? 'bg-emerald-100 text-emerald-700 border-2 border-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-white text-slate-600 border-2 border-slate-200 hover:border-emerald-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 dark:hover:border-emerald-700'
                    }`}
                  >
                    <Cpu size={16} />
                    NVIDIA NIM
                  </button>
                </div>
              </div>

              {generationStep === 'input' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Course Code</label>
                      <input 
                        type="text" 
                        placeholder="e.g., PHY 102" 
                        value={quickCourseCode}
                        onChange={(e) => setQuickCourseCode(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Course Title</label>
                      <input 
                        type="text" 
                        placeholder="e.g., Electricity and Magnetism" 
                        value={quickCourseName}
                        onChange={(e) => setQuickCourseName(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Tone & Style</label>
                      <select 
                        value={quickTone}
                        onChange={(e) => setQuickTone(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="academic">Strictly Academic</option>
                        <option value="engaging">Engaging & Story-driven</option>
                        <option value="technical">Highly Technical/Formal</option>
                        <option value="simplified">Simplified for Beginners</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Content Depth</label>
                      <select 
                        value={quickDepth}
                        onChange={(e) => setQuickDepth(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="introductory">Introductory (Foundational)</option>
                        <option value="standard">Standard (Comprehensive)</option>
                        <option value="deep-dive">Deep Dive (Advanced/Analytical)</option>
                      </select>
                    </div>
                  </div>

                  <div className="mb-6">
                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Academic Standard & Curriculum Framework
                    </label>
                    <select 
                      value={quickAcademicStandard}
                      onChange={(e) => setQuickAcademicStandard(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="Globally Adaptive (Universal University Standard)">Globally Adaptive (Universal University Standard)</option>
                      <option value="International Higher Education Curriculum Standard">International Higher Education Curriculum Standard</option>
                      <option value="Global Accreditation & Outcomes-Based Framework">Global Accreditation & Outcomes-Based Framework</option>
                      <option value="North American University Benchmark (ABET/CSAB Aligned)">North American University Benchmark (ABET/CSAB Aligned)</option>
                      <option value="European Higher Education Area / Bologna Process">European Higher Education Area / Bologna Process</option>
                      <option value="Commonwealth Higher Education Quality Framework">Commonwealth Higher Education Quality Framework</option>
                      <option value="Custom Academic Benchmark">Custom Academic Benchmark (Enter Custom Standard)...</option>
                    </select>

                    {quickAcademicStandard === 'Custom Academic Benchmark' && (
                      <div className="mt-3">
                        <input
                          type="text"
                          placeholder="e.g., University of Oxford / Cambridge Tripos Syllabus, IEEE/ACM 2023 Curriculum"
                          value={customAcademicStandard}
                          onChange={(e) => setCustomAcademicStandard(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-indigo-300 dark:border-indigo-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          Specify any accredited institutional, national, or international curriculum standard. The AI dynamically adapts modules, lessons, and quizzes to match.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="mb-6">
                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Source Grounding (Optional)</label>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-all"
                      >
                        <Upload size={16} />
                        {sourceFile ? sourceFile.name : 'Upload Syllabus/Textbook (.txt, .md, .pdf)'}
                      </button>
                      {sourceFile && (
                        <button 
                          onClick={() => { setSourceFile(null); setSourceText(''); }}
                          className="text-red-500 hover:text-red-600"
                        >
                          <X size={16} />
                        </button>
                      )}
                      <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleSourceFileChange}
                        accept=".txt,.md,application/pdf"
                        className="hidden"
                      />
                    </div>
                    {pdfProcessingProgress !== null && (
                      <div className="mt-2 p-2 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300">Extracting PDF text...</span>
                          <span className="text-[10px] font-bold text-amber-500">{pdfProcessingProgress}%</span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1">
                          <div 
                            className="bg-amber-500 h-1 rounded-full transition-all duration-300" 
                            style={{ width: `${pdfProcessingProgress}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                    <p className="text-[10px] text-slate-500 mt-1 italic">
                      {isReadingFile ? 'Reading file...' : sourceFile ? 'File loaded! AI will prioritize this content.' : 'Upload a file to ground the AI generation in specific source material.'}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Course Scope</label>
                      <select 
                        value={courseScope}
                        onChange={(e) => setCourseScope(e.target.value as CourseScope)}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="GLOBAL">Global (All Students)</option>
                        <option value="FACULTY">Faculty-wide</option>
                        <option value="DEPARTMENT">Specific Departments</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Level</label>
                      <select 
                        value={quickLevel}
                        onChange={(e) => setQuickLevel(e.target.value as Level)}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        {LEVELS.map(level => (
                          <option key={level} value={level}>{level}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Semester</label>
                      <select 
                        value={quickSemester}
                        onChange={(e) => setQuickSemester(e.target.value as Semester)}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        {SEMESTERS.map(sem => (
                          <option key={sem} value={sem}>{sem}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {courseScope === 'FACULTY' && (
                    <div className="mb-6 animate-in fade-in slide-in-from-top-2">
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Select Target Faculties</label>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {FACULTIES.map(faculty => (
                          <button
                            key={faculty}
                            onClick={() => {
                              if (selectedFaculties.includes(faculty)) {
                                setSelectedFaculties(selectedFaculties.filter(f => f !== faculty));
                              } else {
                                setSelectedFaculties([...selectedFaculties, faculty]);
                              }
                            }}
                            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                              selectedFaculties.includes(faculty)
                                ? 'bg-indigo-100 border-indigo-300 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300'
                                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
                            }`}
                          >
                            {faculty}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {courseScope === 'DEPARTMENT' && (
                    <div className="mb-6 animate-in fade-in slide-in-from-top-2">
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">Select Target Departments</label>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setSelectedDepartments([...DEPARTMENTS])}
                            className="text-xs font-bold text-indigo-600 hover:text-indigo-700"
                          >
                            Select All
                          </button>
                          <button 
                            onClick={() => setSelectedDepartments([])}
                            className="text-xs font-bold text-slate-500 hover:text-slate-600"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-96 overflow-y-auto p-1">
                        {DEPARTMENTS.map(dept => (
                          <button
                            key={dept}
                            onClick={() => {
                              if (selectedDepartments.includes(dept as Department)) {
                                setSelectedDepartments(selectedDepartments.filter(d => d !== dept));
                              } else {
                                setSelectedDepartments([...selectedDepartments, dept as Department]);
                              }
                            }}
                            className={`px-3 py-2 rounded-lg text-xs font-medium text-left transition-all border ${
                              selectedDepartments.includes(dept as Department)
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/20 dark:border-indigo-800 dark:text-indigo-400'
                                : 'bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
                            }`}
                          >
                            {dept}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mb-6">
                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Course Outline / Syllabus (Optional)</label>
                    <textarea 
                      placeholder="Paste a course outline or syllabus here to guide the AI generation..." 
                      value={quickCourseOutline}
                      onChange={(e) => setQuickCourseOutline(e.target.value)}
                      rows={4}
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    />
                  </div>

                  <button
                    onClick={handleGenerateSkeleton}
                    disabled={isGeneratingSkeleton}
                    className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all ${
                      isGeneratingSkeleton 
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 active:scale-[0.98]'
                    }`}
                  >
                    {isGeneratingSkeleton ? (
                      <>
                        <Loader2 className="animate-spin" size={20} />
                        <span>Brainstorming Structure...</span>
                      </>
                    ) : (
                      <>
                        <Zap size={20} />
                        <span>Generate Course Structure</span>
                      </>
                    )}
                  </button>
                </>
              )}

              {generationStep === 'skeleton' && courseSkeleton && (
                <div className="space-y-6">
                  <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-800">
                    <h3 className="font-bold text-indigo-900 dark:text-indigo-100 flex items-center gap-2">
                      <CheckCircle size={18} />
                      Course Structure Brainstormed
                    </h3>
                    <p className="text-sm text-indigo-700 dark:text-indigo-300 mt-1">
                      Review the modules and lesson titles below. You can edit them manually if needed before generating full content.
                    </p>
                  </div>

                  <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {(courseSkeleton?.modules || []).map((module: any, mIdx: number) => (
                      <div key={mIdx} className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                        <MathEditableInput 
                          value={module?.title || ''}
                          onChange={(val) => {
                            const newSkeleton = { ...courseSkeleton };
                            newSkeleton.modules[mIdx].title = val;
                            setCourseSkeleton(newSkeleton);
                          }}
                          className="w-full bg-transparent font-bold text-slate-900 dark:text-white mb-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1"
                        />
                        <div className="pl-4 space-y-1 border-l-2 border-slate-200 dark:border-slate-700">
                          {(module?.lessonTitles || []).map((lesson: string, lIdx: number) => (
                            <MathEditableInput 
                              key={lIdx}
                              value={lesson}
                              onChange={(val) => {
                                const newSkeleton = { ...courseSkeleton };
                                newSkeleton.modules[mIdx].lessonTitles[lIdx] = val;
                                setCourseSkeleton(newSkeleton);
                              }}
                              className="w-full bg-transparent text-sm text-slate-600 dark:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1"
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-4">
                    <button
                      onClick={() => setGenerationStep('input')}
                      className="flex-1 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      Back to Input
                    </button>
                    <button
                      onClick={() => handleFinalizeGeneration()}
                      className="flex-[2] py-3 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      <Zap size={18} />
                      Generate Full Content
                    </button>
                  </div>
                </div>
              )}

              {generationStep === 'generating' && (
                <div className="py-8 text-center space-y-6">
                  <div className="relative w-32 h-32 mx-auto">
                    <div className="absolute inset-0 border-4 border-indigo-100 dark:border-indigo-900 rounded-full" />
                    <div 
                      className="absolute inset-0 border-4 border-indigo-600 rounded-full transition-all duration-500"
                      style={{ 
                        clipPath: `inset(${100 - Math.max(5, generationProgress)}% 0 0 0)`,
                        transform: 'rotate(-90deg)'
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center flex-col">
                      <span className="text-2xl font-black text-slate-900 dark:text-white">{generationProgress}%</span>
                      {generationJobDetails.elapsedSeconds !== undefined && (
                        <span className="text-[10px] font-mono text-slate-400">
                          {Math.floor(generationJobDetails.elapsedSeconds / 60)}m {generationJobDetails.elapsedSeconds % 60}s
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">{statusMessage}</h3>
                    
                    {/* Live Server Job Telemetry Card */}
                    <div className="max-w-md mx-auto p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-left space-y-2.5 text-xs shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Active AI Provider:</span>
                        <span className="font-mono px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-bold uppercase">
                          {generationJobDetails.activeProvider || aiProvider}
                        </span>
                      </div>
                      {generationJobDetails.currentModule && (
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-500 dark:text-slate-400">Current Module:</span>
                          <span className="font-medium text-slate-900 dark:text-white truncate max-w-[240px]">
                            {generationJobDetails.currentModule}
                          </span>
                        </div>
                      )}
                      {generationJobDetails.currentLesson && (
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-500 dark:text-slate-400">Current Lesson:</span>
                          <span className="font-medium text-slate-900 dark:text-white truncate max-w-[240px]">
                            {generationJobDetails.currentLesson}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-800">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Lessons Completed:</span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {generationJobDetails.completedLessons || 0} / {generationJobDetails.totalLessons || 0}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="w-full max-w-md mx-auto bg-slate-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-indigo-600 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(5, generationProgress)}%` }}
                    />
                  </div>

                  {!uploadSuccess && (
                    <button
                      onClick={handleCancelGeneration}
                      className="px-6 py-2.5 rounded-xl text-sm font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-900/30 transition-all flex items-center gap-2 mx-auto active:scale-95"
                    >
                      <X size={16} />
                      Cancel Generation
                    </button>
                  )}
                </div>
              )}

              {generationStep === 'error' && (
                <div className="py-8 text-center space-y-6">
                  <div className="bg-red-100 dark:bg-red-900/20 p-6 rounded-3xl inline-block">
                    <AlertCircle size={48} className="text-red-600 dark:text-red-400 mx-auto" />
                  </div>
                  
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Generation Interrupted</h3>
                    <p className="text-sm text-red-500 dark:text-red-400 max-w-md mx-auto">
                      {generationError}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3 justify-center">
                    <button
                      onClick={() => setGenerationStep('input')}
                      className="px-5 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      Back to Start
                    </button>
                    <button
                      onClick={() => handleFinalizeGeneration({ resume: true })}
                      className="px-6 py-3 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20 transition-all active:scale-[0.98] flex items-center gap-2"
                    >
                      <Zap size={18} />
                      Resume Generation (Keep Saved Lessons)
                    </button>
                    <button
                      onClick={() => handleFinalizeGeneration()}
                      className="px-5 py-3 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 transition-all active:scale-[0.98] flex items-center gap-2"
                    >
                      <RefreshCw size={18} />
                      Regenerate From Scratch
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* PDF Upload Section */}
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4 mb-6">
            <div className="bg-amber-100 dark:bg-amber-500/20 p-3 rounded-2xl">
              <Upload className="text-amber-600 dark:text-amber-400" size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">PDF-to-Course AI Pipeline</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Upload a PDF note to automatically generate a structured course syllabus.</p>
            </div>
          </div>

          {!isReviewing && !uploadSuccess && (
            <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Course Code</label>
                <input 
                  type="text" 
                  placeholder="e.g., BIO 101" 
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Course Title</label>
                <input 
                  type="text" 
                  placeholder="e.g., General Biology I" 
                  value={courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Level</label>
                <select
                  value={quickLevel}
                  onChange={(e) => setQuickLevel(e.target.value as any)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="100">100 Level</option>
                  <option value="200">200 Level</option>
                  <option value="300">300 Level</option>
                  <option value="400">400 Level</option>
                  <option value="500">500 Level</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Semester</label>
                <select
                  value={quickSemester}
                  onChange={(e) => setQuickSemester(e.target.value as Semester)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">Select semester...</option>
                  {SEMESTERS.map(sem => (
                    <option key={sem} value={sem}>{sem}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Department</label>
                <select
                  value={quickDepartment}
                  onChange={(e) => setQuickDepartment(e.target.value as Department)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">Select a department...</option>
                  {DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {!isReviewing && (
            <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-2xl p-8 text-center transition-colors hover:border-amber-500 dark:hover:border-amber-400">
              <input 
                type="file" 
                accept="application/pdf" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handleFileSelect}
              />
            
            {!selectedFile && !isUploading && !uploadSuccess && (
              <div className="flex flex-col items-center justify-center gap-4">
                <FileText size={48} className="text-slate-400" />
                <div>
                  <p className="text-slate-700 dark:text-slate-300 font-medium">Drag and drop your PDF here, or</p>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="text-amber-600 dark:text-amber-400 font-bold mt-1 hover:underline"
                  >
                    browse files
                  </button>
                </div>
                <p className="text-xs text-slate-500">Supports PDFs up to 500 pages (Gemini 3.0 Flash Preview)</p>
              </div>
            )}

            {selectedFile && !isUploading && !uploadSuccess && (
              <div className="flex flex-col items-center justify-center gap-4">
                <div className="bg-emerald-100 dark:bg-emerald-500/20 p-4 rounded-full">
                  <FileText size={32} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-slate-900 dark:text-white font-bold">{selectedFile.name}</p>
                  <p className="text-sm text-slate-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <div className="flex gap-3 mt-2">
                  <button 
                    onClick={() => setSelectedFile(null)}
                    className="px-4 py-2 rounded-xl font-bold text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleUpload}
                    className="px-6 py-2 rounded-xl font-bold text-sm bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/30 transition-all active:scale-95"
                  >
                    Extract with AI
                  </button>
                </div>
              </div>
            )}

            {isUploading && (
              <div className="flex flex-col items-center justify-center gap-6 py-4">
                <Loader2 size={48} className="text-amber-500 animate-spin" />
                <div className="w-full max-w-md space-y-2">
                  <div className="flex justify-between text-sm font-bold text-slate-700 dark:text-slate-300">
                    <span>{statusMessage}</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-amber-500 transition-all duration-200 ease-out"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {uploadSuccess && (
              <div className="flex flex-col items-center justify-center gap-4 py-4">
                <div className="bg-emerald-100 dark:bg-emerald-500/20 p-4 rounded-full">
                  <CheckCircle size={48} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">Extraction Complete!</h3>
                  <p className="text-slate-500 mt-1">The course has been successfully structured and saved to the database.</p>
                </div>
                <button 
                  onClick={() => setUploadSuccess(false)}
                  className="mt-4 px-6 py-2 rounded-xl font-bold text-sm bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 transition-all"
                >
                  Upload Another PDF
                </button>
              </div>
            )}

            {statusMessage.startsWith('Error') && !isUploading && (
               <div className="mt-4 p-4 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl flex items-center gap-2 justify-center">
                 <AlertCircle size={20} />
                 <span className="text-sm font-bold">{statusMessage}</span>
               </div>
            )}
          </div>
          )}

          {isReviewing && extractedCourse && (
            <div className="mt-8 border-t border-slate-200 dark:border-slate-700 pt-8">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <CheckCircle className="text-emerald-500" size={20} />
                Review Extracted Content
              </h3>
              
              <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-700 mb-6">
                <div className="mb-6">
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                    Override Existing Course? (Optional)
                  </label>
                  <select 
                    value={overrideCourseId}
                    onChange={(e) => {
                      const newId = e.target.value;
                      setOverrideCourseId(newId);
                      if (newId) {
                        try {
                          const updated = JSON.parse(rawJsonText);
                          updated.id = newId;
                          const newJson = JSON.stringify(updated, null, 2);
                          setRawJsonText(newJson);
                          setExtractedCourse(updated);
                        } catch (err) {
                          console.error("Failed to update ID in JSON:", err);
                        }
                      }
                    }}
                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">-- Create New Course --</option>
                    {Object.values(courses).map(c => (
                      <option key={c.id} value={c.id}>{c.id}: {c.title}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-2">
                    Selecting an existing course will set its ID in the JSON below, overwriting it when you publish.
                  </p>
                </div>

                <p className="text-sm text-slate-500 mb-4">
                  You can manually edit the JSON below to fix typos or replace image placeholders with real image URLs before publishing.
                </p>
                <textarea 
                  className="w-full h-[500px] bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 font-mono p-4 rounded-lg border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  value={rawJsonText}
                  onChange={(e) => {
                    setRawJsonText(e.target.value);
                    try {
                      const updated = JSON.parse(e.target.value);
                      setExtractedCourse(updated);
                    } catch (err) {
                      // Ignore parse errors while typing
                    }
                  }}
                />
              </div>

              <div className="flex gap-4 justify-end">
                <button 
                  onClick={() => {
                    setIsReviewing(false);
                    setExtractedCourse(null);
                    setSelectedFile(null);
                  }}
                  className="px-6 py-2 rounded-xl font-bold text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  Discard
                </button>
                <button 
                  onClick={handlePublishCourse}
                  disabled={isUploading}
                  className="px-6 py-2 rounded-xl font-bold text-sm bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
                >
                  {isUploading ? <Loader2 size={16} className="animate-spin" /> : null}
                  Publish Course
                </button>
              </div>
            </div>
          )}
        </div>

          {/* Existing Courses List */}
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <BookOpen className="text-emerald-500" size={24} />
              {showArchived ? 'Archived Courses' : 'Active Courses'}
            </h2>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setShowArchived(!showArchived)}
                className="text-sm font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
              >
                {showArchived ? 'View Active' : 'View Archived'}
              </button>
              <button 
                onClick={() => setIsCreateCourseModalOpen(true)}
                className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 flex items-center gap-2 shadow-sm"
              >
                <Plus size={16} /> Add New Course
              </button>
            </div>
          </div>

          {isCreateCourseModalOpen && (
            <CourseCreateModal 
              onClose={() => setIsCreateCourseModalOpen(false)} 
              onSave={() => {
                refreshCourses();
                setIsCreateCourseModalOpen(false);
              }} 
            />
          )}

          {selectedCourse && (
            <CourseEditModal 
              course={selectedCourse} 
              onClose={() => setSelectedCourse(null)} 
              onSave={refreshCourses} 
            />
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {isLoadingArchived && showArchived ? (
              <div className="col-span-2 text-center py-8 text-slate-500">Loading archived courses...</div>
            ) : (
              (showArchived ? Object.values(archivedCourses) : Object.values(courses)).map((course) => (
                <div key={course.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 transition-colors flex items-start justify-between group">
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white">{course.title}</h3>
                    <p className="text-sm text-slate-500 mt-1 line-clamp-1">{course.description}</p>
                    <div className="flex items-center gap-3 mt-3">
                      <span className="text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-1 rounded-md">
                        {course.syllabus?.length || 0} Modules
                      </span>
                      <span className={`text-xs font-medium px-2 py-1 rounded-md ${showArchived ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>
                        {showArchived ? 'Archived' : 'Published'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!showArchived && (
                      <>
                        <button 
                          onClick={() => handleEditCourse(course)}
                          className="p-2 text-slate-400 hover:text-emerald-500"
                          title="Edit Course"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button 
                          onClick={() => handleDeleteCourse(course.id)}
                          className="p-2 text-slate-400 hover:text-red-500"
                          title="Archive Course"
                        >
                          <Trash2 size={18} />
                        </button>
                      </>
                    )}
                    {showArchived && (
                      <>
                        <button 
                          onClick={() => handleRestoreCourse(course.id)}
                          className="p-2 text-slate-400 hover:text-emerald-500"
                          title="Restore Course"
                        >
                          <RefreshCw size={18} />
                        </button>
                        <button 
                          onClick={() => handlePermanentDeleteCourse(course.id)}
                          className="p-2 text-slate-400 hover:text-red-500"
                          title="Permanently Delete Course"
                        >
                          <Trash2 size={18} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      )}

      {activeTab === 'question-bank' && (
        <div className="space-y-8">
          <AdminQuestionBank />
        </div>
      )}

      {activeTab === 'rag' && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4 mb-6">
            <div className="bg-blue-100 dark:bg-blue-500/20 p-3 rounded-2xl">
              <Database className="text-blue-600 dark:text-blue-400" size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Knowledge Base Ingestion (RAG)</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Paste syllabus text to chunk and embed it for the AI's semantic search.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Course Code</label>
                <input 
                  type="text" 
                  placeholder="e.g., GST 111" 
                  value={kbCourseCode}
                  onChange={(e) => setKbCourseCode(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Module Name (Optional)</label>
                <input 
                  type="text" 
                  placeholder="e.g., Phonetics" 
                  value={kbModuleName}
                  onChange={(e) => setKbModuleName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Topic Name (Optional)</label>
                <input 
                  type="text" 
                  placeholder="e.g., Vowels" 
                  value={kbTopicName}
                  onChange={(e) => setKbTopicName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Syllabus Content</label>
              <textarea 
                placeholder="Paste the full text content here..." 
                value={kbContent}
                onChange={(e) => setKbContent(e.target.value)}
                className="w-full h-64 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-sans text-sm"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm">
                {ingestionStatus && (
                  <p className={`font-bold ${ingestionStatus.startsWith('Error') ? 'text-red-500' : 'text-emerald-500'}`}>
                    {ingestionStatus}
                  </p>
                )}
              </div>
              <button 
                onClick={handleIngestKB}
                disabled={isIngesting || !kbContent || !kbCourseCode}
                className="px-8 py-3 rounded-2xl font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
              >
                {isIngesting ? <Loader2 size={20} className="animate-spin" /> : <Database size={20} />}
                Ingest to Knowledge Base
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'curriculum-manager' && <CurriculumManager />}

      {activeTab === 'curriculum-health' && renderCurriculumHealth()}

      {activeTab === 'curriculum-requests' && renderCurriculumRequests()}

      {activeTab === 'api-debugger' && (
        <ApiDebuggerPage onBack={() => setActiveTab('overview')} showToast={showToast} />
      )}

      {activeTab === 'affiliates' && <AdminAffiliates />}

      {activeTab === 'users' && (
        <div className="space-y-8">
          {/* User Stats Overview */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Total Users', value: userStats.total, color: 'blue', icon: Users },
              { label: 'Students', value: userStats.students, color: 'emerald', icon: BookOpen },
              { label: 'Tutors', value: userStats.tutors, color: 'purple', icon: Trophy },
              { label: 'Admins', value: userStats.admins, color: 'rose', icon: Shield },
              { label: 'Moderators', value: userStats.moderators, color: 'amber', icon: Zap },
            ].map((stat, idx) => (
              <div key={idx} className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700">
                <div className={`w-10 h-10 rounded-2xl bg-${stat.color}-100 dark:bg-${stat.color}-500/20 flex items-center justify-center mb-4`}>
                  <stat.icon className={`text-${stat.color}-600 dark:text-${stat.color}-400`} size={20} />
                </div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">{stat.label}</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Users className="text-blue-500" size={28} />
                  User Directory
                </h2>
                <p className="text-slate-500 mt-1">Manage platform access, roles, and account statuses.</p>
              </div>
              
              <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
                <div className="relative flex-1 md:flex-initial">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    placeholder="Search by name or email..."
                    value={userSearchTerm}
                    onChange={(e) => { setUserSearchTerm(e.target.value); setUserCurrentPage(1); }}
                    className="pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-64 text-slate-900 dark:text-white"
                  />
                </div>
                
                {/* Role Filter */}
                <select 
                  value={userRoleFilter} 
                  onChange={(e) => { setUserRoleFilter(e.target.value); setUserCurrentPage(1); }}
                  className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Roles</option>
                  <option value="student">Students</option>
                  <option value="tutor">Tutors</option>
                  <option value="moderator">Moderators</option>
                  <option value="admin">Admins</option>
                </select>

                {/* Plan Type Filter */}
                <select 
                  value={userPlanFilter} 
                  onChange={(e) => { setUserPlanFilter(e.target.value); setUserCurrentPage(1); }}
                  className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Plans</option>
                  <option value="free">Free Trial</option>
                  <option value="scholar">Scholar</option>
                  <option value="premium">Premium Pro</option>
                </select>

                {/* Department Filter */}
                <select 
                  value={userDeptFilter} 
                  onChange={(e) => { setUserDeptFilter(e.target.value); setUserCurrentPage(1); }}
                  className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[150px]"
                >
                  <option value="all">All Depts</option>
                  {Array.from(new Set(users.map(u => u.department).filter(Boolean))).map((dept: any) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>

                <button 
                  onClick={fetchUsers} 
                  className="p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                  title="Refresh List"
                >
                  <RefreshCw size={20} className={isLoadingUsers ? "animate-spin" : ""} />
                </button>

                {isAdmin && (
                  <div className="flex gap-2">
                    <button
                      onClick={handlePruneOrphans}
                      disabled={isPruningOrphans}
                      className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all active:scale-95 disabled:opacity-50"
                      title="Sync with Firebase Authentication and prune users deleted in Firebase console"
                    >
                      {isPruningOrphans ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      Sync & Prune Orphans
                    </button>
                    <button
                      onClick={() => {
                        setUserFormName('');
                        setUserFormEmail('');
                        setUserFormPassword('');
                        setUserFormRole('student');
                        setUserFormDepartment('');
                        setUserFormAcademicLevel('100');
                        setUserFormPlanType('free');
                        setUserFormSparks(0);
                        setSelectedUserForEdit(null);
                        setIsAddUserModalOpen(true);
                      }}
                      className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-95"
                    >
                      <Plus size={16} />
                      Add User
                    </button>
                  </div>
                )}
              </div>
            </div>
 
             <div className="overflow-x-auto">
               <table className="w-full text-left">
                 <thead>
                   <tr className="border-b border-slate-200 dark:border-slate-700">
                     <th className="pb-4 text-xs font-bold text-slate-500 uppercase tracking-wider">User</th>
                     <th className="pb-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Academic Info</th>
                     <th className="pb-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Sparks</th>
                     <th className="pb-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Progress</th>
                     <th className="pb-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Last Active</th>
                     <th className="pb-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                   </tr>
                 </thead>
                 <tbody className="text-sm">
                   {isLoadingUsers ? (
                     <tr>
                       <td colSpan={6} className="py-20 text-center">
                         <div className="flex flex-col items-center gap-3">
                           <Loader2 className="animate-spin text-blue-500" size={32} />
                           <p className="text-slate-500 font-medium">Synchronizing user directory...</p>
                         </div>
                       </td>
                     </tr>
                   ) : users.length > 0 ? (
                     (() => {
                       const filteredUsers = users.filter(u => {
                         const matchesSearch = (u.email?.toLowerCase() || '').includes(userSearchTerm.toLowerCase()) || 
                                               (u.displayName?.toLowerCase() || '').includes(userSearchTerm.toLowerCase()) ||
                                               u.id.includes(userSearchTerm);
                         const matchesRole = userRoleFilter === 'all' || (u.role || 'student') === userRoleFilter;
                         const matchesDept = userDeptFilter === 'all' || (u.department || '') === userDeptFilter;
                         const matchesPlan = userPlanFilter === 'all' || (u.plan_type || 'free') === userPlanFilter;
                         return matchesSearch && matchesRole && matchesDept && matchesPlan;
                       });
                       const totalPages = Math.ceil(filteredUsers.length / usersPerPage);
                       const currentUsers = filteredUsers.slice((userCurrentPage - 1) * usersPerPage, userCurrentPage * usersPerPage);
 
                       return (
                         <>
                           {currentUsers.map((user) => (
                             <tr key={user.id} className="border-b border-slate-100 dark:border-slate-700/50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors group">
                               <td className="py-4">
                                 <div className="flex items-center gap-3">
                                   <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm">
                                     {user.displayName?.charAt(0) || user.email?.charAt(0) || '?'}
                                   </div>
                                   <div>
                                     <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                       {user.displayName || 'Anonymous Student'}
                                       <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                                         user.role === 'admin' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400' :
                                         user.role === 'tutor' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400' :
                                         user.role === 'moderator' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' :
                                         'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                                       }`}>
                                         {user.role || 'student'}
                                       </span>
                                     </div>
                                     <div className="text-xs text-slate-500 font-mono">{user.email || 'No Email'}</div>
                                   </div>
                                 </div>
                               </td>
                               <td className="py-4">
                                 <div className="text-xs">
                                   <div className="font-bold text-slate-700 dark:text-slate-300">{user.department || 'No Department'}</div>
                                   <div className="text-slate-500">{user.academic_level || 'Level N/A'} • <span className="uppercase font-bold text-[10px] text-blue-600 dark:text-blue-400">{user.plan_type || 'free'}</span></div>
                                 </div>
                               </td>
                               <td className="py-4">
                                 <div className="text-xs">
                                   <div className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                     <Zap size={14} />
                                     {(user.ai_sparks || 0).toLocaleString()} sparks
                                   </div>
                                   <div className="text-[10px] text-slate-500">{(user.total_sparks_used || 0).toLocaleString()} used</div>
                                 </div>
                               </td>
                               <td className="py-4">
                                 <div className="flex flex-col gap-1">
                                   <div className="flex items-center gap-2">
                                     <span className="text-xs font-bold text-slate-900 dark:text-white">Lvl {user.level || 1}</span>
                                     <span className="text-[10px] text-slate-500">{user.xp || 0} XP</span>
                                   </div>
                                   <div className="w-24 h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                     <div 
                                       className="h-full bg-blue-500" 
                                       style={{ width: `${Math.min(100, ((user.xp || 0) % 1000) / 10)}%` }}
                                     />
                                   </div>
                                 </div>
                               </td>
                               <td className="py-4">
                                 <div className="text-xs text-slate-500">
                                   {user.lastActive ? (() => { const d = parseFirestoreDate(user.lastActive); return (!d || isNaN(d.getTime())) ? 'Never' : d.toLocaleDateString(); })() : 'Never'}
                                 </div>
                               </td>
                               <td className="py-4 text-right">
                                 <div className="flex items-center justify-end gap-1">
                                   <button 
                                     onClick={() => handleResetSparks(user.id)}
                                     className="p-2 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
                                     title="Reset Sparks to 10k"
                                   >
                                     <Zap size={16} />
                                   </button>
                                   <button 
                                     onClick={() => setSelectedUserForDetails(user)}
                                     className="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                     title="View Profile Details"
                                   >
                                     <Search size={16} />
                                   </button>
                                   {isAdmin && (
                                     <>
                                       <button 
                                         onClick={() => {
                                           setSelectedUserForEdit(user);
                                           setUserFormName(user.displayName || '');
                                           setUserFormEmail(user.email || '');
                                           setUserFormPassword('');
                                           setUserFormRole(user.role || 'student');
                                           setUserFormDepartment(user.department || '');
                                           setUserFormAcademicLevel(user.academic_level || '100');
                                           setUserFormPlanType(user.plan_type || 'free');
                                           setUserFormSparks(user.ai_sparks ?? 0);
                                         }}
                                         className="p-2 text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                                         title="Edit Profile"
                                       >
                                         <Edit2 size={16} />
                                       </button>
                                       <button 
                                         onClick={() => handleDeleteUser(user.id)}
                                         className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                         title="Delete Account"
                                       >
                                         <Trash2 size={16} />
                                       </button>
                                     </>
                                   )}
                                 </div>
                               </td>
                             </tr>
                           ))}
                           
                           {/* Pagination Controls */}
                           {filteredUsers.length > usersPerPage && (
                             <tr>
                               <td colSpan={6} className="pt-8">
                                 <div className="flex items-center justify-between">
                                   <p className="text-xs text-slate-500">
                                     Showing <span className="font-bold text-slate-900 dark:text-white">{(userCurrentPage - 1) * usersPerPage + 1}</span> to <span className="font-bold text-slate-900 dark:text-white">{Math.min(userCurrentPage * usersPerPage, filteredUsers.length)}</span> of <span className="font-bold text-slate-900 dark:text-white">{filteredUsers.length}</span> users
                                   </p>
                                   <div className="flex items-center gap-2">
                                     <button 
                                       onClick={() => setUserCurrentPage(prev => Math.max(1, prev - 1))}
                                       disabled={userCurrentPage === 1}
                                       className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 disabled:opacity-30 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
                                     >
                                       <ChevronLeft size={20} />
                                     </button>
                                     <div className="flex items-center gap-1">
                                       {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                         let pageNum = userCurrentPage;
                                         if (userCurrentPage <= 3) pageNum = i + 1;
                                         else if (userCurrentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                                         else pageNum = userCurrentPage - 2 + i;
                                         
                                         if (pageNum < 1 || pageNum > totalPages) return null;
 
                                         return (
                                           <button
                                             key={pageNum}
                                             onClick={() => setUserCurrentPage(pageNum)}
                                             className={`w-10 h-10 rounded-xl font-bold text-sm transition-all ${
                                               userCurrentPage === pageNum 
                                                 ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' 
                                                 : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                                             }`}
                                           >
                                             {pageNum}
                                           </button>
                                         );
                                       })}
                                     </div>
                                     <button 
                                       onClick={() => setUserCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                       disabled={userCurrentPage === totalPages}
                                       className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 disabled:opacity-30 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
                                     >
                                       <ChevronRight size={20} />
                                     </button>
                                   </div>
                                 </div>
                               </td>
                             </tr>
                           )}
                         </>
                       );
                     })()
                   ) : (
                     <tr>
                       <td colSpan={6} className="py-20 text-center">
                         <div className="flex flex-col items-center gap-3">
                           <Users className="text-slate-300" size={48} />
                           <p className="text-slate-500 font-medium">No users found matching your criteria.</p>
                         </div>
                       </td>
                     </tr>
                   )}
                 </tbody>
               </table>
             </div>
 
             {/* Modals for Advanced User Operations */}
             {selectedUserForDetails && (
               <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
                 <div className="bg-white dark:bg-slate-900 rounded-[2rem] w-full max-w-xl p-8 border border-slate-200 dark:border-slate-800 shadow-2xl relative">
                   <button 
                     onClick={() => setSelectedUserForDetails(null)}
                     className="absolute top-6 right-6 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-all"
                   >
                     <X size={20} />
                   </button>
                   
                   <div className="flex items-center gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
                     <div className="w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xl">
                       {selectedUserForDetails.displayName?.charAt(0) || selectedUserForDetails.email?.charAt(0) || '?'}
                     </div>
                     <div>
                       <h3 className="text-xl font-bold text-slate-900 dark:text-white">{selectedUserForDetails.displayName || 'Anonymous Student'}</h3>
                       <p className="text-xs font-mono text-slate-500">{selectedUserForDetails.email || 'No Email'}</p>
                       <div className="flex gap-2 mt-1.5">
                         <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                           {selectedUserForDetails.role || 'student'}
                         </span>
                         <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300">
                           {selectedUserForDetails.plan_type || 'free'}
                         </span>
                       </div>
                     </div>
                   </div>
                   
                   <div className="grid grid-cols-2 gap-6 py-6 border-b border-slate-100 dark:border-slate-800">
                     <div>
                       <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Academic Info</h4>
                       <div className="space-y-2 text-xs">
                         <div className="flex justify-between">
                           <span className="text-slate-500">Department:</span>
                           <span className="font-bold text-slate-900 dark:text-white">{selectedUserForDetails.department || 'N/A'}</span>
                         </div>
                         <div className="flex justify-between">
                           <span className="text-slate-500">Academic Level:</span>
                           <span className="font-bold text-slate-900 dark:text-white">{selectedUserForDetails.academic_level || 'N/A'} Level</span>
                         </div>
                         <div className="flex justify-between">
                           <span className="text-slate-500">Semester:</span>
                           <span className="font-bold text-slate-900 dark:text-white">{selectedUserForDetails.semester || 'N/A'}</span>
                         </div>
                       </div>
                     </div>
                     <div>
                       <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Usage & Metrics</h4>
                       <div className="space-y-2 text-xs">
                         <div className="flex justify-between">
                           <span className="text-slate-500">Sparks Balance:</span>
                           <span className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                             <Zap size={12} />
                             {(selectedUserForDetails.ai_sparks || 0).toLocaleString()}
                           </span>
                         </div>
                         <div className="flex justify-between">
                           <span className="text-slate-500">Sparks Used:</span>
                           <span className="font-bold text-slate-900 dark:text-white">{(selectedUserForDetails.total_sparks_used || 0).toLocaleString()}</span>
                         </div>
                         <div className="flex justify-between">
                           <span className="text-slate-500">User Level:</span>
                           <span className="font-bold text-slate-900 dark:text-white">Level {selectedUserForDetails.level || 1} ({selectedUserForDetails.xp || 0} XP)</span>
                         </div>
                       </div>
                     </div>
                   </div>

                   <div className="flex justify-end gap-2 pt-6">
                     <button 
                       onClick={() => {
                         setSelectedUserForDetails(null);
                         setSelectedUserForEdit(selectedUserForDetails);
                         setUserFormName(selectedUserForDetails.displayName || '');
                         setUserFormEmail(selectedUserForDetails.email || '');
                         setUserFormPassword('');
                         setUserFormRole(selectedUserForDetails.role || 'student');
                         setUserFormDepartment(selectedUserForDetails.department || '');
                         setUserFormAcademicLevel(selectedUserForDetails.academic_level || '100');
                         setUserFormPlanType(selectedUserForDetails.plan_type || 'free');
                         setUserFormSparks(selectedUserForDetails.ai_sparks ?? 0);
                       }}
                       className="px-4 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 rounded-xl transition-all flex items-center gap-1.5"
                     >
                       <Edit2 size={14} />
                       Edit Profile
                     </button>
                     <button 
                       onClick={() => {
                         setSelectedUserForDetails(null);
                         handleDeleteUser(selectedUserForDetails.id);
                       }}
                       className="px-4 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5"
                     >
                       <Trash2 size={14} />
                       Delete User
                     </button>
                   </div>
                 </div>
               </div>
             )}

             {(isAddUserModalOpen || selectedUserForEdit) && (
               <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
                 <div className="bg-white dark:bg-slate-900 rounded-[2rem] w-full max-w-md p-8 border border-slate-200 dark:border-slate-800 shadow-2xl relative">
                   <button 
                     onClick={() => {
                       setIsAddUserModalOpen(false);
                       setSelectedUserForEdit(null);
                     }}
                     className="absolute top-6 right-6 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-all"
                   >
                     <X size={20} />
                   </button>

                   <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                     {selectedUserForEdit ? 'Edit User Profile' : 'Add New User'}
                   </h3>
                   <p className="text-slate-500 text-xs mb-6">
                     {selectedUserForEdit ? 'Modify platform access details.' : 'Manually register a new account.'}
                   </p>

                   <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                     <div>
                       <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Full Name</label>
                       <input 
                         type="text" 
                         value={userFormName}
                         onChange={(e) => setUserFormName(e.target.value)}
                         placeholder="e.g. John Doe"
                         className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                       />
                     </div>

                     <div>
                       <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Email Address</label>
                       <input 
                         type="email" 
                         value={userFormEmail}
                         onChange={(e) => setUserFormEmail(e.target.value)}
                         placeholder="e.g. johndoe@gmail.com"
                         className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                       />
                     </div>

                     <div>
                       <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                         Password {selectedUserForEdit && <span className="text-[9px] text-slate-500 font-normal lowercase">(leave empty to keep current)</span>}
                       </label>
                       <div className="flex gap-2">
                         <input 
                           type="text" 
                           value={userFormPassword}
                           onChange={(e) => setUserFormPassword(e.target.value)}
                           placeholder={selectedUserForEdit ? "••••••••" : "Enter secure password"}
                           className="flex-1 px-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white font-mono"
                         />
                         {!selectedUserForEdit && (
                           <button 
                             type="button"
                             onClick={() => {
                               const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#%*";
                               let pass = "";
                               for (let i = 0; i < 10; i++) {
                                 pass += chars.charAt(Math.floor(Math.random() * chars.length));
                               }
                               setUserFormPassword(pass);
                             }}
                             className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-slate-700 dark:text-slate-300"
                           >
                             Generate
                           </button>
                         )}
                       </div>
                     </div>

                     <div className="grid grid-cols-2 gap-4">
                       <div>
                         <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Role</label>
                         <select 
                           value={userFormRole}
                           onChange={(e) => setUserFormRole(e.target.value as any)}
                           className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white font-bold"
                         >
                           <option value="student">Student</option>
                           <option value="tutor">Tutor</option>
                           <option value="moderator">Moderator</option>
                           <option value="admin">Admin</option>
                         </select>
                       </div>
                       <div>
                         <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Plan Type</label>
                         <select 
                           value={userFormPlanType}
                           onChange={(e) => setUserFormPlanType(e.target.value)}
                           className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white font-bold"
                         >
                           <option value="free">Free Trial</option>
                           <option value="scholar">Scholar</option>
                           <option value="premium">Premium Pro</option>
                         </select>
                       </div>
                     </div>

                     <div className="grid grid-cols-2 gap-4">
                       <div>
                         <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Department</label>
                         <input 
                           type="text" 
                           value={userFormDepartment}
                           onChange={(e) => setUserFormDepartment(e.target.value)}
                           placeholder="e.g. Chemistry"
                           className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                         />
                       </div>
                       <div>
                         <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Academic Level</label>
                         <select 
                           value={userFormAcademicLevel}
                           onChange={(e) => setUserFormAcademicLevel(e.target.value)}
                           className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white font-bold"
                         >
                           <option value="100">100 Level</option>
                           <option value="200">200 Level</option>
                           <option value="300">300 Level</option>
                           <option value="400">400 Level</option>
                           <option value="500">500 Level</option>
                           <option value="Postgraduate">Postgraduate</option>
                           <option value="Staff/Faculty">Staff/Faculty</option>
                         </select>
                       </div>
                     </div>

                     <div>
                       <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">AI Sparks Balance</label>
                       <input 
                         type="number" 
                         value={userFormSparks}
                         onChange={(e) => setUserFormSparks(Number(e.target.value))}
                         min={0}
                         className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                       />
                     </div>
                   </div>

                   <div className="flex justify-end gap-2 mt-8 pt-4 border-t border-slate-100 dark:border-slate-800">
                     <button 
                       onClick={() => {
                         setIsAddUserModalOpen(false);
                         setSelectedUserForEdit(null);
                       }}
                       disabled={isSavingUser}
                       className="px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl disabled:opacity-50"
                     >
                       Cancel
                     </button>
                     <button 
                       onClick={selectedUserForEdit ? handleUpdateUser : handleCreateUser}
                       disabled={isSavingUser}
                       className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center gap-1.5"
                     >
                       {isSavingUser && <Loader2 size={12} className="animate-spin" />}
                       {selectedUserForEdit ? 'Save Changes' : 'Create Account'}
                     </button>
                   </div>
                 </div>
               </div>
             )}
           </div>
         </div>
       )}

      {activeTab === 'logs' && (
        <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileText className="text-indigo-500" size={28} />
                System Audit Logs
              </h2>
              <p className="text-slate-500 mt-1">Review all user and administrative activities across the platform.</p>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input 
                  type="text"
                  placeholder="Search logs..."
                  value={logSearchTerm}
                  onChange={(e) => setLogSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-64"
                />
              </div>

              <select 
                value={logFilter}
                onChange={(e) => setLogFilter(e.target.value)}
                className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Categories</option>
                <option value="user">User Activity</option>
                <option value="admin">Admin Actions</option>
                <option value="ai">AI Operations</option>
                <option value="system">System Events</option>
              </select>

              <select 
                value={logLevelFilter}
                onChange={(e) => setLogLevelFilter(e.target.value)}
                className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Levels</option>
                <option value="info">Info</option>
                <option value="success">Success</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
              </select>

              <select 
                value={logLimit}
                onChange={(e) => setLogLimit(Number(e.target.value))}
                className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value={50}>50 Logs</option>
                <option value={100}>100 Logs</option>
                <option value={200}>200 Logs</option>
                <option value={500}>500 Logs</option>
              </select>

              <button 
                onClick={() => setIsLiveLogs(!isLiveLogs)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                  isLiveLogs 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' 
                    : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400'
                }`}
              >
                <RefreshCw size={16} className={isLiveLogs ? 'animate-spin' : ''} />
                {isLiveLogs ? 'Live' : 'Paused'}
              </button>

              {!isLiveLogs && (
                <button 
                  onClick={fetchLogs}
                  className="p-2 rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-all"
                >
                  <RefreshCw size={20} className={isLoadingLogs ? 'animate-spin' : ''} />
                </button>
              )}

              <div className="h-8 w-px bg-slate-200 dark:bg-slate-700 mx-2" />

              <button 
                onClick={handleExportLogs}
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-indigo-500 hover:text-white transition-all"
                title="Export to CSV"
              >
                <Download size={20} />
              </button>

              <button 
                onClick={handleClearLogs}
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-rose-500 hover:text-white transition-all"
                title="Clear Logs"
              >
                <Trash2 size={20} />
              </button>

              <button 
                onClick={() => handleCleanOldLogs(30)}
                disabled={isPruningLogs}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-amber-500 hover:text-white text-xs font-bold transition-all disabled:opacity-50"
                title="Prune logs older than 30 days"
              >
                {isPruningLogs ? <Loader2 size={16} className="animate-spin" /> : <Clock size={16} />}
                Prune &gt;30d
              </button>
            </div>
          </div>

          {/* Log Stats Chart & Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-2 p-6 bg-slate-50 dark:bg-slate-900/50 rounded-3xl border border-slate-100 dark:border-slate-700">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4">Log Activity (Last 7 Days)</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={logStats}>
                    <defs>
                      <linearGradient id="logGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="count" 
                      stroke="#6366f1" 
                      strokeWidth={3}
                      fillOpacity={1} 
                      fill="url(#logGradient)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-rose-50 dark:bg-rose-900/20 rounded-2xl border border-rose-100 dark:border-rose-800/50 flex items-center justify-between">
                <div>
                  <div className="text-xs font-black text-rose-600 dark:text-rose-400 uppercase tracking-widest">Errors</div>
                  <div className="text-2xl font-black text-rose-700 dark:text-rose-300">{logCounts.error}</div>
                </div>
                <AlertCircle className="text-rose-500" size={24} />
              </div>
              <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-100 dark:border-amber-800/50 flex items-center justify-between">
                <div>
                  <div className="text-xs font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest">Warnings</div>
                  <div className="text-2xl font-black text-amber-700 dark:text-amber-300">{logCounts.warning}</div>
                </div>
                <AlertCircle className="text-amber-500" size={24} />
              </div>
              <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl border border-emerald-100 dark:border-emerald-800/50 flex items-center justify-between">
                <div>
                  <div className="text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Success</div>
                  <div className="text-2xl font-black text-emerald-700 dark:text-emerald-300">{logCounts.success}</div>
                </div>
                <CheckCircle className="text-emerald-500" size={24} />
              </div>
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/50 flex items-center justify-between">
                <div>
                  <div className="text-xs font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">Info</div>
                  <div className="text-2xl font-black text-blue-700 dark:text-blue-300">{logCounts.info}</div>
                </div>
                <Activity className="text-blue-500" size={24} />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Timestamp</th>
                  <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Level</th>
                  <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Category</th>
                  <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">User</th>
                  <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Message</th>
                  <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {isLoadingLogs && !isLiveLogs ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500">
                      <Loader2 className="animate-spin mx-auto mb-2" size={24} />
                      Loading logs...
                    </td>
                  </tr>
                ) : logs.filter(l => {
                  const matchesCategory = logFilter === 'all' || l.category === logFilter;
                  const matchesLevel = logLevelFilter === 'all' || l.level === logLevelFilter;
                  const matchesSearch = !logSearchTerm || 
                    l.message.toLowerCase().includes(logSearchTerm.toLowerCase()) ||
                    l.userEmail?.toLowerCase().includes(logSearchTerm.toLowerCase()) ||
                    l.userId?.toLowerCase().includes(logSearchTerm.toLowerCase());
                  return matchesCategory && matchesLevel && matchesSearch;
                }).length > 0 ? (
                  logs.filter(l => {
                    const matchesCategory = logFilter === 'all' || l.category === logFilter;
                    const matchesLevel = logLevelFilter === 'all' || l.level === logLevelFilter;
                    const matchesSearch = !logSearchTerm || 
                      l.message.toLowerCase().includes(logSearchTerm.toLowerCase()) ||
                      l.userEmail?.toLowerCase().includes(logSearchTerm.toLowerCase()) ||
                      l.userId?.toLowerCase().includes(logSearchTerm.toLowerCase());
                    return matchesCategory && matchesLevel && matchesSearch;
                  }).map((log) => (
                    <tr key={log.id} className="border-b border-slate-100 dark:border-slate-700/50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="py-4 text-xs text-slate-500 whitespace-nowrap">
                        {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : 'Just now'}
                      </td>
                      <td className="py-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          log.level === 'error' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' :
                          log.level === 'warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                          log.level === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                          'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        }`}>
                          {log.level}
                        </span>
                      </td>
                      <td className="py-4">
                        <span className="text-xs font-bold text-slate-400 uppercase">{log.category}</span>
                      </td>
                      <td className="py-4">
                        <div className="text-slate-900 dark:text-white font-medium">{log.userEmail}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{log.userId?.substring(0, 8)}...</div>
                      </td>
                      <td className="py-4">
                        <div className="text-slate-600 dark:text-slate-300 max-w-md truncate" title={log.message}>{log.message}</div>
                      </td>
                      <td className="py-4">
                        <button 
                          onClick={() => setSelectedLogDetails(log)}
                          className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-400 hover:text-indigo-500 transition-colors"
                        >
                          <Database size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500">No logs found for this criteria.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Log Details Modal */}
      <AnimatePresence>
        {selectedLogDetails && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-800 rounded-[2.5rem] w-full max-w-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700"
            >
              <div className="p-8 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-2xl ${
                    selectedLogDetails.level === 'error' ? 'bg-rose-100 text-rose-600' :
                    selectedLogDetails.level === 'warning' ? 'bg-amber-100 text-amber-600' :
                    selectedLogDetails.level === 'success' ? 'bg-emerald-100 text-emerald-600' :
                    'bg-blue-100 text-blue-600'
                  }`}>
                    <Database size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">Log Entry Details</h3>
                    <p className="text-sm text-slate-500">{selectedLogDetails.timestamp?.toDate ? selectedLogDetails.timestamp.toDate().toLocaleString() : 'Just now'}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedLogDetails(null)}
                  className="p-2 rounded-xl bg-white dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors shadow-sm"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-8 max-h-[60vh] overflow-y-auto custom-scrollbar">
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Level</p>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        selectedLogDetails.level === 'error' ? 'bg-rose-100 text-rose-700' :
                        selectedLogDetails.level === 'warning' ? 'bg-amber-100 text-amber-700' :
                        selectedLogDetails.level === 'success' ? 'bg-emerald-100 text-emerald-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {selectedLogDetails.level}
                      </span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Category</p>
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase">{selectedLogDetails.category}</span>
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">User Context</p>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xs">
                        {selectedLogDetails.userEmail?.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{selectedLogDetails.userEmail}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{selectedLogDetails.userId}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Message</p>
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{selectedLogDetails.message}</p>
                  </div>

                  {selectedLogDetails.details && (
                    <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Technical Details (JSON)</p>
                      <pre className="text-[11px] text-indigo-600 dark:text-indigo-400 font-mono bg-white dark:bg-slate-800 p-4 rounded-xl overflow-x-auto border border-slate-100 dark:border-slate-700">
                        {JSON.stringify(selectedLogDetails.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-8 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700 flex justify-end">
                <button 
                  onClick={() => setSelectedLogDetails(null)}
                  className="px-6 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
                >
                  Close Details
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {activeTab === 'settings' && (
        <div className="space-y-8">
          {/* AI Provider Status & Metrics */}
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Bot className="text-blue-500" size={28} />
                  AI Intelligence Hub
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-slate-500">Real-time health monitoring and provider performance metrics.</p>
                  {lastAiUpdate && (
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded-full">
                      Last Updated: {lastAiUpdate.toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setIsLiveAIUpdate(!isLiveAIUpdate)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    isLiveAIUpdate 
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800' 
                      : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full ${isLiveAIUpdate ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                  {isLiveAIUpdate ? 'Live Updates ON' : 'Live Updates OFF'}
                </button>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-lg text-xs font-bold">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  System Healthy
                </div>
                <button 
                  onClick={checkAIStatus}
                  disabled={isCheckingAI}
                  className="p-2 rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-all"
                >
                  <RefreshCw size={20} className={isCheckingAI ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Groq Card */}
              <div className={`p-6 rounded-3xl border-2 transition-all ${aiProviderStatus.groq?.active ? 'border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-500/5' : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
                    <Zap size={24} />
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${aiProviderStatus.groq?.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                    {aiProviderStatus.groq?.active ? 'Active' : 'Offline'}
                  </div>
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white">Groq</h3>
                <div className="mt-4 space-y-2">
                  {providerHealth?.groq?.circuitBreaker && (
                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase items-center">
                      <span>Breaker</span>
                      <span className={`px-2 py-0.5 rounded font-mono ${
                        providerHealth.groq.circuitBreaker.state === 'CLOSED'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                      }`}>
                        {providerHealth.groq.circuitBreaker.state}
                        {providerHealth.groq.circuitBreaker.cooldownRemainingSeconds > 0 && ` (${providerHealth.groq.circuitBreaker.cooldownRemainingSeconds}s)`}
                      </span>
                    </div>
                  )}
                  {providerHealth?.groq?.configuredModel && (
                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase items-center">
                      <span>Model</span>
                      <span className="text-slate-900 dark:text-white font-mono truncate max-w-[120px]">
                        {providerHealth.groq.configuredModel}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Keys</span>
                    <span className="text-slate-900 dark:text-white">
                      {aiProviderStatus.groq?.totalKeys || 0} ({aiProviderStatus.groq?.exhaustedKeys || 0} exhausted)
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Latency</span>
                    <span className="text-emerald-500">{aiMetrics.groq?.latency || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Uptime</span>
                    <span className="text-slate-900 dark:text-white">{aiMetrics.groq?.uptime || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Mistral Direct Card */}
              <div className={`p-6 rounded-3xl border-2 transition-all ${aiProviderStatus.mistral_direct?.active ? 'border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-500/5' : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                    <Star size={24} />
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${aiProviderStatus.mistral_direct?.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                    {aiProviderStatus.mistral_direct?.active ? 'Active' : 'Offline'}
                  </div>
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white">Direct Mistral</h3>
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Keys</span>
                    <span className="text-slate-900 dark:text-white">
                      {aiProviderStatus.mistral_direct?.totalKeys || 0} ({aiProviderStatus.mistral_direct?.exhaustedKeys || 0} exhausted)
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Latency</span>
                    <span className="text-amber-500">{aiMetrics.mistral_direct?.latency || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Uptime</span>
                    <span className="text-slate-900 dark:text-white">{aiMetrics.mistral_direct?.uptime || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* OpenRouter Card */}
              <div className={`p-6 rounded-3xl border-2 transition-all ${aiProviderStatus.openrouter_free?.active ? 'border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-500/5' : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
                    <Zap size={24} />
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${aiProviderStatus.openrouter_free?.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                    {aiProviderStatus.openrouter_free?.active ? 'Active' : 'Offline'}
                  </div>
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white">OpenRouter</h3>
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Keys</span>
                    <span className="text-slate-900 dark:text-white">
                      {aiProviderStatus.openrouter_free?.totalKeys || 0} ({aiProviderStatus.openrouter_free?.exhaustedKeys || 0} exhausted)
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Latency</span>
                    <span className="text-amber-500">{aiMetrics.openrouter_free?.latency || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Uptime</span>
                    <span className="text-slate-900 dark:text-white">{aiMetrics.openrouter_free?.uptime || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Gemini Direct Card */}
              <div className={`p-6 rounded-3xl border-2 transition-all ${aiProviderStatus.gemini_direct?.active ? 'border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-500/5' : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                    <Shield size={24} />
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${aiProviderStatus.gemini_direct?.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                    {aiProviderStatus.gemini_direct?.active ? 'Active' : 'Offline'}
                  </div>
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white">Gemini</h3>
                <div className="mt-4 space-y-2">
                  {providerHealth?.gemini_direct?.circuitBreaker && (
                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase items-center">
                      <span>Breaker</span>
                      <span className={`px-2 py-0.5 rounded font-mono ${
                        providerHealth.gemini_direct.circuitBreaker.state === 'CLOSED'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                      }`}>
                        {providerHealth.gemini_direct.circuitBreaker.state}
                        {providerHealth.gemini_direct.circuitBreaker.cooldownRemainingSeconds > 0 && ` (${providerHealth.gemini_direct.circuitBreaker.cooldownRemainingSeconds}s)`}
                      </span>
                    </div>
                  )}
                  {providerHealth?.gemini_direct?.configuredModel && (
                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase items-center">
                      <span>Model</span>
                      <span className="text-slate-900 dark:text-white font-mono truncate max-w-[120px]">
                        {providerHealth.gemini_direct.configuredModel}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Keys</span>
                    <span className="text-slate-900 dark:text-white">
                      {aiProviderStatus.gemini_direct?.totalKeys || 0} ({aiProviderStatus.gemini_direct?.exhaustedKeys || 0} exhausted)
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Latency</span>
                    <span className="text-slate-500">{aiMetrics.gemini_direct?.latency || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Uptime</span>
                    <span className="text-slate-900 dark:text-white">{aiMetrics.gemini_direct?.uptime || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Cohere Card */}
              <div className={`p-6 rounded-3xl border-2 transition-all ${aiProviderStatus.cohere?.active ? 'border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-500/5' : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
                    <Cpu size={24} />
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${aiProviderStatus.cohere?.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                    {aiProviderStatus.cohere?.active ? 'Active' : 'Offline'}
                  </div>
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white">Cohere</h3>
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Keys</span>
                    <span className="text-slate-900 dark:text-white">
                      {aiProviderStatus.cohere?.totalKeys || 0} ({aiProviderStatus.cohere?.exhaustedKeys || 0} exhausted)
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Latency</span>
                    <span className="text-slate-500">{aiMetrics.cohere?.latency || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Uptime</span>
                    <span className="text-slate-900 dark:text-white">{aiMetrics.cohere?.uptime || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Hugging Face Card */}
              <div className={`p-6 rounded-3xl border-2 transition-all ${aiProviderStatus.huggingface?.active ? 'border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-500/5' : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400">
                    <Zap size={24} />
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${aiProviderStatus.huggingface?.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                    {aiProviderStatus.huggingface?.active ? 'Active' : 'Offline'}
                  </div>
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white">Hugging Face</h3>
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Keys</span>
                    <span className="text-slate-900 dark:text-white">
                      {aiProviderStatus.huggingface?.totalKeys || 0} ({aiProviderStatus.huggingface?.exhaustedKeys || 0} exhausted)
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Latency</span>
                    <span className="text-slate-500">{aiMetrics.huggingface?.latency || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Uptime</span>
                    <span className="text-slate-900 dark:text-white">{aiMetrics.huggingface?.uptime || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* NVIDIA NIM Card */}
              <div className={`p-6 rounded-3xl border-2 transition-all ${aiProviderStatus.nvidia?.active ? 'border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-500/5' : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                    <Cpu size={24} />
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${aiProviderStatus.nvidia?.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                    {aiProviderStatus.nvidia?.active ? 'Active' : 'Offline'}
                  </div>
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white">NVIDIA NIM</h3>
                <div className="mt-4 space-y-2">
                  {providerHealth?.nvidia?.circuitBreaker && (
                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase items-center">
                      <span>Breaker</span>
                      <span className={`px-2 py-0.5 rounded font-mono ${
                        providerHealth.nvidia.circuitBreaker.state === 'CLOSED'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                      }`}>
                        {providerHealth.nvidia.circuitBreaker.state}
                        {providerHealth.nvidia.circuitBreaker.cooldownRemainingSeconds > 0 && ` (${providerHealth.nvidia.circuitBreaker.cooldownRemainingSeconds}s)`}
                      </span>
                    </div>
                  )}
                  {providerHealth?.nvidia?.configuredModel && (
                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase items-center">
                      <span>Model</span>
                      <span className="text-slate-900 dark:text-white font-mono truncate max-w-[120px]">
                        {providerHealth.nvidia.configuredModel}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Keys</span>
                    <span className="text-slate-900 dark:text-white">
                      {aiProviderStatus.nvidia?.totalKeys || 0} ({aiProviderStatus.nvidia?.exhaustedKeys || 0} exhausted)
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Latency</span>
                    <span className="text-slate-500">{aiMetrics.nvidia?.latency || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                    <span>Uptime</span>
                    <span className="text-slate-900 dark:text-white">{aiMetrics.nvidia?.uptime || 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Global AI Safety Controls */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                  <Shield className="text-red-500" size={24} />
                  Safety Controls
                </h3>
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">Global AI Killswitch</div>
                      <div className="text-[10px] text-slate-500">Disable all AI interactions.</div>
                    </div>
                    <div 
                      onClick={() => updateSystemConfig({ aiKillswitch: !systemConfig.aiKillswitch })}
                      className={`w-10 h-5 rounded-full relative cursor-pointer transition-all ${systemConfig.aiKillswitch ? 'bg-red-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${systemConfig.aiKillswitch ? 'right-0.5' : 'left-0.5'}`} />
                    </div>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">Strict Academic Filter</div>
                      <div className="text-[10px] text-slate-500">Block non-academic queries.</div>
                    </div>
                    <div 
                      onClick={() => updateSystemConfig({ strictAcademicFilter: !systemConfig.strictAcademicFilter })}
                      className={`w-10 h-5 rounded-full relative cursor-pointer transition-all ${systemConfig.strictAcademicFilter ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${systemConfig.strictAcademicFilter ? 'right-0.5' : 'left-0.5'}`} />
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-2">
                          <Zap size={16} />
                          Global AI Mode
                        </div>
                        <div className="text-[10px] text-indigo-600 dark:text-indigo-400">Affects all students globally.</div>
                      </div>
                      <div className="flex bg-slate-200 dark:bg-slate-700 p-1 rounded-xl">
                        <button 
                          onClick={() => updateAiMode('normal')}
                          disabled={isUpdatingAiMode}
                          className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all ${globalAiMode === 'normal' ? 'bg-white dark:bg-slate-600 text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                        >
                          Normal
                        </button>
                        <button 
                          onClick={() => updateAiMode('fast')}
                          disabled={isUpdatingAiMode}
                          className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all ${globalAiMode === 'fast' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500'}`}
                        >
                          Fast
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500 italic">
                      {globalAiMode === 'fast' 
                        ? "Fast Mode: Prioritizes speed using Groq (Llama 3) for all interactions." 
                        : "Normal Mode: Uses default routing (Mistral/Gemini) for balanced reasoning."}
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">Auto-Fallback Mode</div>
                      <div className="text-[10px] text-slate-500">Enable automatic provider switching.</div>
                    </div>
                    <div 
                      onClick={() => updateSystemConfig({ autoFallback: !systemConfig.autoFallback })}
                      className={`w-10 h-5 rounded-full relative cursor-pointer transition-all ${systemConfig.autoFallback ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${systemConfig.autoFallback ? 'right-0.5' : 'left-0.5'}`} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Community Settings */}
              <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                  <Activity className="text-green-500" size={24} />
                  Community Setup
                </h3>
                <p className="text-slate-500 text-sm mb-6">Set the WhatsApp Group link to appear during new student onboarding.</p>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">WhatsApp Channel Link</label>
                    <input 
                      type="url"
                      value={communityLink}
                      onChange={(e) => setCommunityLink(e.target.value)}
                      placeholder="https://chat.whatsapp.com/..." 
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none transition-all dark:text-white"
                    />
                  </div>
                  <button 
                    onClick={updateCommunityConfig}
                    disabled={isUpdatingCommunity}
                    className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isUpdatingCommunity ? <Loader2 size={18} className="animate-spin" /> : <Activity size={18} />}
                    Save Link
                  </button>
                </div>
              </div>

              {/* API Key Debugging Tool */}
              <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                  <Key className="text-indigo-500" size={24} />
                  API Key Debugger
                </h3>
                <p className="text-slate-500 text-sm mb-6">Test and validate API keys for various AI providers before adding them to the system.</p>
                <button 
                  onClick={() => setActiveTab('api-debugger')}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
                >
                  <Zap size={18} />
                  Open API Debugger
                </button>
              </div>

              {/* System Event Logs */}
              <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                  <Activity className="text-blue-500" size={24} />
                  Recent Activity
                </h3>
                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 scrollbar-hide">
                  {logs.map((log) => (
                    <div key={log.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${
                          log.level === 'success' ? 'text-emerald-500' :
                          log.level === 'warning' ? 'text-amber-500' :
                          log.level === 'error' ? 'text-red-500' :
                          'text-blue-500'
                        }`}>
                          {log.level}
                        </span>
                        <span className="text-[10px] text-slate-400 font-bold">
                          {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleTimeString() : 'Just now'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{log.message}</p>
                    </div>
                  ))}
                  {logs.length === 0 && (
                    <div className="text-center py-8 text-slate-500 text-sm italic">
                      No recent activity logs found.
                    </div>
                  )}
                </div>
                <button 
                  onClick={() => setActiveTab('logs')}
                  className="w-full mt-4 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-slate-400 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-900 transition-all"
                >
                  View Full Audit Trail
                </button>
              </div>
            </div>

            
            {/* Global AI Provider */}
            <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Globe className="text-blue-500" size={28} />
                    Global Ecosystem AI Provider
                  </h2>
                  <p className="text-slate-500 mt-1">Force all services (Voice Tutor, Course Gen, etc) to use one master provider.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-2 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 justify-between">
                  <div className="flex flex-col gap-1">
                     <span className="font-bold text-slate-700 dark:text-slate-300 text-sm">Master AI Mode</span>
                     <span className="text-xs text-slate-500">Overrides individual task routing below. Select a single key to rule them all.</span>
                  </div>
                  <select
                    value={(routingConfig as any).global_provider || ''}
                    onChange={(e) => updateRoutingConfig('global_provider', e.target.value)}
                    className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500 transition-all mt-3"
                  >
                    <option value="">Off (Use Task Matrix)</option>
                    <option value="nvidia">NVIDIA API</option>
                    <option value="gemini_direct">Gemini API</option>
                    <option value="openrouter_free">OpenRouter API</option>
                    <option value="groq">Groq API</option>
                    <option value="mistral_direct">Mistral API</option>
                    <option value="cohere">Cohere API</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 justify-between">
                  <div className="flex flex-col gap-1">
                     <span className="font-bold text-slate-700 dark:text-slate-300 text-sm">Default Companion Profile</span>
                     <span className="text-xs text-slate-500">The default profile for new students until they manually select another one in the chat.</span>
                  </div>
                  <select
                    value={(routingConfig as any).default_personality || 'encouraging'}
                    onChange={(e) => updateRoutingConfig('default_personality', e.target.value)}
                    className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500 transition-all mt-3"
                  >
                    <option value="encouraging">🏆 Coach (Supportive & Encouraging)</option>
                    <option value="strict">👨‍🏫 Professor (Rigorous & Academically Precise)</option>
                    <option value="socratic">🤔 Mentor (Deep Socratic Inquiry)</option>
                    <option value="humorous">🤪 Buddy (Witty & Engaged)</option>
                    <option value="master">🧠 Grandmaster (Direct & Omniscient)</option>
                    <option value="debate">🤺 Debater (Challenging Peer)</option>
                  </select>
                </div>
              </div>

              {/* NVIDIA NIM Orchestration settings */}
              <div className="mt-6 border-t border-slate-100 dark:border-slate-700 pt-6">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                  <Cpu className="text-emerald-500 animate-pulse" size={18} />
                  NVIDIA NIM Orchestration Settings
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-100 dark:border-slate-700">
                    <div>
                      <span className="font-bold text-slate-700 dark:text-slate-300 text-xs block">NVIDIA Text / STEM Core Model</span>
                      <span className="text-[10px] text-slate-500">Active model for physics, logic, calculus, and programming tasks.</span>
                    </div>
                    <select
                      value={(routingConfig as any).nvidia_text_model || 'nvidia/nemotron-3-super-120b-a12b'}
                      onChange={(e) => updateRoutingConfig('nvidia_text_model', e.target.value)}
                      className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-[11px] font-bold text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500 transition-all mt-1"
                    >
                      <option value="nvidia/nemotron-3-super-120b-a12b">NVIDIA Nemotron-3 Super 120B (High Reasoning)</option>
                      <option value="nvidia/llama-3.1-nemotron-70b-instruct">Llama 3.1 Nemotron 70B Instruct</option>
                      <option value="nvidia/nemotron-4-340b-instruct">NVIDIA Nemotron-4 340B Instruct</option>
                      <option value="nvidia/nemotron-mini-4b-instruct">NVIDIA Nemotron Mini 4B Instruct</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-2 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-100 dark:border-slate-700">
                    <div>
                      <span className="font-bold text-slate-700 dark:text-slate-300 text-xs block">NVIDIA FLUX Image Generator</span>
                      <span className="text-[10px] text-slate-500">Active model for diagram illustrations and math-to-image features.</span>
                    </div>
                    <select
                      value={(routingConfig as any).nvidia_image_model || 'black-forest-labs/flux.1-dev'}
                      onChange={(e) => updateRoutingConfig('nvidia_image_model', e.target.value)}
                      className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-[11px] font-bold text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500 transition-all mt-1"
                    >
                      <option value="black-forest-labs/flux.1-dev">Black Forest Labs FLUX.1 Dev</option>
                      <option value="black-forest-labs/flux.1-schnell">Black Forest Labs FLUX.1 Schnell</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Task Routing Matrix */}
            <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Zap className="text-amber-500" size={28} />
                    Task Routing Matrix
                  </h2>
                  <p className="text-slate-500 mt-1">Configure which AI provider handles specific system tasks.</p>
                </div>
                <div className="px-4 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-2xl text-xs font-bold flex items-center gap-2">
                  <Shield size={14} />
                  Admin Override Active
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {[
                  { id: 'deep_reasoning', label: 'Deep Reasoning & Proofs (STEM)', icon: Cpu, recommended: 'nvidia', desc: 'Complex calculus, physics derivations, and multi-step logic (NVIDIA Nemotron / Qwen-80B).' },
                  { id: 'coding', label: 'Software & Code Generation', icon: Terminal, recommended: 'nvidia', desc: 'Programming, debugging, algorithms, and SQL synthesis.' },
                  { id: 'chat', label: 'Student Chat (Q&A)', icon: Bot, recommended: 'groq', desc: 'Real-time conversational assistance.' },
                  { id: 'quiz', label: 'Quiz Generation', icon: Trophy, recommended: 'groq', desc: 'Creating assessments and practice questions.' },
                  { id: 'lesson', label: 'Lesson Content', icon: BookOpen, recommended: 'nvidia', desc: 'Writing detailed educational modules and deep topic guides.' },
                  { id: 'skeleton', label: 'Course Skeletons', icon: Layers, recommended: 'cohere', desc: 'Structuring curriculum outlines and hierarchies.' },
                  { id: 'recommendation', label: 'Smart Recommendations', icon: Star, recommended: 'cohere', desc: 'Analyzing student data for study plans.' },
                  { id: 'formulas', label: 'Formula Vault & Search', icon: Book, recommended: 'cohere', desc: 'Finding and generating university-level mathematical and scientific formulas.' },
                  { id: 'flashcard', label: 'Flashcard Generation', icon: FileText, recommended: 'huggingface', desc: 'Fast, repetitive text extraction for study aids.' },
                  { id: 'rag', label: 'Knowledge Retrieval', icon: Database, recommended: 'openrouter_free', desc: 'Searching and summarizing internal documents.' },
                  { id: 'vision', label: 'Vision Processing', icon: Search, recommended: 'gemini_direct', desc: 'Analyzing images and handwritten notes.' },
                  { id: 'past_questions', label: 'Past Questions Extraction', icon: FileText, recommended: 'gemini_direct', desc: 'Extracting questions from uploaded PDFs.' },
                  { id: 'voice_tutor', label: 'Voice Tutor Engine', icon: Mic, recommended: 'nvidia', desc: 'Interactive audio-to-text voice tutor study sessions (NVIDIA Nemotron Voicechat / Google Gemini Direct).' }
                ].map((task) => (
                  <div key={task.id} className="flex flex-col p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 gap-3">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 shadow-sm">
                          <task.icon size={20} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-bold text-slate-900 dark:text-white">{task.label}</h4>
                            <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold uppercase tracking-wider">
                              Recommended: {task.recommended}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{task.desc}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          onClick={() => updateRoutingConfig(task.id, task.recommended)}
                          className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors border border-indigo-200 dark:border-indigo-800"
                        >
                          Use Recommended
                        </button>
                        <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto scrollbar-hide max-w-full">
                          {['nvidia', 'gemini_direct', 'groq', 'mistral_direct', 'openrouter_free', 'cohere', 'huggingface'].map((provider) => (
                            <button
                              key={provider}
                              onClick={() => {
                                updateRoutingConfig(task.id, provider);
                                if (task.id === 'voice_tutor') {
                                  if (provider === 'nvidia') updateRoutingConfig('voice_tutor_model', 'nemotron-voicechat');
                                  else if (provider === 'gemini_direct') updateRoutingConfig('voice_tutor_model', 'gemini-2.0-flash-exp');
                                }
                              }}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold capitalize transition-all whitespace-nowrap ${
                                routingConfig[task.id as keyof typeof routingConfig] === provider
                                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                              }`}
                            >
                              {provider ? String(provider).replace(/_/g, ' ') : ''}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Conditional sub-configuration for Voice Tutor Model selection */}
                    {task.id === 'voice_tutor' && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-slate-200/60 dark:border-slate-700/60 pt-3">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mr-1">
                          Active Voice Model ({routingConfig.voice_tutor || 'nvidia'}):
                        </span>
                        {(routingConfig.voice_tutor === 'nvidia' || !routingConfig.voice_tutor
                          ? [
                              'nemotron-voicechat',
                              'nvidia/nemotron-3-super-120b-a12b',
                              'nvidia/nemotron-mini-4b-instruct',
                              'nvidia/llama-3.1-nemotron-70b-instruct',
                              'nvidia/nemotron-4-340b-instruct'
                            ]
                          : [
                              'gemini-2.0-flash-exp',
                              'gemini-2.5-flash',
                              'gemini-2.5-pro'
                            ]
                        ).map((model) => (
                          <button
                            key={model}
                            onClick={() => updateRoutingConfig('voice_tutor_model', model)}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-all ${
                              (routingConfig.voice_tutor_model || (routingConfig.voice_tutor === 'gemini_direct' ? 'gemini-2.0-flash-exp' : 'nemotron-voicechat')) === model
                                ? 'bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-400 font-bold shadow-xs'
                                : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            {model}
                          </button>
                        ))}
                        <span className="text-[10px] text-slate-400 italic ml-auto">
                          {routingConfig.voice_tutor === 'nvidia' ? '(NVIDIA NIM High-Performance Nemotron Voice Inference)' : '(Google Bidirectional Multimodal Streaming)'}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Interactive Dynamic Router Tester Playground */}
          <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-8 text-white shadow-xl border border-indigo-500/20 mt-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold flex items-center gap-2">
                  <Cpu className="text-emerald-400 animate-pulse" size={28} />
                  Dynamic AI Router & Model Role Inspector
                </h2>
                <p className="text-indigo-200/80 text-sm mt-1">
                  Test prompt intent classification, role persona injection, provider assignment, and live response timing.
                </p>
              </div>
              <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-xs font-bold uppercase tracking-wider">
                Live Test Playground
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <label className="block text-xs font-bold text-indigo-300 uppercase tracking-wider">
                  Test Student Prompt / Inquiry
                </label>
                <textarea
                  id="admin-router-test-prompt"
                  rows={4}
                  className="w-full p-4 rounded-2xl bg-slate-950/80 border border-indigo-500/30 text-white placeholder-slate-500 text-sm focus:ring-2 focus:ring-emerald-400 focus:outline-none"
                  placeholder="e.g. Derive Schrodinger's time-independent wave equation for a particle in a 1D potential box..."
                  defaultValue="Prove by induction that the sum of the first n positive integers is n(n+1)/2, and explain the step-by-step calculus derivation."
                />
                
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => {
                      const el = document.getElementById('admin-router-test-prompt') as HTMLTextAreaElement;
                      if (el) el.value = "Prove by induction that the sum of the first n positive integers is n(n+1)/2, and explain the step-by-step calculus derivation.";
                    }}
                    className="px-3 py-1.5 rounded-xl bg-indigo-900/40 border border-indigo-500/30 text-xs text-indigo-200 hover:bg-indigo-900/70"
                  >
                    Math Proof Sample
                  </button>
                  <button
                    onClick={() => {
                      const el = document.getElementById('admin-router-test-prompt') as HTMLTextAreaElement;
                      if (el) el.value = "Write a Python function implementing quicksort algorithm with O(n log n) average time complexity and memory optimization.";
                    }}
                    className="px-3 py-1.5 rounded-xl bg-indigo-900/40 border border-indigo-500/30 text-xs text-indigo-200 hover:bg-indigo-900/70"
                  >
                    Coding Sample
                  </button>
                  <button
                    onClick={() => {
                      const el = document.getElementById('admin-router-test-prompt') as HTMLTextAreaElement;
                      if (el) el.value = "Generate 5 key flashcards for organic chemistry functional groups and their infrared spectroscopy absorption bands.";
                    }}
                    className="px-3 py-1.5 rounded-xl bg-indigo-900/40 border border-indigo-500/30 text-xs text-indigo-200 hover:bg-indigo-900/70"
                  >
                    Flashcard Sample
                  </button>
                </div>

                <button
                  onClick={async () => {
                    const el = document.getElementById('admin-router-test-prompt') as HTMLTextAreaElement;
                    if (!el) return;
                    setRouterTestTelemetry({ loading: true });
                    try {
                      const { callAI } = await import('../services/ai');
                      const promptText = el.value || "Hello";
                      const start = Date.now();
                      const res = await callAI(promptText, "You are testing the AI router.", undefined, undefined, 'high', 'chat');
                      const elapsed = Date.now() - start;
                      setRouterTestTelemetry({
                        loading: false,
                        data: {
                          taskType: res.meta?.taskType || 'chat',
                          provider: res.meta?.providerLabel || res.meta?.providerUsed || 'Groq',
                          reasoning: res.meta?.reasoning || 'Auto Classified',
                          text: res.text || '',
                          elapsed
                        }
                      });
                    } catch (err: any) {
                      setRouterTestTelemetry({ loading: false, error: err.message });
                    }
                  }}
                  disabled={routerTestTelemetry?.loading}
                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 font-bold rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  {routerTestTelemetry?.loading ? <Loader2 className="animate-spin" size={18} /> : <Zap size={18} />}
                  {routerTestTelemetry?.loading ? 'Classifying & Testing Router...' : 'Test Dynamic Router Engine'}
                </button>
              </div>

              <div className="bg-slate-950/90 rounded-2xl p-5 border border-indigo-500/20 flex flex-col justify-between">
                <div>
                  <h3 className="text-xs font-bold text-indigo-300 uppercase tracking-wider mb-3">
                    Router Diagnostic Telemetry Output
                  </h3>
                  {routerTestTelemetry?.loading && (
                    <div className="text-xs text-amber-400 font-bold animate-pulse p-4 bg-amber-500/10 rounded-xl border border-amber-500/20">
                      Classifying intent and testing provider execution...
                    </div>
                  )}

                  {routerTestTelemetry?.error && (
                    <div className="text-xs text-rose-400 font-bold p-4 bg-rose-500/10 rounded-xl border border-rose-500/20">
                      Test Error: {routerTestTelemetry.error}
                    </div>
                  )}

                  {routerTestTelemetry?.data && (
                    <div className="space-y-3 text-xs text-slate-200">
                      <div className="p-3 bg-indigo-900/50 rounded-xl border border-indigo-500/30 flex justify-between items-center font-mono">
                        <div><span className="text-indigo-400 font-bold">Detected Workload:</span> <span className="text-emerald-300 font-bold uppercase">{routerTestTelemetry.data.taskType}</span></div>
                        <div className="text-[10px] text-slate-400">{routerTestTelemetry.data.elapsed}ms total</div>
                      </div>
                      <div className="p-3 bg-slate-900 rounded-xl border border-slate-700 font-mono">
                        <div><span className="text-amber-400 font-bold">Assigned Engine:</span> {routerTestTelemetry.data.provider}</div>
                        <div className="text-[10px] text-slate-400 mt-1"><span className="text-indigo-300 font-bold">Intent Logic:</span> {routerTestTelemetry.data.reasoning}</div>
                      </div>
                      <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-slate-200 max-h-80 overflow-y-auto leading-relaxed">
                        <span className="text-emerald-400 font-bold block mb-2 font-mono">Generated Output Snippet:</span>
                        <div className="prose prose-invert max-w-none text-xs">
                          <MarkdownRenderer content={routerTestTelemetry.data.text} />
                        </div>
                      </div>
                    </div>
                  )}

                  {!routerTestTelemetry && (
                    <div className="text-xs text-slate-400 italic">
                      Click "Test Dynamic Router Engine" above to trigger real-time intent classification and model execution inspect.
                    </div>
                  )}
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>Engine Status: <span className="text-emerald-400 font-bold">Active & Routing</span></span>
                  <span>Fallbacks: <span className="text-indigo-300 font-bold">Circuit Breaker Enabled</span></span>
                </div>
              </div>
            </div>
          </div>

          {/* API Key Management */}
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700 mt-8">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Key className="text-emerald-500" size={28} />
                  API Key Management
                  <button 
                    onClick={checkAIStatus}
                    disabled={isCheckingAI}
                    className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-emerald-500 disabled:opacity-50"
                    title="Refresh AI Status"
                  >
                    <RefreshCw size={16} className={isCheckingAI ? 'animate-spin' : ''} />
                  </button>
                </h2>
                <p className="text-slate-500 mt-1">Manage multiple API keys per provider for dynamic rotation and rate limit handling.</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                { id: 'gemini_direct', label: 'Gemini', desc: 'Direct API keys for Google Gemini SDK.' },
                { id: 'openrouter', label: 'OpenRouter', desc: 'Keys for OpenRouter.' },
                { id: 'groq', label: 'Groq (Turbo)', desc: 'Direct API keys for Groq Cloud.' },
                { id: 'mistral_direct', label: 'Mistral', desc: 'Direct API keys for Mistral AI Platform.' },
                { id: 'cohere', label: 'Cohere', desc: 'Direct API keys for Cohere AI.' },
                { id: 'huggingface', label: 'Hugging Face', desc: 'Direct API keys for Hugging Face Hub.' },
                { id: 'nvidia', label: 'NVIDIA NIM', desc: 'Direct API keys for NVIDIA Nemotron-3 Super 120B & NIM models.' }
              ].map(provider => (
                <div key={provider.id} className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-slate-900 dark:text-white">
                      {provider.label}
                    </h3>
                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                      aiProviderStatus[provider.id === 'openrouter' ? 'openrouter_free' : provider.id]?.active 
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' 
                        : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}>
                      {aiProviderStatus[provider.id === 'openrouter' ? 'openrouter_free' : provider.id]?.active ? 'Active' : 'Offline'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mb-2">
                    {provider.desc}
                  </p>
                  <div className="mb-4 flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase">
                    <span>Configured Keys:</span>
                    <span className="text-slate-900 dark:text-white">
                      {aiProviderStatus[provider.id === 'openrouter' ? 'openrouter_free' : provider.id]?.totalKeys || 0}
                    </span>
                    {aiProviderStatus[provider.id === 'openrouter' ? 'openrouter_free' : provider.id]?.exhaustedKeys > 0 && (
                      <span className="text-rose-500">
                        ({aiProviderStatus[provider.id === 'openrouter' ? 'openrouter_free' : provider.id]?.exhaustedKeys} exhausted)
                      </span>
                    )}
                  </div>
                  <button 
                    onClick={() => setSelectedProviderForKeyManager(provider.id)}
                    className="w-full py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Settings size={14} />
                    Manage Keys
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700 h-full flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <BarChart3 className="text-purple-500" size={24} />
                  Struggle Analytics
                </h3>
                <button 
                  onClick={fetchStruggleAnalytics}
                  className="text-sm font-bold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
                >
                  <RefreshCw size={14} className={isLoadingAnalytics ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </div>
              <p className="text-sm text-slate-500 mb-6">
                This tracks how many students click "Explain Simpler" on specific lessons. High counts indicate content that may be too difficult.
              </p>

              <div className="overflow-x-auto flex-grow">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Lesson / Topic</th>
                      <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Module</th>
                      <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Struggle Count</th>
                      <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Last Triggered</th>
                      <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {isLoadingAnalytics ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">Loading analytics...</td>
                      </tr>
                    ) : (struggleAnalytics || []).length > 0 ? (
                      (struggleAnalytics || []).map((item, idx) => (
                        <tr key={idx} className="border-b border-slate-100 dark:border-slate-700/50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                          <td className="py-4">
                            <div className="font-bold text-slate-900 dark:text-white">{item.subTopicTitle}</div>
                            <div className="text-xs text-slate-400 font-mono">{item.subTopicId}</div>
                          </td>
                          <td className="py-4 text-slate-600 dark:text-slate-300">{item.moduleTitle}</td>
                          <td className="py-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                              item.count > 10 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 
                              item.count > 5 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                              'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            }`}>
                              {item.count} Requests
                            </span>
                          </td>
                          <td className="py-4 text-slate-500 text-xs">
                            {item.lastTriggered ? (
                              item.lastTriggered._seconds ? 
                                new Date(item.lastTriggered._seconds * 1000).toLocaleString() :
                                new Date(item.lastTriggered).toLocaleString()
                            ) : 'N/A'}
                          </td>
                          <td className="py-4 text-right">
                            <button 
                              disabled={remediatingId === item.subTopicId}
                              className="text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 flex items-center gap-1.5 justify-end ml-auto disabled:opacity-50"
                              onClick={() => handleRemediateLesson(item)}
                            >
                              {remediatingId === item.subTopicId ? (
                                <>
                                  <Loader2 size={14} className="animate-spin" />
                                  Remediating...
                                </>
                              ) : (
                                <>
                                  <Bot size={14} />
                                  AI Rewrite
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">No struggle data recorded yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Chat Analytics Section */}
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700 h-full flex flex-col">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <MessageSquare className="text-blue-500" size={24} />
                  Chat Analytics
                </h3>
                <button 
                  onClick={fetchChatAnalytics}
                  className="text-sm font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  <RefreshCw size={14} className={isLoadingChatAnalytics ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </div>
              <p className="text-sm text-slate-500 mb-6">
                Discover what students are asking the AI most often. Use this data to identify knowledge gaps and plan future content.
              </p>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-grow">
                {/* Top Topics */}
                <div className="flex flex-col">
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4 uppercase tracking-wider">Top Topics</h4>
                  {isLoadingChatAnalytics ? (
                    <div className="py-8 text-center text-slate-500 text-sm flex-grow flex items-center justify-center">Loading topics...</div>
                  ) : (chatAnalytics?.topTopics || []).length > 0 ? (
                    <div className="space-y-3 flex-grow overflow-y-auto max-h-[400px] custom-scrollbar pr-2">
                      {(chatAnalytics?.topTopics || []).map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-100 dark:border-slate-700/50">
                          <span className="font-bold text-slate-800 dark:text-slate-200 capitalize">{item.topic}</span>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                            {item.count} Mentions
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-slate-500 text-sm flex-grow flex items-center justify-center">No topic data available.</div>
                  )}
                </div>

                {/* Recent Queries */}
                <div className="flex flex-col">
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4 uppercase tracking-wider">Recent Queries</h4>
                  {isLoadingChatAnalytics ? (
                    <div className="py-8 text-center text-slate-500 text-sm flex-grow flex items-center justify-center">Loading queries...</div>
                  ) : (chatAnalytics?.recentQueries || []).length > 0 ? (
                    <div className="space-y-3 flex-grow overflow-y-auto max-h-[400px] custom-scrollbar pr-2">
                      {(chatAnalytics?.recentQueries || []).map((item, idx) => (
                        <div key={idx} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-100 dark:border-slate-700/50">
                          <p className="text-sm text-slate-800 dark:text-slate-200 line-clamp-2">"{item.query}"</p>
                          <div className="flex justify-between items-center mt-2">
                            <span className="text-xs text-slate-500 font-mono truncate max-w-[150px]">{item.context || 'General'}</span>
                            <span className="text-[10px] text-slate-400">
                              {item.timestamp ? (
                                item.timestamp._seconds ? 
                                  new Date(item.timestamp._seconds * 1000).toLocaleTimeString() :
                                  new Date(item.timestamp).toLocaleTimeString()
                              ) : ''}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-slate-500 text-sm flex-grow flex items-center justify-center">No recent queries.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Shield className="text-purple-500" size={24} />
                Live System Health & Infrastructure
              </h3>
              <button 
                onClick={fetchSystemHealth}
                disabled={isHealthProbing}
                className="px-4 py-2 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded-xl text-xs font-bold transition-all flex items-center gap-2 self-start sm:self-auto border border-purple-200 dark:border-purple-800 disabled:opacity-50"
              >
                {isHealthProbing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Run Live Probe
              </button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className={`p-4 rounded-2xl border ${systemHealth?.database?.status === 'connected' ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-800' : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700'}`}>
                  <div className="text-xs font-bold text-emerald-600 uppercase mb-1 flex items-center justify-between">
                    <span>Database</span>
                    {systemHealth?.database?.latencyMs !== undefined && (
                      <span className="text-[10px] font-mono">{systemHealth.database.latencyMs}ms</span>
                    )}
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white capitalize">
                    {systemHealth ? systemHealth.database?.status : 'Probing...'}
                  </div>
                </div>
                <div className="p-4 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800 rounded-2xl">
                  <div className="text-xs font-bold text-emerald-600 uppercase mb-1 flex items-center justify-between">
                    <span>AI Engine</span>
                    <span className="text-[10px] font-mono">
                      {systemHealth ? `${systemHealth.aiProviders?.totalConfigured ?? 0} Configured` : '...'}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    {systemHealth ? `${systemHealth.aiProviders?.activeCount ?? 0} Online & Ready` : 'Probing...'}
                  </div>
                </div>
                <div className="p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800 rounded-2xl">
                  <div className="text-xs font-bold text-blue-600 uppercase mb-1 flex items-center justify-between">
                    <span>RAG Index</span>
                    <span className="text-[10px] font-mono">
                      {systemHealth ? `${systemHealth.rag?.totalChunks ?? 0} Chunks` : '...'}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white capitalize">
                    {systemHealth ? systemHealth.rag?.status : 'Probing...'}
                  </div>
                </div>
                <div className={`p-4 rounded-2xl border ${systemHealth?.email?.configured ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-800'}`}>
                  <div className="text-xs font-bold uppercase mb-1 text-emerald-600 flex items-center justify-between">
                    <span>Email Service</span>
                    <span className="text-[10px] font-mono">
                      {systemHealth ? systemHealth.email?.provider : '...'}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    {systemHealth ? systemHealth.email?.status : 'Probing...'}
                  </div>
                </div>
                <div className={`p-4 rounded-2xl border ${(systemHealth?.memory?.heapUtilizationPct ?? 0) >= 85 ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-800' : 'bg-purple-50 dark:bg-purple-900/10 border-purple-100 dark:border-purple-800'}`}>
                  <div className="text-xs font-bold uppercase mb-1 text-purple-600 flex items-center justify-between">
                    <span>Dynamic Heap</span>
                    {systemHealth?.memory && (
                      <span className="text-[10px] font-mono">{systemHealth.memory.heapUtilizationPct}%</span>
                    )}
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    {systemHealth?.memory
                      ? `${systemHealth.memory.heapUsedMB} / ${systemHealth.memory.heapLimitMB} MB`
                      : 'Probing...'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Institution Structure Management */}
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
              <Globe className="text-indigo-500" size={24} />
              Institution Structure
            </h3>
            <p className="text-sm text-slate-500 mb-6">
              Dynamically add or remove Departments and Faculties across the platform.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Manage Departments */}
              <div className="space-y-4">
                <h4 className="font-bold text-slate-700 dark:text-slate-300">Departments</h4>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    id="new-dept-input"
                    className="flex-grow bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white"
                    placeholder="E.g. Computer Science"
                  />
                  <select 
                    id="new-dept-faculty"
                    className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white max-w-[150px]"
                  >
                    {faculties.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <button 
                    onClick={() => {
                      const dept = (document.getElementById('new-dept-input') as HTMLInputElement).value;
                      const faculty = (document.getElementById('new-dept-faculty') as HTMLSelectElement).value;
                      if(dept && faculty) {
                        addDepartment(dept.trim(), faculty);
                        (document.getElementById('new-dept-input') as HTMLInputElement).value = '';
                        showToast(`Added department: ${dept}`, 'success');
                      }
                    }}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-indigo-700"
                  >
                    Add
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                  {departments.map((dept, index) => (
                    <div key={index} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-100 dark:border-slate-700/50">
                      <div>
                        <p className="font-bold text-slate-800 dark:text-slate-200 text-sm">{dept}</p>
                        <p className="text-xs text-slate-500">{departmentToFaculty[dept] || 'Unknown Faculty'}</p>
                      </div>
                      <button onClick={() => {
                        setConfirmModal({
                          title: "Remove Department",
                          message: `Remove ${dept}? This won't delete courses but it removes it from dropdowns.`,
                          onConfirm: async () => {
                            await removeDepartment(dept);
                            showToast(`Removed department ${dept}`, 'success');
                            setConfirmModal(null);
                          }
                        });
                      }} className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'communications' && (
        <div className="space-y-8">
          {/* Sub-tab Navigation */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200/60 dark:border-slate-800 w-fit">
              {(['broadcast', 'email', 'settings', 'history'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveCommTab(tab)}
                  className={`px-5 py-2 rounded-xl text-sm font-bold capitalize transition-all ${
                    activeCommTab === tab 
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/25' 
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  {tab === 'email' ? 'Branded Email Hub' : tab === 'settings' ? 'SMTP & Trial Settings' : tab}
                </button>
              ))}
            </div>
          </div>

          {/* BROADCAST TAB */}
          {activeCommTab === 'broadcast' && (
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700 h-full flex flex-col">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                <Globe className="text-blue-500" size={24} />
                Global System Notification
              </h3>
              <p className="text-sm text-slate-500 mb-6">
                This message will appear as a banner on the dashboard of every student currently using the platform.
              </p>
              <div className="space-y-4 flex-grow flex flex-col">
                <textarea 
                  placeholder="Type your global announcement here..." 
                  value={notificationText}
                  onChange={(e) => setNotificationText(e.target.value)}
                  className="w-full flex-grow min-h-[150px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Optional: WhatsApp Channel Link</label>
                  <input 
                    type="url"
                    placeholder="https://chat.whatsapp.com/..." 
                    value={whatsappLink}
                    onChange={(e) => setWhatsappLink(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="flex justify-end pt-4">
                  <button 
                    onClick={handleSendNotification}
                    disabled={isSendingNotification || !notificationText}
                    className="w-full md:w-auto px-8 py-3 rounded-2xl font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSendingNotification ? <Loader2 size={20} className="animate-spin" /> : <Zap size={20} />}
                    Broadcast to All Students
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* BRANDED EMAIL HUB */}
          {activeCommTab === 'email' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Controls Column */}
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                    <FileText className="text-emerald-500" size={20} />
                    Select Delivery Mode
                  </h3>
                  
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      { id: 'custom', label: 'Custom Composer', desc: 'Handwrite bespoke HTML-supported email.' },
                      { id: 'welcome', label: 'Dynamic Welcome Template', desc: 'Branded onboarding email.' },
                      { id: 'reminder', label: 'Trial Expiration Template', desc: 'Pre-formatted urgency warning.' }
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => setEmailMode(mode.id as any)}
                        className={`text-left p-4 rounded-xl border transition-all ${
                          emailMode === mode.id 
                            ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-500 text-slate-900 dark:text-white ring-1 ring-emerald-500' 
                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/50 dark:hover:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        <p className="font-bold text-sm">{mode.label}</p>
                        <p className="text-xs text-slate-400 mt-1">{mode.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Main Dynamic Inputs */}
                <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Email Parameters</h3>
                  
                  {/* Common Recipient Input */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Student Recipient Email</label>
                    <input 
                      type="email"
                      placeholder="student@example.com" 
                      value={emailTo}
                      onChange={(e) => setEmailTo(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  {/* CUSTOM EMAIL FIELDS */}
                  {emailMode === 'custom' && (
                    <>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Sender Brand Name</label>
                        <input 
                          type="text"
                          placeholder="UniAce Team" 
                          value={emailFromName}
                          onChange={(e) => setEmailFromName(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Subject Line</label>
                        <input 
                          type="text"
                          placeholder="Important updates for your UniAce Account" 
                          value={emailSubject}
                          onChange={(e) => setEmailSubject(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Email Body (HTML supported)</label>
                        <textarea 
                          placeholder="Type personal content here..." 
                          value={emailBody}
                          onChange={(e) => setEmailBody(e.target.value)}
                          className="w-full min-h-[150px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                        />
                      </div>
                    </>
                  )}

                  {/* WELCOME EMAIL FIELDS */}
                  {emailMode === 'welcome' && (
                    <>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Student Display Name</label>
                        <input 
                          type="text"
                          placeholder="E.g. John Doe" 
                          value={commStudentName}
                          onChange={(e) => setCommStudentName(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Trial Duration (Days)</label>
                        <input 
                          type="number"
                          min="1"
                          max="90"
                          value={commWelcomeTrialDays}
                          onChange={(e) => setCommWelcomeTrialDays(parseInt(e.target.value) || 7)}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </>
                  )}

                  {/* TRIAL REMINDER FIELDS */}
                  {emailMode === 'reminder' && (
                    <>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Student Display Name</label>
                        <input 
                          type="text"
                          placeholder="E.g. Jane Smith" 
                          value={commStudentName}
                          onChange={(e) => setCommStudentName(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Days Left</label>
                          <select 
                            value={commDaysLeft}
                            onChange={(e) => setCommDaysLeft(parseInt(e.target.value) || 1)}
                            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          >
                            <option value="1">1 Day Left</option>
                            <option value="2">2 Days Left</option>
                            <option value="3">3 Days Left</option>
                            <option value="4">4 Days Left</option>
                            <option value="5">5 Days Left</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Trial Days</label>
                          <input 
                            type="number"
                            min="1"
                            value={commWelcomeTrialDays}
                            onChange={(e) => setCommWelcomeTrialDays(parseInt(e.target.value) || 7)}
                            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {/* Dispatch buttons */}
                  <div className="pt-4">
                    {emailMode === 'custom' && (
                      <button 
                        onClick={handleSendEmail}
                        disabled={isSendingEmail || !emailTo || !emailSubject || !emailBody}
                        className="w-full px-8 py-3.5 rounded-2xl font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/30 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSendingEmail ? <Loader2 size={20} className="animate-spin" /> : <Send size={18} />}
                        Send Custom Branded Email
                      </button>
                    )}

                    {emailMode === 'welcome' && (
                      <button 
                        onClick={() => handleSendWelcomeEmail(emailTo, commStudentName || emailTo.split('@')[0], commWelcomeTrialDays)}
                        disabled={isSendingWelcomeEmail || !emailTo}
                        className="w-full px-8 py-3.5 rounded-2xl font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/30 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSendingWelcomeEmail ? <Loader2 size={20} className="animate-spin" /> : <Zap size={18} />}
                        Send Branded Welcome Email
                      </button>
                    )}

                    {emailMode === 'reminder' && (
                      <button 
                        onClick={() => handleSendTrialReminderEmail(emailTo, commStudentName || emailTo.split('@')[0], commDaysLeft, commWelcomeTrialDays)}
                        disabled={isSendingTrialReminderEmail || !emailTo}
                        className="w-full px-8 py-3.5 rounded-2xl font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/30 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSendingTrialReminderEmail ? <Loader2 size={20} className="animate-spin" /> : <Clock size={18} />}
                        Send Trial Expiration Reminder
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Dynamic Live Preview Column */}
              <div className="lg:col-span-7 bg-slate-100 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-[2.2rem] p-6 shadow-inner flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Interactive Branded Live Preview</h4>
                  <span className="px-2.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                    SMTP Template Output
                  </span>
                </div>

                {/* Subject Header mock */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-4 text-xs space-y-1.5 shadow-sm">
                  <p><span className="text-slate-400 font-medium">To:</span> <span className="font-mono text-slate-700 dark:text-slate-300">{emailTo || 'student@example.com'}</span></p>
                  <p><span className="text-slate-400 font-medium">From:</span> <span className="font-semibold text-slate-700 dark:text-slate-300">{emailMode === 'custom' ? emailFromName || 'UniAce Team' : 'UniAce Team'} &lt;no-reply@uniace.app&gt;</span></p>
                  <p className="border-t border-slate-100 dark:border-slate-700/50 pt-1.5 mt-1.5">
                    <span className="text-slate-400 font-medium">Subject:</span>{' '}
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      {emailMode === 'custom' && (emailSubject || 'Important Update Regarding Your Account')}
                      {emailMode === 'welcome' && `Welcome to UniAce, ${commStudentName || 'Student'}! 🚀 Your ${commWelcomeTrialDays}-Day Premium Trial Starts Now`}
                      {emailMode === 'reminder' && `Your UniAce Premium Trial Ends in ${commDaysLeft} Day${commDaysLeft === 1 ? '' : 's'}! ⏳`}
                    </span>
                  </p>
                </div>

                {/* Visual rendering box */}
                <div className="bg-white text-[#1e293b] rounded-2xl p-6 shadow-sm border border-slate-200 max-h-[500px] overflow-y-auto font-sans leading-relaxed text-sm">
                  {/* Custom email preview */}
                  {emailMode === 'custom' && (
                    <div className="space-y-4">
                      {emailBody ? (
                        <div dangerouslySetInnerHTML={{ __html: String(emailBody).replace(/\n/g, '<br />') }} />
                      ) : (
                        <p className="text-slate-400 italic">No custom body text specified. Type inside the text box to preview live.</p>
                      )}
                    </div>
                  )}

                  {/* Welcome email preview */}
                  {emailMode === 'welcome' && (
                    <div className="max-w-[500px] mx-auto">
                      <div className="text-center mb-6">
                        <div className="text-3xl mb-1">🎓</div>
                        <h1 className="text-[#10b981] text-2xl font-extrabold m-0">UniAce</h1>
                        <p className="text-[#64748b] text-xs m-0">Your AI-Powered Academic Companion</p>
                      </div>

                      <div className="bg-[#f8fafc] rounded-3xl p-6 border border-[#e2e8f0] space-y-4">
                        <h2 className="text-lg font-bold text-slate-800 mt-0">Hi {commStudentName || 'Student'}, welcome to the future of studying! 🎓</h2>
                        
                        <p className="text-sm text-slate-600">You've just unlocked <strong>{commWelcomeTrialDays} Days of UniAce Premium</strong>. That means unlimited AI Tutor access, smart quizzes, and personalized study plans are all yours for the next week.</p>

                        <div className="bg-[#ecfdf5] border-l-4 border-[#10b981] p-4 rounded-r-lg">
                          <p className="m-0 font-bold text-[#065f46] text-xs">Your first "Aha!" moment is waiting.</p>
                          <p className="m-0 text-xs text-[#047857] mt-1">Don't let "blank page syndrome" slow you down. Try asking your first question right now!</p>
                        </div>

                        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">What to do first:</h3>
                        <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
                          <li><strong>Ask a tough question:</strong> Paste that physics problem or math derivation you've been stuck on.</li>
                          <li><strong>Generate a Quiz:</strong> Turn any topic into a 5-minute practice session.</li>
                          <li><strong>Install the App:</strong> Add UniAce to your home screen for 1-tap access.</li>
                        </ul>

                        <div className="text-center pt-2">
                          <span className="bg-[#10b981] text-white px-6 py-2.5 rounded-xl text-xs font-bold inline-block cursor-pointer">
                            Open My AI Tutor 🚀
                          </span>
                        </div>

                        <p className="text-[10px] text-[#94a3b8] text-center mt-4">
                          Your trial ends in {commWelcomeTrialDays} days. We'll remind you before it expires so you don't miss a beat.
                        </p>
                      </div>

                      <div className="text-center mt-6 pt-4 border-t border-slate-100 text-[11px] text-[#64748b] space-y-1">
                        <p className="m-0">&copy; {new Date().getFullYear()} UniAce Ecosystem. All rights reserved.</p>
                        <p className="text-[#94a3b8] m-0"><strong>Security Note:</strong> UniAce will never ask you to download a .exe or .apk file.</p>
                      </div>
                    </div>
                  )}

                  {/* Reminder email preview */}
                  {emailMode === 'reminder' && (
                    <div className="max-w-[500px] mx-auto">
                      <div className="text-center mb-6">
                        <div className="text-3xl mb-1">🎓</div>
                        <h1 className="text-[#10b981] text-2xl font-extrabold m-0">UniAce</h1>
                        <p className="text-[#64748b] text-xs m-0">Your AI-Powered Academic Companion</p>
                      </div>

                      <div className="bg-[#fffbeb] rounded-3xl p-6 border border-[#fde68a] space-y-4">
                        <h2 className="text-lg font-bold text-[#92400e] mt-0">Time is flying, {commStudentName || 'Student'}! ⏳</h2>
                        
                        <p className="text-sm text-slate-600">Your {commWelcomeTrialDays}-day UniAce Premium trial is coming to an end. In just <strong>{commDaysLeft} day{commDaysLeft === 1 ? '' : 's'}</strong>, you'll lose access to your advanced study tools.</p>

                        <div className="bg-white border border-[#fde68a] p-4 rounded-xl space-y-2">
                          <p className="m-0 font-bold text-slate-800 text-xs">What you'll lose access to:</p>
                          <ul className="list-disc pl-5 text-xs text-slate-500 space-y-1">
                            <li><strong>Unlimited AI Tutoring:</strong> No more instant help with complex formulas.</li>
                            <li><strong>Smart Quiz Generation:</strong> Back to manual practice.</li>
                            <li><strong>Personalized Study Plans:</strong> Your roadmap to an "A" will be locked.</li>
                          </ul>
                        </div>

                        <p className="text-xs font-bold text-center text-slate-700">Don't lose your momentum. Upgrade now to keep mastering your courses!</p>

                        <div className="text-center pt-2">
                          <span className="bg-[#10b981] text-white px-6 py-2.5 rounded-xl text-xs font-bold inline-block cursor-pointer">
                            Keep My Premium Access 🚀
                          </span>
                        </div>
                      </div>

                      <div className="text-center mt-6 pt-4 border-t border-slate-100 text-[11px] text-[#64748b] space-y-1">
                        <p className="m-0">&copy; {new Date().getFullYear()} UniAce Ecosystem. All rights reserved.</p>
                        <p className="text-[#94a3b8] m-0"><strong>Pro Tip:</strong> You can upgrade anytime from your Profile settings.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SMTP & TRIAL POLICY SETTINGS TAB */}
          {activeCommTab === 'settings' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
              {/* Left Settings: Default Trial Duration Policy */}
              <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700 space-y-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/30 text-indigo-500">
                    <Clock size={24} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Default Trial Policy</h3>
                    <p className="text-xs text-slate-400">Configure global welcome period parameters</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Global Default Welcome Period</p>
                    <p className="text-3xl font-black text-indigo-600 dark:text-indigo-400">
                      {systemConfig.trialDays || 7} Days
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                      New students receive this many premium trial days automatically upon sign up. Welcome and expiration warning templates will synchronize with this configuration.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Adjust Default Trial Days</label>
                    <div className="flex gap-3">
                      <input 
                        type="number"
                        min="1"
                        max="365"
                        defaultValue={systemConfig.trialDays || 7}
                        id="policy-trial-days-input"
                        className="w-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white font-mono font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        onClick={() => {
                          const val = (document.getElementById('policy-trial-days-input') as HTMLInputElement).value;
                          const parsed = parseInt(val);
                          if (parsed > 0) {
                            updateSystemConfig({ trialDays: parsed });
                            showToast(`Saved Default Trial Period: ${parsed} days!`, 'success');
                          } else {
                            showToast('Please enter a positive number', 'error');
                          }
                        }}
                        className="flex-grow px-6 py-3 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
                      >
                        Save Configuration
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Settings: SMTP Server Diagnostics & Connections */}
              <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-500">
                      <Activity size={24} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">SMTP Diagnostics</h3>
                      <p className="text-xs text-slate-400">Test SMTP transport connections</p>
                    </div>
                  </div>

                  <button 
                    onClick={handleDebugEmail}
                    disabled={isDebuggingEmail}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all border border-slate-200 dark:border-slate-700 shadow-sm disabled:opacity-50"
                  >
                    {isDebuggingEmail ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
                    Verify Server SMTP
                  </button>
                </div>

                {emailDebugInfo ? (
                  <div className="space-y-4">
                    {/* SMTP Credentials Detail */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {[
                        { label: 'SMTP Host', value: emailDebugInfo.config.host, present: !!emailDebugInfo.config.host },
                        { label: 'SMTP User', value: emailDebugInfo.config.user, present: !!emailDebugInfo.config.user },
                        { label: 'SMTP Pass', value: emailDebugInfo.config.hasPass ? '********' : 'Missing', present: emailDebugInfo.config.hasPass },
                        { label: 'From Email', value: emailDebugInfo.config.from, present: !!emailDebugInfo.config.from },
                      ].map((item, idx) => (
                        <div key={idx} className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">{item.label}</p>
                          <p className={`font-mono truncate ${item.present ? 'text-slate-800 dark:text-slate-200' : 'text-rose-500 font-bold'}`}>
                            {item.value || 'Not Configured'}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Connection Test Outcome */}
                    <div className={`p-4 rounded-2xl border text-xs ${emailDebugInfo.connection.success ? 'bg-emerald-50 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-800/80' : 'bg-red-50 dark:bg-red-950/10 border-red-200 dark:border-red-800/80'}`}>
                      <p className={`font-bold ${emailDebugInfo.connection.success ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                        Connection Status: {emailDebugInfo.connection.success ? 'Online & Verified ✓' : 'Failed ❌'}
                      </p>
                      <p className="font-mono mt-1 text-slate-500 dark:text-slate-400 break-all leading-normal">
                        {emailDebugInfo.connection.message}
                      </p>
                      {!emailDebugInfo.connection.success && emailDebugInfo.connection.message?.includes('535') && (
                        <div className="bg-amber-50 dark:bg-amber-950/15 border border-amber-200/80 dark:border-amber-900/40 p-3.5 rounded-xl mt-3 text-amber-800 dark:text-amber-200">
                          <p className="font-bold flex items-center gap-1.5 mb-1">
                            <AlertCircle size={14} /> Authentication Tip
                          </p>
                          <p className="leading-normal">
                            Error 535 usually means incorrect credentials. If you are using Gmail, make sure you are using a 16-character App Password, not your regular account password.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Dynamic Diagnostic Health Mail Sender */}
                    <div className="pt-4 border-t border-slate-100 dark:border-slate-700/60">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Send Diagnostic Health Email</h4>
                      <div className="flex gap-2">
                        <input 
                          type="email"
                          id="diagnostic-recipient-field"
                          placeholder="recipient@example.com"
                          defaultValue={auth.currentUser?.email || ''}
                          className="flex-grow bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <button 
                          onClick={() => {
                            const email = (document.getElementById('diagnostic-recipient-field') as HTMLInputElement).value;
                            if (email) handleSendTestEmail(email);
                            else showToast("Please enter a recipient email", "error");
                          }}
                          disabled={isSendingTestEmail}
                          className="px-5 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                          {isSendingTestEmail ? <Loader2 size={16} className="animate-spin" /> : <Send size={14} />}
                          Send Diagnostic
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-400">
                    <p className="text-sm">Click "Verify Server SMTP" to load SMTP transport credentials and run diagnostics.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* HISTORIC TAB */}
          {activeCommTab === 'history' && (
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-700 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Clock className="text-indigo-500" size={24} />
                    Communication Broadcast History
                  </h3>
                  <p className="text-slate-500 text-sm mt-1">Delivery records, targeted audiences, and transmission channels.</p>
                </div>
                <button 
                  onClick={fetchBroadcastHistory}
                  disabled={isLoadingBroadcastHistory}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                >
                  <RefreshCw size={14} className={isLoadingBroadcastHistory ? 'animate-spin' : ''} />
                  Refresh Logs
                </button>
              </div>

              {isLoadingBroadcastHistory ? (
                <div className="py-12 text-center text-slate-400">
                  <Loader2 size={32} className="animate-spin mx-auto mb-2 text-indigo-500" />
                  <p className="text-sm">Fetching delivery history...</p>
                </div>
              ) : broadcastHistory.length === 0 ? (
                <div className="py-12 text-center bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-slate-400">
                  <Send size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm font-medium">No broadcast transmissions recorded yet.</p>
                  <p className="text-xs text-slate-500 mt-1">Send an in-app announcement or email dispatch to populate this record.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-400 uppercase tracking-wider">
                        <th className="pb-3">Channel</th>
                        <th className="pb-3">Title / Subject</th>
                        <th className="pb-3">Target Audience</th>
                        <th className="pb-3">Date</th>
                        <th className="pb-3 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm divide-y divide-slate-100 dark:divide-slate-700/50">
                      {(broadcastHistory || []).map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                          <td className="py-3.5">
                            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider ${
                              item.type === 'email' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                            }`}>
                              {item.type || 'in-app'}
                            </span>
                          </td>
                          <td className="py-3.5">
                            <div className="font-bold text-slate-900 dark:text-white">{item.title || item.subject || 'Broadcast'}</div>
                            <div className="text-xs text-slate-500 line-clamp-1 max-w-md">{item.message || item.previewText || ''}</div>
                          </td>
                          <td className="py-3.5 text-xs text-slate-600 dark:text-slate-300 capitalize font-medium">
                            {item.targetAudience || 'All Users'} {item.department ? `(${item.department})` : ''}
                          </td>
                          <td className="py-3.5 text-xs text-slate-400 font-mono">
                            {item.createdAt ? (
                              item.createdAt._seconds ? new Date(item.createdAt._seconds * 1000).toLocaleString() :
                              new Date(item.createdAt).toLocaleString()
                            ) : 'Recent'}
                          </td>
                          <td className="py-3.5 text-right">
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle size={12} />
                              {item.status || 'Delivered'}
                            </span>
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
      )}

      {activeTab === 'analytics' && (
        <div className="space-y-8 animate-fade-in">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-sm">
            <div>
              <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
                <BarChart3 className="text-indigo-600 dark:text-indigo-400" size={32} />
                Platform Analytics & Visual Insights
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                Real-time tracking of student engagement, daily active users, and academic course growth.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  showToast("Syncing analytics with database...", "info");
                  await fetchUsers();
                  await fetchLogs();
                  await fetchSystemStats();
                  showToast("Analytics refreshed!", "success");
                }}
                className="px-5 py-3 rounded-2xl font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm transition-all flex items-center gap-2 shadow-sm border border-slate-200 dark:border-slate-600 active:scale-95"
              >
                <RefreshCw size={18} />
                Refresh Insights
              </button>
            </div>
          </div>

          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* DAU Card */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-15 transition-opacity">
                <Users size={64} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="bg-indigo-50 dark:bg-indigo-950/40 w-12 h-12 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-6">
                <Users size={24} />
              </div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Daily Active Users (DAU)</div>
              <div className="text-3xl font-black text-slate-900 dark:text-white mt-1">
                {userStats.activeToday}
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-xs font-bold text-emerald-500">
                <span className="bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md">+{userStats.total > 0 ? Math.round((userStats.activeToday / userStats.total) * 100) : 0}% ratio</span>
                <span className="text-slate-400">stickiness index</span>
              </div>
            </div>

            {/* Total Interactions Card */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-15 transition-opacity">
                <Activity size={64} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-950/40 w-12 h-12 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-6">
                <Activity size={24} />
              </div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Weekly Interactions</div>
              <div className="text-3xl font-black text-slate-900 dark:text-white mt-1">
                {logs.length.toLocaleString()}
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-xs font-bold text-emerald-500">
                <span className="bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md">Live feed</span>
                <span className="text-slate-400">unfiltered activity</span>
              </div>
            </div>

            {/* Course Enrollment Card */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-15 transition-opacity">
                <BookOpen size={64} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/40 w-12 h-12 rounded-2xl flex items-center justify-center text-amber-600 dark:text-amber-400 mb-6">
                <BookOpen size={24} />
              </div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Enrolled Courses</div>
              <div className="text-3xl font-black text-slate-900 dark:text-white mt-1">
                {users.reduce((acc, u) => acc + (u.enrolledCourses?.length || 0), 0).toLocaleString()}
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-xs font-bold text-amber-500">
                <span className="bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-md">
                  {users.length > 0 ? (users.reduce((acc, u) => acc + (u.enrolledCourses?.length || 0), 0) / users.length).toFixed(1) : 0} avg
                </span>
                <span className="text-slate-400">per student</span>
              </div>
            </div>

            {/* AI Spark Burn Rate */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-15 transition-opacity">
                <Zap size={64} className="text-purple-600 dark:text-purple-400" />
              </div>
              <div className="bg-purple-50 dark:bg-purple-950/40 w-12 h-12 rounded-2xl flex items-center justify-center text-purple-600 dark:text-purple-400 mb-6">
                <Zap size={24} />
              </div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">AI Spark Intensity</div>
              <div className="text-3xl font-black text-slate-900 dark:text-white mt-1">
                {systemStats.totalSparksConsumed.toLocaleString()}
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-xs font-bold text-purple-500">
                <span className="bg-purple-50 dark:bg-purple-950/40 px-2 py-0.5 rounded-md">
                  {Math.round(systemStats.totalSparksConsumed / Math.max(users.length, 1)).toLocaleString()} avg
                </span>
                <span className="text-slate-400">sparks per user</span>
              </div>
            </div>
          </div>

          {/* Charts Row 1: DAU & Engagement */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Chart 1: Daily Active Users (DAU) over Time */}
            <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
              <div className="mb-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Users className="text-indigo-600 dark:text-indigo-400" size={24} />
                    Daily Active Users (DAU) Trend
                  </h3>
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2.5 py-1 rounded-full border border-indigo-100 dark:border-indigo-900/50">
                    Last 7 Days
                  </span>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                  Daily active users participating on the platform.
                </p>
              </div>

              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analyticsChartData.dauTrend}>
                    <defs>
                      <linearGradient id="dauGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.5} />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }} 
                      dy={10} 
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }} 
                      dx={-10} 
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '16px',
                        border: 'none',
                        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        backdropFilter: 'blur(8px)'
                      }}
                      itemStyle={{ fontWeight: 600 }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="DAU" 
                      stroke="#6366f1" 
                      fillOpacity={1} 
                      fill="url(#dauGradient)" 
                      strokeWidth={3} 
                      activeDot={{ r: 6, strokeWidth: 0 }} 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 2: User Engagement Trends */}
            <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
              <div className="mb-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Activity className="text-emerald-600 dark:text-emerald-400" size={24} />
                    User Engagement Categories
                  </h3>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-100 dark:border-emerald-900/50">
                    Activity Breakdown
                  </span>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                  Distribution of educational interactions, AI responses, and administrator processes.
                </p>
              </div>

              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analyticsChartData.engagementTrend} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.5} />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }} 
                      dy={10} 
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }} 
                      dx={-10} 
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '16px',
                        border: 'none',
                        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        backdropFilter: 'blur(8px)'
                      }}
                      itemStyle={{ fontWeight: 600 }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 600, paddingTop: 10 }} />
                    <Bar dataKey="Student Actions" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="AI Tutor Hits" fill="#a855f7" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Admin Actions" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Charts Row 2: Course Enrollments over Time */}
          <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="mb-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <BookOpen className="text-amber-600 dark:text-amber-400" size={24} />
                  Cumulative Course Enrollment Growth
                </h3>
                <span className="text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-full border border-amber-100 dark:border-amber-900/50">
                  Adoption Curve
                </span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                Cumulative count of academic course registrations across the platform over time.
              </p>
            </div>

            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analyticsChartData.enrollmentTrend}>
                  <defs>
                    <linearGradient id="enrollGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.5} />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }} 
                    dy={10} 
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }} 
                    dx={-10} 
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '16px',
                      border: 'none',
                      boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      backdropFilter: 'blur(8px)'
                    }}
                    itemStyle={{ fontWeight: 600 }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="Enrollments" 
                    stroke="#f59e0b" 
                    fillOpacity={1} 
                    fill="url(#enrollGradient)" 
                    strokeWidth={4} 
                    activeDot={{ r: 6, strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Deep Insight Tables Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Top Active Students */}
            <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                <Trophy className="text-yellow-500" size={24} />
                Most Active Scholars
              </h3>
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-700 text-xs font-black uppercase text-slate-400 tracking-wider">
                      <th className="pb-4 pl-2">Student</th>
                      <th className="pb-4">Sparks Consumed</th>
                      <th className="pb-4 text-right pr-2">Rank</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                    {users
                      .slice()
                      .sort((a, b) => (b.total_sparks_used || 0) - (a.total_sparks_used || 0))
                      .slice(0, 5)
                      .map((u, idx) => (
                        <tr key={idx} className="group hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                          <td className="py-4 pl-2">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold flex items-center justify-center text-sm border border-slate-200 dark:border-slate-600">
                                {u.displayName ? u.displayName.charAt(0).toUpperCase() : u.email.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-bold text-slate-800 dark:text-slate-200 text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                  {u.displayName || 'Active Student'}
                                </div>
                                <div className="text-xs text-slate-400 truncate max-w-[150px] md:max-w-[200px]">
                                  {u.email}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 font-black text-slate-700 dark:text-slate-300 text-sm">
                            {(u.total_sparks_used || 0).toLocaleString()}
                          </td>
                          <td className="py-4 text-right pr-2">
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-xs font-black ${
                              idx === 0 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-400' :
                              idx === 1 ? 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300' :
                              idx === 2 ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-500' :
                              'bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            }`}>
                              #{idx + 1}
                            </span>
                          </td>
                        </tr>
                      ))}
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-slate-400 text-sm font-medium">
                          No active students found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Department Adoption */}
            <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                <Layers className="text-indigo-500" size={24} />
                Departmental Adoption
              </h3>
              <div className="space-y-4 flex-1 flex flex-col justify-center">
                {departments.map((dept, idx) => {
                  const deptUsersCount = users.filter(u => u.department === dept).length;
                  const percent = users.length > 0 ? Math.round((deptUsersCount / users.length) * 100) : 0;
                  
                  return (
                    <div key={idx} className="group">
                      <div className="flex justify-between text-sm font-bold mb-1.5">
                        <span className="text-slate-700 dark:text-slate-300">{dept}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-slate-400">({deptUsersCount} {deptUsersCount === 1 ? 'user' : 'users'})</span>
                          <span className="text-slate-600 dark:text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {percent}%
                          </span>
                        </div>
                      </div>
                      <div className="h-3 w-full bg-slate-100 dark:bg-slate-900/40 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full transition-all duration-1000" 
                          style={{ width: `${percent}%` }} 
                        />
                      </div>
                    </div>
                  );
                })}
                {departments.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-4">No departments defined.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{confirmModal.title}</h3>
            <p className="text-slate-500 dark:text-slate-400 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button 
                onClick={confirmModal.onConfirm}
                className="px-6 py-2 rounded-xl font-bold bg-red-600 hover:bg-red-700 text-white"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API Status & Latency Benchmark Tab */}
      {activeTab === 'api-status' && (
        <div className="space-y-8 animate-fade-in">
          {/* Header Card */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-sm">
            <div>
              <div className="flex items-center gap-3">
                <div className="p-3 bg-indigo-100 dark:bg-indigo-950/60 rounded-2xl text-indigo-600 dark:text-indigo-400">
                  <Activity size={30} />
                </div>
                <div>
                  <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                    API Status & Model Benchmarks
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Real-time ping testing, latency benchmarks, and active health monitoring for configured AI model endpoints.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* Auto Ping Toggle */}
              <button
                onClick={() => setAutoPingEnabled(!autoPingEnabled)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all border ${
                  autoPingEnabled
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className={`w-2.5 h-2.5 rounded-full ${autoPingEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                {autoPingEnabled ? 'Auto-Ping ON (30s)' : 'Auto-Ping OFF'}
              </button>

              {/* Ping All Endpoints Button */}
              <button
                onClick={() => pingAllProviders()}
                disabled={isPingingAll}
                className="px-6 py-3 rounded-2xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white text-sm transition-all flex items-center gap-2 shadow-lg shadow-indigo-600/20 active:scale-95 disabled:opacity-50"
              >
                <RefreshCw size={18} className={isPingingAll ? 'animate-spin' : ''} />
                {isPingingAll ? 'Pinging All Endpoints...' : 'Ping All Endpoints'}
              </button>
            </div>
          </div>

          {/* Top Overview KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* KPI 1: Monitored Endpoints */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Monitored Endpoints</span>
                <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                  <Bot size={20} />
                </div>
              </div>
              <div className="text-3xl font-black text-slate-900 dark:text-white mt-3">7 Providers</div>
              <div className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                NVIDIA, Gemini, Groq, Mistral, etc.
              </div>
            </div>

            {/* KPI 2: Online Endpoints Count */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Online Status</span>
                <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle size={20} />
                </div>
              </div>
              <div className="text-3xl font-black text-slate-900 dark:text-white mt-3">
                {
                  Object.values(pingResults).filter(r => r.status === 'online').length > 0
                    ? `${Object.values(pingResults).filter(r => r.status === 'online').length} / ${Object.keys(pingResults).length || 7} Online`
                    : `${Object.values(aiProviderStatus).filter(p => p.active).length} / 7 Ready`
                }
              </div>
              <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-2 flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                Active circuit breakers
              </div>
            </div>

            {/* KPI 3: Average Latency */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Average Latency</span>
                <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                  <Zap size={20} />
                </div>
              </div>
              <div className="text-3xl font-black text-slate-900 dark:text-white mt-3">
                {(() => {
                  const onlinePings = Object.values(pingResults).filter(r => r.latencyMs !== null && r.latencyMs !== undefined);
                  if (onlinePings.length === 0) return 'N/A';
                  const avg = Math.round(onlinePings.reduce((acc, curr) => acc + (curr.latencyMs || 0), 0) / onlinePings.length);
                  return `${avg}ms`;
                })()}
              </div>
              <div className="text-xs text-slate-500 mt-2">
                Real-time API response speed
              </div>
            </div>

            {/* KPI 4: Fastest Endpoint */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Fastest Endpoint</span>
                <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                  <TrendingUp size={20} />
                </div>
              </div>
              <div className="text-xl font-black text-slate-900 dark:text-white mt-3 truncate">
                {(() => {
                  const sortedPings = Object.values(pingResults)
                    .filter(r => r.status === 'online' && r.latencyMs)
                    .sort((a, b) => (a.latencyMs || 9999) - (b.latencyMs || 9999));
                  if (sortedPings.length === 0) return 'Groq / NVIDIA';
                  const fastest = sortedPings[0];
                  const names: Record<string, string> = {
                    nvidia: 'NVIDIA NIM',
                    gemini_direct: 'Gemini',
                    groq: 'Groq Llama 3',
                    mistral_direct: 'Mistral AI',
                    openrouter_free: 'OpenRouter',
                    cohere: 'Cohere',
                    huggingface: 'Hugging Face'
                  };
                  return `${names[fastest.provider] || fastest.provider} (${fastest.latencyMs}ms)`;
                })()}
              </div>
              <div className="text-xs text-purple-600 dark:text-purple-400 font-semibold mt-2">
                Optimal for streaming
              </div>
            </div>
          </div>

          {/* Provider Ping Endpoint Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { id: 'nvidia', name: 'NVIDIA NIM Inference', model: 'Nemotron Voicechat / Nemotron-3 120B', icon: Cpu, accent: 'border-emerald-500/30 bg-emerald-50/20 dark:bg-emerald-500/5', badgeColor: 'bg-emerald-500' },
              { id: 'gemini_direct', name: 'Google Gemini Direct', model: 'Gemini 2.0 Flash / Pro & Multimodal', icon: Shield, accent: 'border-blue-500/30 bg-blue-50/20 dark:bg-blue-500/5', badgeColor: 'bg-blue-500' },
              { id: 'groq', name: 'Groq Llama 3', model: 'Ultra-Fast Llama 3.1 70B & 8B', icon: Zap, accent: 'border-orange-500/30 bg-orange-50/20 dark:bg-orange-500/5', badgeColor: 'bg-orange-500' },
              { id: 'mistral_direct', name: 'Mistral AI Direct', model: 'Mistral Small, Large & Codestral', icon: Star, accent: 'border-purple-500/30 bg-purple-50/20 dark:bg-purple-500/5', badgeColor: 'bg-purple-500' },
              { id: 'openrouter_free', name: 'OpenRouter Gateway', model: 'Free Tier Multi-Model Router', icon: Globe, accent: 'border-indigo-500/30 bg-indigo-50/20 dark:bg-indigo-500/5', badgeColor: 'bg-indigo-500' },
              { id: 'cohere', name: 'Cohere Command', model: 'Cohere Command R+ & RAG Embedding', icon: Cpu, accent: 'border-cyan-500/30 bg-cyan-50/20 dark:bg-cyan-500/5', badgeColor: 'bg-cyan-500' },
              { id: 'huggingface', name: 'Hugging Face Inference', model: 'Open-Source Models & Flashcards', icon: Sparkles, accent: 'border-yellow-500/30 bg-yellow-50/20 dark:bg-yellow-500/5', badgeColor: 'bg-yellow-500' }
            ].map((p) => {
              const pingInfo = pingResults[p.id];
              const provStatus = aiProviderStatus[p.id] || { active: false, totalKeys: 0, exhaustedKeys: 0, usingEnv: false, usingDb: false };
              const isPingingThis = pingingProvider === p.id;
              
              const isOnline = pingInfo ? pingInfo.status === 'online' : provStatus.active;
              const isDegraded = pingInfo?.status === 'degraded';
              const latency = pingInfo?.latencyMs;

              return (
                <div key={p.id} className={`p-6 rounded-[2rem] border-2 transition-all flex flex-col justify-between ${p.accent}`}>
                  <div>
                    {/* Header Row */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-3 rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-200/60 dark:border-slate-700">
                          <p.icon size={22} className="text-slate-800 dark:text-slate-200" />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900 dark:text-white text-base">{p.name}</h3>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate max-w-[180px]">{p.model}</p>
                        </div>
                      </div>

                      {/* Status Pill */}
                      <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                        isOnline
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-400 border border-emerald-300/50'
                          : isDegraded
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-400 border border-amber-300/50'
                          : 'bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-400 border border-red-300/50'
                      }`}>
                        <div className={`w-2 h-2 rounded-full ${
                          isOnline ? 'bg-emerald-500 animate-pulse' : isDegraded ? 'bg-amber-500' : 'bg-red-500'
                        }`} />
                        {isOnline ? 'Online' : isDegraded ? 'Degraded' : 'Offline'}
                      </div>
                    </div>

                    {/* Latency Meter Bar */}
                    <div className="my-4 bg-white dark:bg-slate-800/80 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Latency</span>
                        <span className={`text-xs font-black font-mono ${
                          !latency ? 'text-slate-400' : latency < 500 ? 'text-emerald-600 dark:text-emerald-400' : latency < 1500 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
                        }`}>
                          {latency ? `${latency}ms` : (aiMetrics[p.id]?.latency || 'Not Pinged')}
                        </span>
                      </div>

                      {/* Visual Bar */}
                      <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 rounded-full ${
                            !latency ? 'w-0' : latency < 500 ? 'bg-emerald-500' : latency < 1500 ? 'bg-amber-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(8, ((latency || 500) / 2500) * 100))}%` }}
                        />
                      </div>
                    </div>

                    {/* Key Info & Details */}
                    <div className="space-y-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                      <div className="flex justify-between items-center py-1 border-b border-slate-200/40 dark:border-slate-700/40">
                        <span className="text-slate-400">Keys Configured:</span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {provStatus.totalKeys} ({provStatus.exhaustedKeys} exhausted)
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-slate-200/40 dark:border-slate-700/40">
                        <span className="text-slate-400">Key Source:</span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {provStatus.usingEnv && provStatus.usingDb ? 'ENV + DB' : provStatus.usingEnv ? 'ENV' : provStatus.usingDb ? 'Firestore DB' : 'None'}
                        </span>
                      </div>

                      {/* Ping Result Note or Error */}
                      {pingInfo && (
                        <div className="mt-2 text-[11px]">
                          {pingInfo.error ? (
                            <p className="text-red-600 dark:text-red-400 font-semibold bg-red-50 dark:bg-red-950/40 p-2 rounded-xl border border-red-200 dark:border-red-800">
                              ⚠️ {pingInfo.error}
                            </p>
                          ) : (
                            <p className="text-slate-500 dark:text-slate-400 italic">
                              Sample: "{pingInfo.textSample || 'OK'}"
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Individual Ping Action Button */}
                  <div className="mt-6 flex gap-2">
                    <button
                      onClick={() => pingAllProviders(p.id)}
                      disabled={isPingingThis || isPingingAll}
                      className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-xs transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                    >
                      <RefreshCw size={14} className={isPingingThis ? 'animate-spin text-indigo-500' : ''} />
                      {isPingingThis ? 'Pinging...' : 'Ping Endpoint'}
                    </button>
                    <button
                      onClick={() => setSelectedProviderForKeyManager(p.id as any)}
                      className="py-2.5 px-3 rounded-xl font-bold text-xs bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-all flex items-center justify-center"
                      title="Manage Keys"
                    >
                      <Key size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Latency Comparison Benchmark & Task Routing Table */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Latency Benchmark Visual Chart */}
            <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <BarChart3 className="text-indigo-500" size={24} />
                    Latency Benchmarks (Fastest to Slowest)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Comparative response times measured during live ping tests.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {[
                  { id: 'nvidia', name: 'NVIDIA NIM' },
                  { id: 'gemini_direct', name: 'Google Gemini' },
                  { id: 'groq', name: 'Groq Llama 3' },
                  { id: 'mistral_direct', name: 'Mistral AI' },
                  { id: 'openrouter_free', name: 'OpenRouter' },
                  { id: 'cohere', name: 'Cohere Command' },
                  { id: 'huggingface', name: 'Hugging Face' }
                ]
                  .map(p => ({
                    ...p,
                    latency: pingResults[p.id]?.latencyMs || null
                  }))
                  .sort((a, b) => (a.latency || 9999) - (b.latency || 9999))
                  .map((item, index) => {
                    const isMeasured = item.latency !== null;
                    const latencyVal = item.latency || 0;
                    const percentage = isMeasured ? Math.min(100, Math.max(12, (latencyVal / 2000) * 100)) : 0;

                    return (
                      <div key={item.id} className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs font-bold">
                          <span className="text-slate-800 dark:text-slate-200 flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 flex items-center justify-center text-[10px]">
                              {index + 1}
                            </span>
                            {item.name}
                          </span>
                          <span className={isMeasured ? 'text-indigo-600 dark:text-indigo-400 font-mono' : 'text-slate-400 font-mono'}>
                            {isMeasured ? `${latencyVal}ms` : 'Not Measured'}
                          </span>
                        </div>
                        <div className="w-full h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              !isMeasured
                                ? 'bg-slate-300 dark:bg-slate-600'
                                : latencyVal < 400
                                ? 'bg-emerald-500'
                                : latencyVal < 1200
                                ? 'bg-indigo-500'
                                : 'bg-amber-500'
                            }`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* System Task Routing Matrix */}
            <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
              <div>
                <h3 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Layers className="text-indigo-500" size={24} />
                  Active Task Routing Matrix
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  AI providers currently mapped to execute specific platform workloads.
                </p>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {[
                  { task: 'Voice Tutor Engine', provider: routingConfig.voice_tutor || 'nvidia', desc: 'Real-time interactive study audio & chat', recommended: 'NVIDIA NIM' },
                  { task: 'Deep STEM & Proofs', provider: 'nvidia', desc: 'Calculus, Physics proofs & step-by-step logic', recommended: 'NVIDIA NIM' },
                  { task: 'Interactive Q&A Chat', provider: routingConfig.chat || 'groq', desc: 'Ultra-fast conversational tutor responses', recommended: 'Groq Llama 3' },
                  { task: 'Lesson Brainstorming', provider: routingConfig.lesson || 'nvidia', desc: 'Curriculum development and topic outlines', recommended: 'NVIDIA NIM' },
                  { task: 'Vision & Image OCR', provider: routingConfig.vision || 'gemini_direct', desc: 'Extracting text and diagram analytics', recommended: 'Google Gemini' },
                  { task: 'Knowledge Base (RAG)', provider: routingConfig.rag || 'openrouter_free', desc: 'Retrieving and summarizing uploaded PDFs', recommended: 'OpenRouter' }
                ].map((item, idx) => (
                  <div key={idx} className="py-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-sm text-slate-900 dark:text-white">{item.task}</div>
                      <div className="text-[11px] text-slate-500">{item.desc}</div>
                    </div>
                    <div className="text-right">
                      <span className="px-3 py-1 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold text-xs uppercase border border-indigo-200 dark:border-indigo-800/60">
                        {item.provider}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'demo-studio' && <DemoStudioTab />}
      {activeTab === 'pricing' && <PricingManagerTab />}
      {activeTab === 'db-accounting' && <DatabaseAccountingTab onSwitchTab={(tab) => setActiveTab(tab as any)} />}
      {activeTab === 'database-engine' && <DatabaseEngineTab onSwitchTab={(tab) => setActiveTab(tab as any)} />}
      {activeTab === 'challenges' && <ChallengesManagerTab />}
      {activeTab === 'support' && <SupportManagerTab />}
      {activeTab === 'formulas' && <FormulasManagerTab />}
      {activeTab === 'math-engine' && <MathEngineTab />}
      {activeTab === 'academic-mcp' && <AcademicMCPDashboard />}
      {activeTab === 'golden-set' && <GoldenSetTrustTab />}
      {activeTab === 'feature-switches' && <FeatureSwitchesTab />}

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-xl flex items-center gap-3 animate-bounce-in ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' :
          toast.type === 'error' ? 'bg-red-600 text-white' :
          'bg-slate-900 text-white'
        }`}>
          {toast.type === 'success' && <CheckCircle size={20} />}
          {toast.type === 'error' && <AlertCircle size={20} />}
          <span className="font-bold">{toast.message}</span>
        </div>
      )}

      {/* Role Guide Modal */}
      {isRoleGuideOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-xl max-w-md w-full border border-slate-200 dark:border-zinc-800">
            <h2 className="text-xl font-bold mb-4 text-slate-900 dark:text-white">Role Capabilities Guide</h2>
            <ul className="space-y-3 text-sm text-slate-600 dark:text-zinc-400">
              <li><strong className="text-emerald-600">Admin:</strong> Full system access, user management, role assignment, system logs.</li>
              <li><strong className="text-emerald-600">Tutor:</strong> Curriculum management, view analytics, premium access.</li>
              <li><strong className="text-emerald-600">Moderator:</strong> Support ticket management, view analytics, premium access.</li>
              <li><strong className="text-emerald-600">Student:</strong> Standard study features, access to assigned courses.</li>
            </ul>
            <button 
              onClick={() => setIsRoleGuideOpen(false)}
              className="mt-6 w-full py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* API Key Manager Modal */}
      {selectedProviderForKeyManager && (
        <ApiKeyManagerModal
          provider={selectedProviderForKeyManager}
          onClose={() => {
            setSelectedProviderForKeyManager(null);
            checkAIStatus();
          }}
        />
      )}
    </div>
  );
}
