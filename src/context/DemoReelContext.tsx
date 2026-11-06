import React, { createContext, useContext, useState, useRef, useEffect, useCallback, ReactNode } from 'react';
import { View } from '../types';
import { DemoScenario, DemoStep, isDemoScenarioIsolated } from '../services/demoReelService';
import toast from 'react-hot-toast';

interface DemoReelContextType {
  isRecording: boolean;
  isPaused: boolean;
  currentScenario: DemoScenario | null;
  currentStepIndex: number;
  currentStep: DemoStep | null;
  elapsedSeconds: number;
  recordedBlob: Blob | null;
  recordedVideoUrl: string | null;
  recordedDuration: number;
  isModalOpen: boolean;
  selectedScenarioId: string;
  screenCaptureSupported: boolean;
  setSelectedScenarioId: (id: string) => void;
  startDemoReel: (scenario: DemoScenario, navigateCallback?: (view: View) => void) => Promise<boolean>;
  skipToNextStep: () => void;
  pauseDemoReel: () => void;
  resumeDemoReel: () => void;
  stopAndSaveReel: () => Promise<void>;
  cancelDemoReel: () => void;
  downloadReel: (filename?: string) => void;
  openPreviewModal: () => void;
  closePreviewModal: () => void;
}

const DemoReelContext = createContext<DemoReelContextType | null>(null);

