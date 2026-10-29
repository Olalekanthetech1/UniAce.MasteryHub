import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  Swords,
  Trophy,
  Shield,
  Zap,
  Skull,
  Search,
  CheckCircle,
  Loader2,
  Star,
  Target,
  Flame,
  Clock,
  Users,
  Bot,
  History,
  Radio
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { Battle, BattlePlayer, QuizQuestion, CourseId } from '../types';
import { AIService } from '../services/ai';
import Leaderboard from './Leaderboard';
import { ChallengesService, ArenaChallenge } from '../services/challengesConfig';
import MarkdownRenderer from './MarkdownRenderer';

interface ArenaProps {
  activeCourseId: CourseId | null;
}

interface WaitingLobbyItem {
  id: string;
  topicId: string;
  hostUid: string;
  hostName: string;
  hostAvatar: string;
  questionCount: number;
  createdAt: string;
}

interface ChallengerTelemetry {
  calibratedMasteryPct: number;
  tier: 'beginner' | 'intermediate' | 'advanced';
  tierLabel: string;
  pacingRangeLabel: string;
  minStepMs: number;
  maxStepMs: number;
  baseStepMs: number;
  targetAccuracyPct: number;
  quizScorePct: number | null;
  attemptsSampled: number;
  srsRetentionPct: number | null;
  srsCardsSampled: number;
  srsCardsRetained: number;
  courseWinRatePct: number | null;
  courseWins: number;
  courseLosses: number;
  arenaBattlesSampled: number;
  lessonsCompleted: number;
}

interface LobbyTelemetry {
  serverNow: number;
  serverIsoTime: string;
  onlineCount: number;
  waitingBattles: WaitingLobbyItem[];
  historicalGhostCount: number;
  latestGhostMeta: {
    battleId: string;
    playerName: string;
    recordedAt: string;
  } | null;
  challengerTelemetry?: ChallengerTelemetry;
}

interface MissedQuestionBreakdownItem {
  questionIndex: number;
  question: string;
  selectedOption: string;
  correctAnswer: string;
  curriculumExplanation: string;
  elapsedSeconds: number | null;
}

const MAX_HEALTH = 100;

