import { auth } from '../firebase';

export interface AdminDemoTutorResult {
  response: string;
  meta: {
    providerUsed: string | null;
    upstreamModel: string | null;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    latencyMs: number;
    telemetryScope: 'admin_demo_ai_usage';
    studentSparksCharged: false;
    studentProfileRead: false;
    studentHistoryRead: false;
    studentHistoryWritten: false;
    studentChatAnalyticsWritten: false;
    providerAccountUsage: true;
  };
}

export async function requestAdminDemoTutor(message: string, courseContext?: string): Promise<AdminDemoTutorResult> {
  const user = auth?.currentUser;
  if (!user) throw new Error('Sign in with an administrator account before running an isolated AI preview.');
  const token = await user.getIdToken(true);
  const response = await fetch('/api/admin/marketing/demo-tutor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, ...(courseContext?.trim() ? { courseContext: courseContext.trim() } : {}) })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Isolated AI preview failed (HTTP ${response.status}).`);
  if (typeof data?.response !== 'string' || !data.response.trim() || data?.meta?.telemetryScope !== 'admin_demo_ai_usage') {
    throw new Error('The server did not return a verified isolated AI preview response.');
  }
  return data as AdminDemoTutorResult;
}