export function DemoReelProvider({ children }: { children: ReactNode }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentScenario, setCurrentScenario] = useState<DemoScenario | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);
  const stepTimeoutRef = useRef<any>(null);
  const navigateFnRef = useRef<((view: View) => void) | null>(null);
  const startTimeRef = useRef<number>(0);
  const discardRecordingRef = useRef(false);

  const screenCaptureSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  const currentStep = currentScenario && currentScenario.steps[currentStepIndex] ? currentScenario.steps[currentStepIndex] : null;

  // Clean up timer and media streams on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (stepTimeoutRef.current) clearTimeout(stepTimeoutRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (recordedVideoUrl) {
        URL.revokeObjectURL(recordedVideoUrl);
      }
    };
  }, [recordedVideoUrl]);

  // Execute step transitions
  const executeStep = useCallback((stepIdx: number, scenario: DemoScenario) => {
    if (stepIdx >= scenario.steps.length) {
      // Completed all steps
      stopAndSaveReel();
      return;
    }

    const step = scenario.steps[stepIdx];
    setCurrentStepIndex(stepIdx);

    // 1. Programmatically navigate to target view
    if (navigateFnRef.current) {
      navigateFnRef.current(step.view);
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('navigate', { detail: step.view }));
    }

    // 3. Schedule next step
    if (stepTimeoutRef.current) clearTimeout(stepTimeoutRef.current);
    stepTimeoutRef.current = setTimeout(() => {
      executeStep(stepIdx + 1, scenario);
    }, step.durationMs);
  }, []);

  const skipToNextStep = useCallback(() => {
    if (!currentScenario || !isRecording) return;
    if (stepTimeoutRef.current) clearTimeout(stepTimeoutRef.current);
    const nextIdx = currentStepIndex + 1;
    if (nextIdx < currentScenario.steps.length) {
      executeStep(nextIdx, currentScenario);
    } else {
      stopAndSaveReel();
    }
  }, [currentScenario, isRecording, currentStepIndex, executeStep]);

  const pauseDemoReel = useCallback(() => {
    if (!isRecording || isPaused) return;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
    }
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (stepTimeoutRef.current) clearTimeout(stepTimeoutRef.current);
    setIsPaused(true);
    toast('Demo recording paused', { icon: '⏸️' });
  }, [isRecording, isPaused]);

  const resumeDemoReel = useCallback(() => {
    if (!isRecording || !isPaused || !currentScenario) return;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
    }
    setIsPaused(false);
    timerIntervalRef.current = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
    // Resume step execution
    const remainingStep = currentScenario.steps[currentStepIndex];
    if (remainingStep) {
      stepTimeoutRef.current = setTimeout(() => {
        executeStep(currentStepIndex + 1, currentScenario);
      }, remainingStep.durationMs / 2);
    }
    toast('Demo recording resumed', { icon: '▶️' });
  }, [isRecording, isPaused, currentScenario, currentStepIndex, executeStep]);

  const cancelDemoReel = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (stepTimeoutRef.current) clearTimeout(stepTimeoutRef.current);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      discardRecordingRef.current = true;
      try {
        recorder.stop();
      } catch (e) {
        discardRecordingRef.current = false;
        console.warn('Error stopping media recorder on cancel:', e);
      }
    } else {
      discardRecordingRef.current = false;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
    setIsPaused(false);
    setCurrentScenario(null);
    setCurrentStepIndex(0);
    setElapsedSeconds(0);
    toast('Demo reel cancelled', { icon: '🛑' });
  }, []);

  const stopAndSaveReel = useCallback(async () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (stepTimeoutRef.current) clearTimeout(stepTimeoutRef.current);
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      setIsRecording(false);
      setIsPaused(false);
      return;
    }

    const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    setRecordedDuration(duration);
    setIsRecording(false);
    setIsPaused(false);

    try {
      recorder.stop();
    } catch (error) {
      toast.error('The browser could not finalize this recording.');
      console.error('Failed to stop demo recorder:', error);
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startDemoReel = useCallback(async (
    scenario: DemoScenario,
    navigateCallback?: (view: View) => void
  ): Promise<boolean> => {
    if (!scenario || !Array.isArray(scenario.steps) || scenario.steps.length === 0) {
      toast.error('A verified Demo Studio scenario is required before recording.');
      return false;
    }
    if (!isDemoScenarioIsolated(scenario)) {
      toast.error('This scenario contains an AI Tutor or automated chat step. Chat execution is disabled in Demo Studio until an isolated demo path is available.');
      return false;
    }
    if (scenario.requiresReview) {
      toast.error('This AI-generated demo script requires administrator review before recording.');
      return false;
    }
    discardRecordingRef.current = false;
    setSelectedScenarioId(scenario.id);
    setCurrentScenario(scenario);
    if (navigateCallback) navigateFnRef.current = navigateCallback;

    chunksRef.current = [];
    setRecordedBlob(null);
    if (recordedVideoUrl) {
      URL.revokeObjectURL(recordedVideoUrl);
      setRecordedVideoUrl(null);
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        toast.error('Screen capture is not supported in this browser environment.');
        return false;
      }

      // Prompt user to pick application window or tab for recording
      toast('Please select this tab or window to start recording...', { icon: '🎥', duration: 4000 });
      
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          frameRate: { ideal: 60, max: 60 }
        } as any,
        audio: false
      });

      streamRef.current = stream;

      // Pick best supported MIME type
      const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=h264',
        'video/webm',
        'video/mp4'
      ];
      const selectedMime = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType: selectedMime,
        videoBitsPerSecond: 4000000 // 4 Mbps high definition
      });

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        mediaRecorderRef.current = null;

        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          chunksRef.current = [];
          setRecordedBlob(null);
          setRecordedDuration(0);
          setIsModalOpen(false);
          return;
        }

        const fullBlob = new Blob(chunksRef.current, { type: recorder.mimeType || selectedMime });
        chunksRef.current = [];
        if (fullBlob.size <= 0) {
          setRecordedBlob(null);
          setIsModalOpen(false);
          toast.error('The browser stopped recording but produced no video data. Nothing was saved.');
          return;
        }

        setRecordedBlob(fullBlob);
        const url = URL.createObjectURL(fullBlob);
        setRecordedVideoUrl(url);
        setIsModalOpen(true);
        toast.success('Demo recording is ready. Review the video before exporting.');
      };

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          if (recorder.state !== 'inactive') {
            void stopAndSaveReel();
          }
        };
      }

      mediaRecorderRef.current = recorder;
      recorder.start(1000); // chunk every 1 second

      startTimeRef.current = Date.now();
      setIsRecording(true);
      setIsPaused(false);
      setElapsedSeconds(0);

      // Start duration ticker
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);

      // Trigger first step
      executeStep(0, scenario);

      toast.success(`🎬 Recording started: ${scenario.name}`);
      return true;
    } catch (err: any) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      mediaRecorderRef.current = null;
      console.error('Failed to initialize demo reel recording:', err);
      if (err.name === 'NotAllowedError') {
        toast.error('Screen capture permission was denied.');
      } else {
        toast.error(`Could not start screen recording: ${err.message || 'Unknown error'}`);
      }
      setIsRecording(false);
      return false;
    }
  }, [selectedScenarioId, recordedVideoUrl, isRecording, executeStep, stopAndSaveReel]);

  const downloadReel = useCallback((filename?: string) => {
    if (!recordedBlob) {
      toast.error('No recorded video available to download.');
      return;
    }
    const extension = recordedBlob.type.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
    const scenarioName = currentScenario?.id || 'recording';
    const defaultName = `uniace-${scenarioName}-reel-${new Date().toISOString().slice(0, 10)}.${extension}`;
    const finalName = filename || defaultName;
    const downloadUrl = recordedVideoUrl || URL.createObjectURL(recordedBlob);
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = finalName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(`📥 Downloaded ${finalName}!`);
  }, [recordedBlob, recordedVideoUrl, currentScenario]);

  const openPreviewModal = useCallback(() => setIsModalOpen(true), []);
  const closePreviewModal = useCallback(() => setIsModalOpen(false), []);

  return (
    <DemoReelContext.Provider
      value={{
        isRecording,
        isPaused,
        currentScenario,
        currentStepIndex,
        currentStep,
        elapsedSeconds,
        recordedBlob,
        recordedVideoUrl,
        recordedDuration,
        isModalOpen,
        selectedScenarioId,
        screenCaptureSupported,
        setSelectedScenarioId,
        startDemoReel,
        skipToNextStep,
        pauseDemoReel,
        resumeDemoReel,
        stopAndSaveReel,
        cancelDemoReel,
        downloadReel,
        openPreviewModal,
        closePreviewModal
      }}
    >
      {children}
    </DemoReelContext.Provider>
  );
}

export function useDemoReel() {
  const context = useContext(DemoReelContext);
  if (!context) {
    throw new Error('useDemoReel must be used within a DemoReelProvider');
  }
  return context;
}