export default function Arena({ activeCourseId }: ArenaProps) {
  const { user, profile, refreshProfile } = useAuth() as any;
  const { courses } = useCourses();

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(activeCourseId);
  const [challenges, setChallenges] = useState<ArenaChallenge[]>([]);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [view, setView] = useState<'lobby' | 'matching' | 'battle' | 'result'>('lobby');
  const [battleId, setBattleId] = useState<string | null>(null);
  const [battleData, setBattleData] = useState<Battle | null>(null);
  const [timeLeft, setTimeLeft] = useState(60);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [launchingSpar, setLaunchingSpar] = useState<'ghost_replay' | 'ai_challenger' | null>(null);
  const [matchStatus, setMatchStatus] = useState('Searching for opponent...');
  const [matchWaitSeconds, setMatchWaitSeconds] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [serverUtcClock, setServerUtcClock] = useState<string>(() => new Date().toISOString().slice(11, 19));
  const [tacticalDebrief, setTacticalDebrief] = useState<string | null>(null);
  const [loadingDebrief, setLoadingDebrief] = useState(false);
  const [schedulingSrs, setSchedulingSrs] = useState(false);
  const [srsScheduled, setSrsScheduled] = useState(false);
  const [lobbyTelemetry, setLobbyTelemetry] = useState<LobbyTelemetry>({
    serverNow: Date.now(),
    serverIsoTime: new Date().toISOString(),
    onlineCount: 1,
    waitingBattles: [],
    historicalGhostCount: 0,
    latestGhostMeta: null
  });

  const wsRef = useRef<WebSocket | null>(null);
  const serverClockOffsetRef = useRef<number>(0);
  const matchStartEpochRef = useRef<number | null>(null);
  const battleIdRef = useRef<string | null>(null);
  const viewRef = useRef(view);
  const debriefRequestedForBattleRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeCourseId) {
      setSelectedCourseId(activeCourseId);
    } else if (!selectedCourseId) {
      const firstId = Object.keys(courses)[0] || null;
      if (firstId) setSelectedCourseId(firstId);
    }
  }, [activeCourseId, courses, selectedCourseId]);

  useEffect(() => {
    battleIdRef.current = battleId;
  }, [battleId]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const updateServerClockOffset = useCallback((serverNowMs?: number) => {
    if (typeof serverNowMs === 'number' && Number.isFinite(serverNowMs) && serverNowMs > 0) {
      serverClockOffsetRef.current = serverNowMs - Date.now();
    }
  }, []);

  const getAuthoritativeNowMs = useCallback(() => {
    return Date.now() + serverClockOffsetRef.current;
  }, []);

  const fetchLobbyTelemetry = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const query = selectedCourseId ? `?topicId=${encodeURIComponent(selectedCourseId)}` : '';
      const res = await fetch(`/api/arena/lobby-telemetry${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        updateServerClockOffset(data.serverNow);
        setLobbyTelemetry((prev) => ({
          ...prev,
          ...data,
          waitingBattles: Array.isArray(data.waitingBattles) ? data.waitingBattles : prev.waitingBattles
        }));
      }
    } catch (err) {
      console.warn('[Arena] Failed to fetch lobby telemetry:', err);
    }
  }, [user, selectedCourseId, updateServerClockOffset]);

  useEffect(() => {
    void fetchLobbyTelemetry();
  }, [fetchLobbyTelemetry]);

  // Subscribe to live challenges from Neon PostgreSQL
  const refreshChallenges = useCallback(async () => {
    const data = await ChallengesService.getChallenges();
    setChallenges(data.filter((c) => c.active !== false));
  }, []);

  useEffect(() => {
    const unsubscribe = ChallengesService.subscribeChallenges((data) => {
      setChallenges(data.filter((c) => c.active !== false));
    });
    return () => unsubscribe();
  }, []);

  // Real-Time WebSocket Connection (/api/arena/ws)
  useEffect(() => {
    if (!user) return;
    let isUnmounted = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;

    const connectWs = async () => {
      if (isUnmounted) return;
      try {
        const token = await user.getIdToken();
        if (isUnmounted) return;
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const params = new URLSearchParams({ token });
        if (selectedCourseId) params.set('courseId', selectedCourseId);
        if (battleIdRef.current) params.set('battleId', battleIdRef.current);

        const ws = new WebSocket(`${proto}//${window.location.host}/api/arena/ws?${params.toString()}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (isUnmounted) return;
          setWsConnected(true);
          if (battleIdRef.current) {
            ws.send(JSON.stringify({ type: 'battle:subscribe', battleId: battleIdRef.current }));
          }
          pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'clock:sync', clientSentAt: Date.now() }));
            }
          }, 15000);
        };

        ws.onmessage = (event) => {
          if (isUnmounted) return;
          try {
            const payload = JSON.parse(event.data);
            if (payload.serverNow) {
              updateServerClockOffset(payload.serverNow);
            }

            if (payload.type === 'clock:sync') {
              if (typeof payload.onlineCount === 'number') {
                setLobbyTelemetry((prev) => ({ ...prev, onlineCount: Math.max(1, payload.onlineCount) }));
              }
              return;
            }

            if (payload.type === 'presence:snapshot') {
              setLobbyTelemetry((prev) => ({
                ...prev,
                onlineCount: Math.max(1, Number(payload.onlineCount || 1))
              }));
              return;
            }

            if (payload.type === 'lobby:queue_updated' && Array.isArray(payload.waitingBattles)) {
              setLobbyTelemetry((prev) => ({
                ...prev,
                waitingBattles: payload.waitingBattles
              }));
              return;
            }

            if (
              (payload.type === 'battle:started' ||
                payload.type === 'battle:state' ||
                payload.type === 'battle:finished') &&
              payload.battle
            ) {
              const incomingBattle = payload.battle as Battle;
              setBattleData(incomingBattle);
              setBattleId(incomingBattle.id);

              if (incomingBattle.status === 'active' && viewRef.current !== 'battle') {
                setSelectedAnswer(null);
                setSubmittingAnswer(false);
                setView('battle');
              } else if (incomingBattle.status === 'finished') {
                setView('result');
                void refreshChallenges();
                if (typeof refreshProfile === 'function') {
                  void refreshProfile();
                }
              }
            }
          } catch (err) {
            console.warn('[Arena WS] Parse error:', err);
          }
        };

        ws.onclose = () => {
          setWsConnected(false);
          if (pingInterval) clearInterval(pingInterval);
          if (!isUnmounted) {
            reconnectTimer = setTimeout(connectWs, 2500);
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch (err) {
        if (!isUnmounted) {
          reconnectTimer = setTimeout(connectWs, 3000);
        }
      }
    };

    void connectWs();

    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingInterval) clearInterval(pingInterval);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
      }
    };
  }, [user, updateServerClockOffset, refreshChallenges, refreshProfile]);

  // Subscribe socket whenever battleId changes
  useEffect(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && battleId) {
      ws.send(JSON.stringify({ type: 'battle:subscribe', battleId }));
    }
  }, [battleId]);

  // Real-Life Time Function: Authoritative Server Clock & Battle Countdown
  useEffect(() => {
    const updateClocks = () => {
      const nowMs = getAuthoritativeNowMs();
      setServerUtcClock(new Date(nowMs).toISOString().slice(11, 19));

      if (view === 'matching' && matchStartEpochRef.current) {
        const waitedSec = Math.max(0, Math.floor((nowMs - matchStartEpochRef.current) / 1000));
        setMatchWaitSeconds(waitedSec);
      }

      if (view === 'battle' && battleData) {
        const expiresMs =
          battleData.expiresAtEpochMs ||
          (battleData.expiresAt ? new Date(battleData.expiresAt).getTime() : null);

        if (expiresMs && Number.isFinite(expiresMs)) {
          const remaining = Math.max(0, Math.ceil((expiresMs - nowMs) / 1000));
          setTimeLeft(remaining);
          if (remaining <= 0 && battleData.status === 'active') {
            void syncBattleStateOnce(battleData.id);
          }
        }
      }
    };

    updateClocks();
    const interval = setInterval(updateClocks, 250);
    return () => clearInterval(interval);
  }, [view, battleData, getAuthoritativeNowMs]);

  const syncBattleStateOnce = async (targetBattleId: string) => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/arena/battles/${encodeURIComponent(targetBattleId)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        updateServerClockOffset(json.serverNow);
        if (json.battle) {
          setBattleData(json.battle);
          if (json.battle.status === 'active' && viewRef.current === 'matching') {
            setView('battle');
          } else if (json.battle.status === 'finished') {
            setView('result');
            void refreshChallenges();
            if (typeof refreshProfile === 'function') void refreshProfile();
          }
        }
      }
    } catch (err) {
      console.warn('[Arena] State sync check failed:', err);
    }
  };

  // Fallback reconciliation every 6s only if WebSocket is temporarily reconnecting
  useEffect(() => {
    if (!battleId || !user || wsConnected) return;
    const timer = setInterval(() => {
      void syncBattleStateOnce(battleId);
    }, 6000);
    return () => clearInterval(timer);
  }, [battleId, user, wsConnected]);

  // Compute missed questions from authoritative server battleData
  const getMissedQuestionsFromBattle = useCallback((b: Battle | null): MissedQuestionBreakdownItem[] => {
    if (!b || !user) return [];
    const myPlayer = b.player1.uid === user.uid ? b.player1 : b.player2;
    const actionLog = Array.isArray(myPlayer?.actionLog) ? myPlayer!.actionLog! : [];
    const questions = Array.isArray(b.questions) ? b.questions : [];
    const missed: MissedQuestionBreakdownItem[] = [];

    for (const act of actionLog) {
      if (!act.correct) {
        const q = questions[act.questionIndex];
        if (q) {
          missed.push({
            questionIndex: act.questionIndex,
            question: q.question,
            selectedOption: act.selectedOption || 'No answer selected',
            correctAnswer: q.correctAnswer,
            curriculumExplanation: q.explanation || '',
            elapsedSeconds: typeof act.elapsedMs === 'number' ? Number((act.elapsedMs / 1000).toFixed(1)) : null
          });
        }
      }
    }
    return missed;
  }, [user]);

  // Trigger Post-Match Tactical Breakdown from live AI engine when duel finishes
  useEffect(() => {
    if (view !== 'result' || !battleData) return;
    if (debriefRequestedForBattleRef.current === battleData.id) return;
    debriefRequestedForBattleRef.current = battleData.id;

    const missed = getMissedQuestionsFromBattle(battleData);
    setSrsScheduled(false);
    if (missed.length === 0) {
      setTacticalDebrief(null);
      setLoadingDebrief(false);
      return;
    }

    let cancelled = false;
    setLoadingDebrief(true);
    setTacticalDebrief(null);

    const generateLiveTacticalBreakdown = async () => {
      try {
        const courseId = battleData.topicId || selectedCourseId || 'University Course';
        const promptLines = missed.map(
          (m, i) =>
            `${i + 1}. Question (Q${m.questionIndex + 1}): ${m.question}\n   - Student Selected: ${m.selectedOption}\n   - Correct Answer: ${m.correctAnswer}\n   - Core Explanation: ${m.curriculumExplanation}`
        );
        const prompt = `You are the [AI Challenger] Sparring Partner in the UniAce Academic Arena for ${courseId}.
The student just completed a timed Arena duel and missed the following ${missed.length} question(s):

${promptLines.join('\n\n')}

Provide a concise, high-impact **Post-Match Tactical Breakdown** for each missed question:
1. **Why the Chosen Option Failed**: Briefly explain the misconception or trap in the student's selected answer.
2. **Core Academic Principle**: State the exact formula, theorem, or concept that proves the correct answer (use valid KaTeX $...$ or $$...$$ where appropriate).
3. **Speed-Recognition Cue**: Give a 1-sentence tactical shortcut so the student can spot and solve this in under 8 seconds in their next duel.`;

        const responseText = await AIService.generateContent(
          prompt,
          'You are the [AI Challenger] Sparring Partner providing a rigorous, encouraging post-match tactical breakdown. Use clean Markdown and valid KaTeX math notation.'
        );
        if (!cancelled) {
          setTacticalDebrief(responseText);
        }
      } catch (err: any) {
        if (!cancelled) {
          setTacticalDebrief(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingDebrief(false);
        }
      }
    };

    void generateLiveTacticalBreakdown();
    return () => {
      cancelled = true;
    };
  }, [view, battleData, selectedCourseId, getMissedQuestionsFromBattle]);

  const handleScheduleMissedToSrs = async () => {
    if (!battleData || !user || schedulingSrs || srsScheduled) return;
    const missed = getMissedQuestionsFromBattle(battleData);
    if (missed.length === 0) return;

    setSchedulingSrs(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/user/srs/batch-schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          courseId: battleData.topicId || selectedCourseId || 'general',
          paperTitle: `${battleData.topicId || selectedCourseId} Arena Duel`,
          missedQuestions: missed.map((m) => ({
            id: `${battleData.id}_q${m.questionIndex}`,
            question: m.question,
            correctAnswer: m.correctAnswer,
            userAnswer: m.selectedOption,
            explanation: m.curriculumExplanation,
            topic: `${battleData.topicId || selectedCourseId} Arena Sparring`
          }))
        })
      });
      if (res.ok) {
        setSrsScheduled(true);
        toast.success(`Scheduled ${missed.length} missed question(s) into Spaced Repetition!`);
        void fetchLobbyTelemetry();
      } else {
        toast.error('Failed to schedule flashcards into SRS');
      }
    } catch (err) {
      toast.error('Error scheduling missed questions into SRS');
    } finally {
      setSchedulingSrs(false);
    }
  };

  const getChallengeIcon = (iconName?: string) => {
    const lower = (iconName || '').toLowerCase();
    switch (lower) {
      case 'trophy': return Trophy;
      case 'flame': return Flame;
      case 'zap': return Zap;
      case 'target': return Target;
      case 'star': return Star;
      case 'swords':
      default: return Swords;
    }
  };

  const generateBattleQuestions = async (courseId: string): Promise<QuizQuestion[]> => {
    const course = courses[courseId as CourseId];
    if (course && course.syllabus.length > 0) {
      const moduleIndex = Math.floor((getAuthoritativeNowMs() / 1000) % course.syllabus.length);
      const selectedModule = course.syllabus[moduleIndex];
      const questions = await AIService.generateQuiz(
        selectedModule,
        undefined,
        5,
        'multiple-choice',
        false,
        3,
        profile?.academic_level,
        profile?.department,
        profile?.displayName
      );
      if (questions && questions.length > 0) {
        return questions;
      }
    }
    throw new Error('Could not find suitable curriculum to generate battle questions.');
  };

  // 1. Matchmaking Logic (Neon PostgreSQL + WebSocket Subscription)
  const findMatch = async (overrideCourseId?: string, targetWaitingBattleId?: string) => {
    const targetCourse = overrideCourseId || selectedCourseId;
    if (!user || !targetCourse) {
      toast.error('Please select a course before entering the Arena.');
      return;
    }

    setSelectedCourseId(targetCourse);
    setView('matching');
    matchStartEpochRef.current = getAuthoritativeNowMs();
    setMatchWaitSeconds(0);
    setMatchStatus(targetWaitingBattleId ? 'Joining challenger lobby...' : 'Scanning the arena...');

    try {
      void fetchLobbyTelemetry();
      let questions: QuizQuestion[] = [];
      if (!targetWaitingBattleId) {
        setMatchStatus(`Generating live ${targetCourse} combat questions...`);
        questions = await generateBattleQuestions(targetCourse);
      }

      const player: BattlePlayer = {
        uid: user.uid,
        name: profile?.displayName || user.displayName || 'Gladiator',
        avatar: profile?.photoURL || user.photoURL || '',
        score: 0,
        currentQuestionIndex: 0,
        health: MAX_HEALTH,
        status: 'ready'
      };

      const token = await user.getIdToken();
      const res = await fetch('/api/arena/matchmake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          topicId: targetCourse,
          player,
          questions,
          targetBattleId: targetWaitingBattleId
        })
      });

      if (!res.ok) throw new Error('Matchmaking request failed');
      const data = await res.json();
      updateServerClockOffset(data.serverNow);
      setBattleId(data.battleId);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'battle:subscribe', battleId: data.battleId }));
      }

      if (data.battle) {
        setBattleData(data.battle);
        if (data.joined || data.battle.status === 'active') {
          setMatchStatus('Opponent found! Entering arena...');
          setView('battle');
          return;
        }
      }
      matchStartEpochRef.current = getAuthoritativeNowMs();
      setMatchStatus('Waiting for a live challenger...');
    } catch (error: any) {
      console.error('Matchmaking error:', error);
      toast.error(error?.message || 'Error finding match. Please try again.');
      setView('lobby');
    }
  };

  // 2. Direct Sparring Launch from Lobby or Waiting Screen ([AI Challenger] or Ghost Replay)
  const startDirectSparring = async (mode: 'ghost_replay' | 'ai_challenger') => {
    const targetCourse = selectedCourseId;
    if (!user || !targetCourse || launchingSpar) {
      if (!targetCourse) toast.error('Please select a course first.');
      return;
    }

    setLaunchingSpar(mode);
    setView('matching');
    matchStartEpochRef.current = getAuthoritativeNowMs();
    setMatchWaitSeconds(0);
    setMatchStatus(
      mode === 'ai_challenger'
        ? `Generating live ${targetCourse} combat questions for [AI Challenger] duel...`
        : `Loading recorded ${targetCourse} Ghost Replay from Neon PostgreSQL...`
    );

    try {
      let questions: QuizQuestion[] = [];
      if (mode === 'ai_challenger') {
        questions = await generateBattleQuestions(targetCourse);
        setMatchStatus(
          `Calibrating [AI Challenger] (${lobbyTelemetry.challengerTelemetry?.pacingRangeLabel || '12–15s / question'}) & starting duel...`
        );
      }

      const player: BattlePlayer = {
        uid: user.uid,
        name: profile?.displayName || user.displayName || 'Gladiator',
        avatar: profile?.photoURL || user.photoURL || '',
        score: 0,
        currentQuestionIndex: 0,
        health: MAX_HEALTH,
        status: 'ready'
      };

      const token = await user.getIdToken();
      const createRes = await fetch('/api/arena/matchmake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          topicId: targetCourse,
          player,
          questions,
          skipQueueJoin: true
        })
      });

      if (!createRes.ok) throw new Error('Failed to initialize sparring room');
      const createdData = await createRes.json();
      const newBattleId = createdData.battleId;
      setBattleId(newBattleId);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'battle:subscribe', battleId: newBattleId }));
      }

      const sparRes = await fetch(`/api/arena/battles/${encodeURIComponent(newBattleId)}/spar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ mode })
      });

      const sparData = await sparRes.json();
      if (!sparRes.ok) {
        toast.error(sparData.error || 'Could not launch sparring match');
        setView('lobby');
        return;
      }

      updateServerClockOffset(sparData.serverNow);
      if (sparData.battle) {
        setBattleData(sparData.battle);
        setSelectedAnswer(null);
        setSubmittingAnswer(false);
        setView('battle');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to launch sparring match');
      setView('lobby');
    } finally {
      setLaunchingSpar(null);
    }
  };

  // Launch Sparring when already inside a waiting battle
  const handleLaunchSparring = async (mode: 'ghost_replay' | 'ai_challenger') => {
    if (!battleId || !user || launchingSpar) return;
    setLaunchingSpar(mode);
    setMatchStatus(
      mode === 'ai_challenger'
        ? `Calibrating [AI Challenger] (${lobbyTelemetry.challengerTelemetry?.pacingRangeLabel || '12–15s / question'}) & starting duel...`
        : `Loading recorded ${selectedCourseId} Ghost Replay...`
    );
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/arena/battles/${encodeURIComponent(battleId)}/spar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ mode })
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not launch sparring match');
        return;
      }
      updateServerClockOffset(data.serverNow);
      if (data.battle) {
        setBattleData(data.battle);
        setSelectedAnswer(null);
        setSubmittingAnswer(false);
        setView('battle');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to start sparring match');
    } finally {
      setLaunchingSpar(null);
    }
  };

  // 3. Server-Authoritative Gameplay Answer Submission
  const handleAnswer = async (option: string) => {
    if (!battleData || !battleId || !user || selectedAnswer || submittingAnswer) return;

    setSelectedAnswer(option);
    setSubmittingAnswer(true);

    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/arena/battles/${encodeURIComponent(battleId)}/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ selectedOption: option })
      });

      if (res.ok) {
        const json = await res.json();
        updateServerClockOffset(json.serverNow);
        if (json.battle) {
          setBattleData(json.battle);
          if (json.battle.status === 'finished') {
            setTimeout(() => {
              setView('result');
              void refreshChallenges();
              if (typeof refreshProfile === 'function') void refreshProfile();
            }, 600);
          }
        }
      }
    } catch (err) {
      console.error('Failed to submit battle answer:', err);
    } finally {
      setTimeout(() => {
        setSelectedAnswer(null);
        setSubmittingAnswer(false);
      }, 650);
    }
  };

  const handleClaimChallenge = async (challenge: ArenaChallenge) => {
    if (!challenge.completed || challenge.claimed || claimingId) return;
    setClaimingId(challenge.id);
    try {
      const result = await ChallengesService.claimChallengeReward(challenge.id);
      if (result.success) {
        toast.success(
          `Claimed +${result.reward} ${result.rewardType === 'sparks' ? 'AI Sparks' : 'XP'}!`
        );
        await refreshChallenges();
        if (typeof refreshProfile === 'function') {
          await refreshProfile();
        }
      } else {
        toast.error(result.error || 'Could not claim challenge reward');
      }
    } finally {
      setClaimingId(null);
    }
  };

  const cancelMatchmaking = async () => {
    if (battleId && user) {
      const token = await user.getIdToken();
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'battle:unsubscribe', battleId }));
      }
      await fetch(`/api/arena/battles/${encodeURIComponent(battleId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {});
    }
    setBattleId(null);
    setBattleData(null);
    setView('lobby');
    void fetchLobbyTelemetry();
  };

  const availableCourseIds = Object.keys(courses);
  const otherWaitingMatches = lobbyTelemetry.waitingBattles.filter(
    (b) => b.hostUid && b.hostUid !== user?.uid
  );
  const challengerCal = lobbyTelemetry.challengerTelemetry;
  const canLaunchGhostInLobby = lobbyTelemetry.historicalGhostCount > 0;

  // --- RENDERERS ---

  if (view === 'lobby') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col p-4 sm:p-6 lg:p-12 pb-24 lg:pb-12 no-scrollbar overflow-y-auto">
        <div className="max-w-6xl mx-auto w-full space-y-10">
          {/* Header */}
          <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-purple-400 font-black uppercase tracking-[0.2em] text-[10px] sm:text-xs">
                  <Swords size={16} />
                  <span>PvP Combat Zone</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-semibold text-slate-300">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                    }`}
                  />
                  <span>{wsConnected ? 'Real-Time WS Sync' : 'Reconnecting WS...'}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-400">
                  <Clock size={12} className="text-purple-400" />
                  <span>{serverUtcClock} UTC</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-semibold text-emerald-400">
                  <Users size={12} />
                  <span>{lobbyTelemetry.onlineCount} Online</span>
                </div>
              </div>
              <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight italic uppercase">
                The Arena
              </h1>
              <p className="text-slate-400 text-sm sm:text-base font-medium">
                Battle classmates in real-time WebSocket duels, challenge recorded Ghost Replays, or test your speed against telemetry-calibrated challengers.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              {availableCourseIds.length > 0 && (
                <select
                  value={selectedCourseId || ''}
                  onChange={(e) => setSelectedCourseId(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-white text-sm font-bold rounded-2xl px-4 py-3.5 focus:outline-none focus:border-purple-500"
                >
                  {availableCourseIds.map((cId) => (
                    <option key={cId} value={cId}>
                      {cId} — {courses[cId]?.title || cId}
                    </option>
                  ))}
                </select>
              )}

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-3xl flex items-center gap-4 shadow-xl">
                <div className="w-12 h-12 rounded-2xl bg-purple-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/20">
                  <Trophy size={24} />
                </div>
                <div>
                  <div className="text-2xl font-black text-white">#{profile?.rank || '1'}</div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    Global Rank
                  </div>
                </div>
              </div>

              <button
                onClick={() => findMatch()}
                disabled={!selectedCourseId || launchingSpar !== null}
                className="px-8 py-4 sm:px-10 sm:py-5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-[2rem] font-black text-base sm:text-xl shadow-2xl shadow-purple-600/30 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-3 cursor-pointer"
              >
                <Zap size={22} fill="currentColor" />
                ENTER BATTLE
              </button>
            </div>
          </header>

          {/* LIVE ADAPTIVE AI CHALLENGER ([AI Challenger] Sparring Partner) & GHOST REPLAY PANEL */}
          <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-purple-950/40 border border-purple-500/30 rounded-[2.5rem] p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 text-xs font-black uppercase tracking-wider">
                    <Bot size={14} />
                    [AI Challenger] Sparring Partner
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-950 border border-slate-800 text-xs font-bold text-emerald-400">
                    {challengerCal?.tierLabel || 'Beginner (<50% Course Mastery)'} •{' '}
                    {challengerCal?.pacingRangeLabel || '12–15s / question'}
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-white">
                  Live Adaptive AI Challenger &amp; Instant Sparring
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 max-w-3xl">
                  If no historical human match exists yet for <strong className="text-white">{selectedCourseId || 'this course'}</strong>, launch an instant duel against your telemetry-calibrated <strong className="text-purple-300">[AI Challenger]</strong>. Instead of random timers, the server reads your actual database telemetry to calibrate response speed and accuracy, followed by a live AI <strong className="text-white">Post-Match Tactical Breakdown</strong> of any question you miss.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <button
                  onClick={() => startDirectSparring('ai_challenger')}
                  disabled={!selectedCourseId || launchingSpar !== null}
                  className="px-6 py-3.5 bg-purple-600 hover:bg-purple-500 text-white rounded-2xl font-black text-sm shadow-lg shadow-purple-600/30 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2.5 cursor-pointer"
                >
                  <Bot size={18} />
                  {launchingSpar === 'ai_challenger'
                    ? 'Calibrating AI Challenger...'
                    : 'Spar with Adaptive AI Challenger'}
                </button>

                <button
                  onClick={() => startDirectSparring('ghost_replay')}
                  disabled={!selectedCourseId || !canLaunchGhostInLobby || launchingSpar !== null}
                  className={`px-5 py-3.5 rounded-2xl font-black text-sm border transition-all flex items-center gap-2 ${
                    canLaunchGhostInLobby
                      ? 'bg-slate-950 border-emerald-500/50 text-emerald-300 hover:bg-emerald-950/40 cursor-pointer'
                      : 'bg-slate-950/60 border-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <History size={17} />
                  {canLaunchGhostInLobby
                    ? `Challenge Ghost Replay (${lobbyTelemetry.historicalGhostCount})`
                    : '0 Human Replays Yet'}
                </button>
              </div>
            </div>

            {/* Live Database Telemetry Calibration Breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Calibrated Course Mastery
                </div>
                <div className="text-2xl font-black text-purple-400 mt-1">
                  {challengerCal?.calibratedMasteryPct ?? 0}%
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Target AI Pacing: <strong className="text-white">{challengerCal?.pacingRangeLabel || '12–15s / question'}</strong>
                </div>
              </div>

              <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Course Quiz Telemetry
                </div>
                <div className="text-2xl font-black text-white mt-1">
                  {challengerCal?.quizScorePct !== null && challengerCal?.quizScorePct !== undefined
                    ? `${challengerCal.quizScorePct}%`
                    : '0%'}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {challengerCal?.attemptsSampled
                    ? `${challengerCal.attemptsSampled} quiz(zes) • ${challengerCal.lessonsCompleted} lesson(s)`
                    : `${challengerCal?.lessonsCompleted ?? 0} lesson(s) • No course quizzes yet`}
                </div>
              </div>

              <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  SRS Retention Rate
                </div>
                <div className="text-2xl font-black text-emerald-400 mt-1">
                  {challengerCal?.srsRetentionPct !== null && challengerCal?.srsRetentionPct !== undefined
                    ? `${challengerCal.srsRetentionPct}%`
                    : '0%'}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {challengerCal?.srsCardsSampled
                    ? `${challengerCal.srsCardsRetained}/${challengerCal.srsCardsSampled} SRS cards retained`
                    : '0 SRS flashcards recorded for course'}
                </div>
              </div>

              <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Course Arena W/L Ratio
                </div>
                <div className="text-2xl font-black text-amber-400 mt-1">
                  {challengerCal?.courseWinRatePct !== null && challengerCal?.courseWinRatePct !== undefined
                    ? `${challengerCal.courseWinRatePct}%`
                    : '0%'}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {challengerCal?.arenaBattlesSampled
                    ? `${challengerCal.courseWins}W – ${challengerCal.courseLosses}L in ${selectedCourseId}`
                    : `0 past battles for ${selectedCourseId || 'course'}`}
                </div>
              </div>
            </div>

            {/* Adaptive Calibration Rules Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              <div
                className={`p-3.5 rounded-2xl border text-xs ${
                  (challengerCal?.tier || 'beginner') === 'beginner'
                    ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-200'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400'
                }`}
              >
                <div className="font-black text-white mb-0.5">
                  Beginner Student (&lt;50% Course Mastery)
                </div>
                <div>
                  AI Challenger paces answers at <strong>~12–15 seconds per question</strong> so you have time to read and think without getting instantly overwhelmed.
                </div>
              </div>

              <div
                className={`p-3.5 rounded-2xl border text-xs ${
                  challengerCal?.tier === 'advanced'
                    ? 'bg-purple-950/40 border-purple-500/60 text-purple-200'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400'
                }`}
              >
                <div className="font-black text-white mb-0.5">
                  Advanced Student (&gt;80% Course Mastery)
                </div>
                <div>
                  AI Challenger paces answers at <strong>~6–8 seconds per question</strong> with high accuracy, creating an intense, exam-speed pressure test.
                </div>
              </div>

              <div className="p-3.5 rounded-2xl border bg-slate-950/60 border-slate-800 text-xs text-slate-300">
                <div className="font-black text-white mb-0.5">
                  Post-Match Tactical Breakdown
                </div>
                <div>
                  Powered by your live AI engine, <strong>[AI Challenger]</strong> provides a tactical explanation of any question missed during the duel.
                </div>
              </div>
            </div>
          </div>

          {/* Open Live Matchmaking Queue Banner (if any real student is waiting in any course) */}
          {otherWaitingMatches.length > 0 && (
            <div className="bg-gradient-to-r from-purple-950/60 via-slate-900 to-blue-950/60 border border-purple-500/40 rounded-3xl p-6 shadow-xl">
              <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
                <div className="flex items-center gap-2.5">
                  <Radio size={18} className="text-emerald-400 animate-pulse" />
                  <h3 className="text-sm font-black uppercase tracking-wider text-white">
                    Live Open Challenges Waiting Now ({otherWaitingMatches.length})
                  </h3>
                </div>
                <span className="text-xs text-slate-400">
                  Click any waiting challenger to join their battle room immediately
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {otherWaitingMatches.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between bg-slate-950/90 border border-slate-800 rounded-2xl p-3.5"
                  >
                    <div>
                      <div className="text-sm font-bold text-white">{m.hostName}</div>
                      <div className="text-xs text-purple-400 font-semibold">
                        Course: {m.topicId} • {m.questionCount} Questions
                      </div>
                    </div>
                    <button
                      onClick={() => findMatch(m.topicId, m.id)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl transition-colors cursor-pointer"
                    >
                      JOIN DUEL
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Stats & Live Challenges */}
            <div className="space-y-8">
              {/* Stats Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 shadow-2xl">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-6">
                  Verified Combat Telemetry
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                    <div className="text-xl sm:text-2xl font-bold text-white">
                      {Number((profile as any)?.arenaWins ?? profile?.learningProfile?.arenaWins ?? 0)}
                    </div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">Wins</div>
                  </div>
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                    <div className="text-xl sm:text-2xl font-bold text-white">
                      {Number((profile as any)?.arenaLosses ?? profile?.learningProfile?.arenaLosses ?? 0)}
                    </div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">Losses</div>
                  </div>
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                    <div className="text-xl sm:text-2xl font-bold text-purple-400">
                      {(() => {
                        const w = Number(
                          (profile as any)?.arenaWins ?? profile?.learningProfile?.arenaWins ?? 0
                        );
                        const l = Number(
                          (profile as any)?.arenaLosses ?? profile?.learningProfile?.arenaLosses ?? 0
                        );
                        return w + l > 0 ? `${Math.round((w / (w + l)) * 100)}%` : '0%';
                      })()}
                    </div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">Win Rate</div>
                  </div>
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                    <div className="text-xl sm:text-2xl font-bold text-amber-400">
                      {Number(
                        (profile as any)?.arenaWinStreak ??
                          profile?.learningProfile?.arenaWinStreak ??
                          profile?.streak ??
                          0
                      )}
                    </div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">Streak</div>
                  </div>
                </div>
              </div>

              {/* Adaptive Daily Missions */}
              <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                      Adaptive Daily Missions
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Live progress verified from Neon PostgreSQL
                    </p>
                  </div>
                  <Target size={16} className="text-purple-400" />
                </div>
                <div className="space-y-4">
                  {challenges.length === 0 ? (
                    <div className="text-xs text-slate-500 text-center py-6">
                      Loading live challenges from your learning telemetry...
                    </div>
                  ) : (
                    challenges.map((challenge) => {
                      const IconComponent = getChallengeIcon(challenge.iconType);
                      const current = Number(challenge.currentCount ?? 0);
                      const target = Math.max(1, Number(challenge.targetCount || 1));
                      const pct = Math.min(100, Math.round((current / target) * 100));
                      const isCompleted = Boolean(challenge.completed);
                      const isClaimed = Boolean(challenge.claimed);

                      return (
                        <div
                          key={challenge.id}
                          className={`p-4 bg-slate-950 rounded-2xl border transition-colors ${
                            isCompleted && !isClaimed
                              ? 'border-emerald-500/60'
                              : 'border-slate-800 hover:border-purple-500/40'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-purple-400 shrink-0">
                                <IconComponent size={20} />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-white">{challenge.title}</h4>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                  {challenge.description}
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-xs font-black text-amber-400">
                                +{challenge.reward}{' '}
                                {challenge.rewardType === 'sparks' ? 'SPARKS' : 'XP'}
                              </div>
                              <div className="text-[10px] font-bold text-slate-500 mt-0.5">
                                {current}/{target}
                              </div>
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div className="mt-3 h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all duration-500 ${
                                isCompleted ? 'bg-emerald-500' : 'bg-purple-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>

                          {isCompleted && (
                            <div className="mt-3 flex justify-end">
                              {isClaimed ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                                  <CheckCircle size={13} /> Reward Claimed
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleClaimChallenge(challenge)}
                                  disabled={claimingId === challenge.id}
                                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition-colors disabled:opacity-50 cursor-pointer"
                                >
                                  {claimingId === challenge.id ? 'Claiming...' : 'Claim Reward'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Leaderboard */}
            <div className="lg:col-span-2">
              <Leaderboard />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'matching') {
    const canLaunchGhost = lobbyTelemetry.historicalGhostCount > 0;
    const showFallbackHighlight = matchWaitSeconds >= 8;

    // Dedicated Direct Sparring Initialization Screen (Never shows "Searching for a live classmate" or "Queue Elapsed")
    if (launchingSpar !== null) {
      const isAiSpar = launchingSpar === 'ai_challenger';
      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 sm:p-6 pb-24 lg:pb-6 text-center">
          <motion.div
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-6 border ${
              isAiSpar
                ? 'bg-purple-600/20 border-purple-500/50 text-purple-400 shadow-lg shadow-purple-500/20'
                : 'bg-emerald-600/20 border-emerald-500/50 text-emerald-400 shadow-lg shadow-emerald-500/20'
            }`}
          >
            {isAiSpar ? <Bot size={44} /> : <History size={44} />}
          </motion.div>

          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-purple-950/60 border border-purple-500/40 text-xs font-black uppercase tracking-wider text-purple-300 mb-3">
            <Sparkles size={13} />
            <span>
              {isAiSpar
                ? `Direct Sparring • [AI Challenger] (${selectedCourseId})`
                : `Direct Sparring • Recorded Ghost Replay (${selectedCourseId})`}
            </span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-black text-white mb-2 max-w-xl">{matchStatus}</h2>
          <p className="text-slate-400 mb-6 max-w-md mx-auto text-sm">
            {isAiSpar
              ? `Direct 1v1 sparring mode — calibrating [AI Challenger] response speed and accuracy from your live ${selectedCourseId} telemetry in Neon PostgreSQL.`
              : `Direct 1v1 sparring mode — loading verified historical moves recorded for ${selectedCourseId}.`}
          </p>

          {isAiSpar && (
            <div className="max-w-md w-full bg-slate-900/90 border border-purple-500/30 rounded-2xl p-4 mb-8 text-left">
              <div className="text-[10px] font-black uppercase tracking-wider text-purple-400 mb-2">
                Verified Telemetry Calibration ({selectedCourseId})
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-950 rounded-xl p-2.5 border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Mastery</div>
                  <div className="text-sm font-black text-white mt-0.5">
                    {challengerCal?.calibratedMasteryPct ?? 0}%
                  </div>
                </div>
                <div className="bg-slate-950 rounded-xl p-2.5 border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">AI Pacing</div>
                  <div className="text-sm font-black text-amber-300 mt-0.5">
                    {challengerCal?.pacingRangeLabel || '12–15s / q'}
                  </div>
                </div>
                <div className="bg-slate-950 rounded-xl p-2.5 border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">AI Accuracy</div>
                  <div className="text-sm font-black text-emerald-300 mt-0.5">
                    {challengerCal?.accuracyPct ?? 65}%
                  </div>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={cancelMatchmaking}
            className="px-6 py-2.5 rounded-full border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors font-bold text-sm cursor-pointer"
          >
            Return to Lobby
          </button>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 sm:p-6 pb-24 lg:pb-6 text-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="mb-6"
        >
          <Search size={56} className="text-purple-500" />
        </motion.div>

        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono text-purple-300 mb-3">
          <Clock size={13} />
          <span>Queue Elapsed: {matchWaitSeconds}s • Server {serverUtcClock} UTC</span>
        </div>

        <h2 className="text-2xl sm:text-3xl font-black text-white mb-2">{matchStatus}</h2>
        <p className="text-slate-400 mb-8 max-w-md mx-auto text-sm">
          Searching for a live classmate queuing for <strong className="text-white">{selectedCourseId}</strong>.
          {showFallbackHighlight
            ? ' No classmate joined this course queue yet — launch an instant sparring duel below or keep waiting:'
            : ' You can wait for a live human or launch an instant sparring match at any time:'}
        </p>

        {battleId && (
          <div className="max-w-xl w-full grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            <button
              onClick={() => handleLaunchSparring('ai_challenger')}
              disabled={launchingSpar !== null}
              className={`p-5 rounded-2xl border text-left transition-all cursor-pointer ${
                showFallbackHighlight
                  ? 'bg-purple-950/50 border-purple-500 hover:bg-purple-900/50 shadow-lg shadow-purple-500/10'
                  : 'bg-slate-900 border-slate-800 hover:border-purple-500/60'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="w-9 h-9 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center">
                  <Bot size={20} />
                </div>
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
                  {challengerCal?.pacingRangeLabel || '12–15s / question'}
                </span>
              </div>
              <div className="text-sm font-black text-white mb-1">
                Spar with Adaptive AI Challenger
              </div>
              <p className="text-xs text-slate-400">
                Calibrated to your {selectedCourseId} mastery ({challengerCal?.calibratedMasteryPct ?? 0}% • {challengerCal?.tierLabel || 'Beginner Tier'}).
              </p>
            </button>

            <button
              onClick={() => handleLaunchSparring('ghost_replay')}
              disabled={!canLaunchGhost || launchingSpar !== null}
              className={`p-5 rounded-2xl border text-left transition-all ${
                canLaunchGhost
                  ? 'bg-slate-900 border-emerald-500/50 hover:bg-emerald-950/30 cursor-pointer'
                  : 'bg-slate-900/50 border-slate-800/70 opacity-60 cursor-not-allowed'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center">
                  <History size={20} />
                </div>
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                  {canLaunchGhost
                    ? `${lobbyTelemetry.historicalGhostCount} Recorded`
                    : '0 Recordings'}
                </span>
              </div>
              <div className="text-sm font-black text-white mb-1">
                Fight Historical Ghost Replay
              </div>
              <p className="text-xs text-slate-400">
                {canLaunchGhost && lobbyTelemetry.latestGhostMeta
                  ? `Replay ${lobbyTelemetry.latestGhostMeta.playerName}'s real recorded match (${new Date(
                      lobbyTelemetry.latestGhostMeta.recordedAt
                    ).toLocaleDateString()}).`
                  : `No recorded human battle exists for ${selectedCourseId} in PostgreSQL yet.`}
              </p>
            </button>
          </div>
        )}

        <button
          onClick={cancelMatchmaking}
          className="px-6 py-2.5 rounded-full border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors font-bold text-sm cursor-pointer"
        >
          Cancel Matchmaking
        </button>
      </div>
    );
  }

  if (view === 'battle' && battleData) {
    const isPlayer1 = battleData.player1.uid === user?.uid;
    const me = isPlayer1 ? battleData.player1 : battleData.player2!;
    const opponent = isPlayer1 ? battleData.player2! : battleData.player1;
    const currentQ = battleData.questions[me.currentQuestionIndex];
    const opponentBadge =
      battleData.opponentType === 'ghost_replay'
        ? 'Ghost Replay'
        : battleData.opponentType === 'ai_challenger'
        ? '[AI Challenger]'
        : 'Live Player';

    return (
      <div className="min-h-screen bg-slate-900 flex flex-col relative overflow-hidden pb-24 lg:pb-0">
        {/* Top Bar: Health & Avatars */}
        <div className="flex justify-between items-center p-4 sm:p-6 relative z-10">
          {/* Me */}
          <div className="flex items-center gap-4 w-1/3">
            <div className="relative">
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-blue-600 border-4 border-slate-800 shadow-xl overflow-hidden">
                <img
                  src={me.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${me.uid}`}
                  alt="Me"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute -bottom-2 -right-2 bg-slate-800 text-white text-xs font-bold px-2 py-0.5 rounded-full border border-slate-700">
                You
              </div>
            </div>
            <div className="flex-1 hidden sm:block">
              <div className="text-xs font-bold text-white truncate mb-1">
                {me.name} • {me.score} pts
              </div>
              <div className="h-4 bg-slate-800 rounded-full overflow-hidden border border-slate-700 relative">
                <motion.div
                  initial={{ width: '100%' }}
                  animate={{ width: `${me.health}%` }}
                  className="h-full bg-emerald-500"
                />
              </div>
              <div className="text-xs text-slate-400 mt-1 font-bold">{me.health}/100 HP</div>
            </div>
          </div>

          {/* Authoritative Real-Time Server Timer */}
          <div className="flex flex-col items-center">
            <div
              className={`text-3xl sm:text-4xl font-bold tracking-widest tabular-nums ${
                timeLeft <= 10 ? 'text-rose-500 animate-pulse' : 'text-white'
              }`}
            >
              {timeLeft}
            </div>
            <div className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
              Server Clock (s)
            </div>
            {battleData.calibrationTelemetry?.pacingRangeLabel && (
              <div className="text-[10px] text-purple-300 font-bold mt-0.5">
                AI Pacing: {battleData.calibrationTelemetry.pacingRangeLabel}
              </div>
            )}
          </div>

          {/* Opponent */}
          <div className="flex items-center justify-end gap-4 w-1/3">
            <div className="flex-1 hidden sm:block text-right">
              <div className="text-xs font-bold text-white truncate mb-1">
                {opponent.name} • {opponent.score} pts
              </div>
              <div className="h-4 bg-slate-800 rounded-full overflow-hidden border border-slate-700 relative">
                <motion.div
                  initial={{ width: '100%' }}
                  animate={{ width: `${opponent.health}%` }}
                  className="h-full bg-red-500 absolute right-0 top-0 bottom-0"
                />
              </div>
              <div className="text-xs text-slate-400 mt-1 font-bold">
                {opponent.health}/100 HP • Q{Math.min(battleData.questions.length, (opponent.currentQuestionIndex || 0) + 1)}/{battleData.questions.length}
              </div>
            </div>
            <div className="relative">
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-red-600 border-4 border-slate-800 shadow-xl overflow-hidden">
                <img
                  src={
                    opponent.avatar ||
                    `https://api.dicebear.com/7.x/avataaars/svg?seed=${opponent.uid}`
                  }
                  alt="Opponent"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute -bottom-2 -left-2 bg-slate-800 text-white text-[10px] font-bold px-2 py-0.5 rounded-full border border-slate-700 whitespace-nowrap">
                {opponentBadge}
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Health Bars */}
        <div className="flex sm:hidden px-4 gap-2 mb-4">
          <div className="h-2 flex-1 bg-slate-800 rounded-full overflow-hidden">
            <motion.div animate={{ width: `${me.health}%` }} className="h-full bg-emerald-500" />
          </div>
          <div className="h-2 flex-1 bg-slate-800 rounded-full overflow-hidden flex justify-end">
            <motion.div animate={{ width: `${opponent.health}%` }} className="h-full bg-red-500" />
          </div>
        </div>

        {/* Question Area */}
        <div className="flex-1 flex items-center justify-center p-6 relative z-10">
          {currentQ ? (
            <div className="max-w-2xl w-full space-y-8">
              <motion.div
                key={currentQ.id || me.currentQuestionIndex}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-center space-y-6"
              >
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 text-purple-300 text-xs font-bold">
                  Question {me.currentQuestionIndex + 1} of {battleData.questions.length}
                </div>

                <div className="text-xl sm:text-3xl font-bold text-white leading-tight">
                  <MarkdownRenderer content={currentQ.question} inline />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {currentQ.options?.map((option, idx) => {
                    const isSelected = selectedAnswer === option;
                    const showResult = selectedAnswer !== null;
                    const isCorrectOption = option === currentQ.correctAnswer;

                    let btnClass =
                      'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700';
                    if (showResult) {
                      if (isCorrectOption)
                        btnClass = 'bg-emerald-600 border-emerald-500 text-white';
                      else if (isSelected)
                        btnClass = 'bg-red-600 border-red-500 text-white';
                      else
                        btnClass = 'bg-slate-800 border-slate-700 text-slate-500 opacity-50';
                    }

                    return (
                      <button
                        key={idx}
                        onClick={() => handleAnswer(option)}
                        disabled={showResult || submittingAnswer}
                        className={`p-6 rounded-2xl border-2 font-bold text-lg transition-all transform active:scale-95 cursor-pointer ${btnClass}`}
                      >
                        <MarkdownRenderer content={option} inline />
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </div>
          ) : (
            <div className="text-center text-white">
              <h2 className="text-3xl font-bold mb-2">All Questions Answered!</h2>
              <p className="text-slate-400">
                Waiting for {opponent.name} to finish or server clock to settle...
              </p>
              <Loader2 size={48} className="animate-spin mx-auto mt-8 text-purple-500" />
            </div>
          )}
        </div>

        {/* VS Background Effect */}
        <div className="absolute inset-0 pointer-events-none flex">
          <div className="w-1/2 h-full bg-blue-600/5 skew-x-12 -ml-20" />
          <div className="w-1/2 h-full bg-red-600/5 skew-x-12 ml-20" />
        </div>
      </div>
    );
  }

  if (view === 'result' && battleData) {
    const isWinner = battleData.winner === user?.uid;
    const isDraw = battleData.winner === 'draw';
    const myPlayer =
      battleData.player1.uid === user?.uid ? battleData.player1 : battleData.player2;
    const enemyPlayer =
      battleData.player1.uid !== user?.uid ? battleData.player1 : battleData.player2;
    const missedQuestions = getMissedQuestionsFromBattle(battleData);

    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-start p-4 sm:p-8 pb-24 lg:pb-12 overflow-y-auto">
        <div className="max-w-3xl w-full space-y-6 my-auto">
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full bg-slate-900 border border-slate-800 p-6 sm:p-8 rounded-3xl text-center shadow-2xl relative z-10"
          >
            <div className="mb-6 flex justify-center">
              {isWinner ? (
                <div className="w-20 h-20 bg-yellow-400 rounded-full flex items-center justify-center shadow-lg shadow-yellow-400/50 animate-bounce">
                  <Trophy size={42} className="text-yellow-900" />
                </div>
              ) : isDraw ? (
                <div className="w-20 h-20 bg-slate-600 rounded-full flex items-center justify-center shadow-lg">
                  <Shield size={42} className="text-white" />
                </div>
              ) : (
                <div className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center shadow-lg shadow-red-500/50">
                  <Skull size={42} className="text-white" />
                </div>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white mb-2">
              {isWinner ? 'VICTORY!' : isDraw ? 'DRAW!' : 'DEFEAT'}
            </h1>
            <p className="text-slate-400 mb-6 font-medium text-sm">
              {isWinner
                ? '+100 XP Credited to Your Profile'
                : isDraw
                ? '+25 XP Credited to Your Profile'
                : '+10 Participation XP Credited'}
            </p>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Your Score</div>
                <div className="text-xl sm:text-2xl font-bold text-white">
                  {myPlayer?.score ?? 0}
                </div>
                <div className="text-[11px] text-emerald-400 mt-1">{myPlayer?.health ?? 0} HP left</div>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <div className="text-xs text-slate-500 uppercase font-semibold mb-1 truncate">
                  {enemyPlayer?.name || 'Opponent'}
                </div>
                <div className="text-xl sm:text-2xl font-bold text-white">
                  {enemyPlayer?.score ?? 0}
                </div>
                <div className="text-[11px] text-rose-400 mt-1">{enemyPlayer?.health ?? 0} HP left</div>
              </div>
            </div>

            <button
              onClick={() => {
                setBattleId(null);
                setBattleData(null);
                setTacticalDebrief(null);
                setView('lobby');
                void fetchLobbyTelemetry();
                void refreshChallenges();
              }}
              className="w-full py-3.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold transition-colors cursor-pointer"
            >
              Return to Arena Lobby
            </button>
          </motion.div>

          {/* POST-MATCH TACTICAL BREAKDOWN ([AI Challenger] Sparring Partner) */}
          <div className="bg-slate-900 border border-purple-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
                  <Bot size={22} />
                </div>
                <div>
                  <div className="text-xs font-black uppercase tracking-wider text-purple-400">
                    [AI Challenger] Post-Match Breakdown
                  </div>
                  <h3 className="text-lg font-black text-white">
                    Tactical Debrief of Missed Duel Questions
                  </h3>
                </div>
              </div>

              {missedQuestions.length > 0 && (
                <button
                  onClick={handleScheduleMissedToSrs}
                  disabled={schedulingSrs || srsScheduled}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-black transition-colors cursor-pointer"
                >
                  {srsScheduled
                    ? 'Added to Spaced Repetition ✓'
                    : schedulingSrs
                    ? 'Scheduling to SRS...'
                    : `Schedule ${missedQuestions.length} Missed to SRS`}
                </button>
              )}
            </div>

            {missedQuestions.length === 0 ? (
              <div className="p-6 rounded-2xl bg-emerald-950/30 border border-emerald-500/40 text-center space-y-1">
                <div className="text-base font-black text-emerald-300">
                  Flawless Execution — 0 Missed Questions!
                </div>
                <p className="text-xs text-slate-300">
                  You answered every question you attempted accurately. Your course mastery telemetry has been updated.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {missedQuestions.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3"
                  >
                    <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                      <span>Question #{item.questionIndex + 1}</span>
                      {item.elapsedSeconds !== null && (
                        <span>Answered at {item.elapsedSeconds}s</span>
                      )}
                    </div>
                    <div className="text-sm sm:text-base font-bold text-white">
                      <MarkdownRenderer content={item.question} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-200">
                        <span className="font-black uppercase block text-[10px] text-rose-400 mb-1">
                          Your Answer
                        </span>
                        <MarkdownRenderer content={item.selectedOption} inline />
                      </div>
                      <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200">
                        <span className="font-black uppercase block text-[10px] text-emerald-400 mb-1">
                          Correct Answer
                        </span>
                        <MarkdownRenderer content={item.correctAnswer} inline />
                      </div>
                    </div>
                    {item.curriculumExplanation && (
                      <div className="text-xs text-slate-300 bg-slate-900/90 p-3.5 rounded-xl border border-slate-800">
                        <span className="font-bold text-purple-300 block mb-1">
                          Curriculum Verification Note:
                        </span>
                        <MarkdownRenderer content={item.curriculumExplanation} />
                      </div>
                    )}
                  </div>
                ))}

                {/* Live AI Challenger Tactical Synthesis */}
                <div className="p-5 rounded-2xl bg-purple-950/25 border border-purple-500/40 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-purple-300">
                    <Bot size={15} />
                    <span>Live [AI Challenger] Tactical Analysis</span>
                  </div>
                  {loadingDebrief ? (
                    <div className="flex items-center gap-2.5 text-xs text-slate-300 py-3">
                      <Loader2 size={16} className="animate-spin text-purple-400" />
                      <span>
                        Generating live tactical breakdown of your {missedQuestions.length} missed question(s)...
                      </span>
                    </div>
                  ) : tacticalDebrief ? (
                    <div className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                      <MarkdownRenderer content={tacticalDebrief} />
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">
                      Review the curriculum explanations above and schedule these questions into your Spaced Repetition deck to boost your course mastery.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
