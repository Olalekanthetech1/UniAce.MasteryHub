
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';
import { getDb } from './firebaseAdmin';
import { DynamicKeyRotator } from './providers';
import { inspectAndScrubUntrustedText } from './promptShield';

export interface SearchResult {
  content: string;
  source: string;
  type: 'question' | 'syllabus' | 'formula';
  score: number;
}

const geminiKeyRotator = new DynamicKeyRotator('gemini_direct', process.env.GEMINI_API_KEY || '');

async function getAI(): Promise<{ ai: GoogleGenAI; apiKey: string }> {
  const apiKey = await geminiKeyRotator.getNextKey();
  return { ai: new GoogleGenAI({ apiKey }), apiKey };
}

export function addVectorItem(_id: string, _content: string, _source: string, _type: 'question' | 'syllabus' | 'formula', _embedding: number[]) {
  // Direct writes are handled atomically in Firestore documents with VectorValue.
}

export function removeVectorItem(_id: string) {
  // Deletions are handled directly in Firestore documents.
}

/**
 * Initializes Vector Store verification against Firestore knowledge_base.
 * Uses zero in-memory heap caching to prevent OOM on Cloud Run containers.
 */
export async function initializeVectorStore() {
  try {
    const db = getDb();
    if (!db) return;
    const countSnap = await db.collection('knowledge_base').count().get();
    console.log(`[Vector Store] Initialized with ${countSnap.data().count} items available in Firestore native vector index.`);
  } catch (error: any) {
    console.warn('[Vector Store] Vector index check:', error.message || error);
  }
}

/**
 * Performs semantic search using Firestore native findNearest vector index.
 */
export async function findRelevantContentSemantic(query: string, limit: number = 5): Promise<SearchResult[]> {
  try {
    const db = getDb();
    if (!db) return [];

    const { ai, apiKey } = await getAI();
    let result;
    try {
      result = await ai.models.embedContent({
        model: 'gemini-embedding-2-preview',
        contents: query,
      });
    } catch (embedErr: any) {
      const msg = (embedErr?.message || String(embedErr)).toLowerCase();
      if (embedErr?.status === 400 || embedErr?.status === 401 || embedErr?.status === 403 || msg.includes('api key not valid') || msg.includes('api_key_invalid')) {
        await geminiKeyRotator.markKeyExhausted(apiKey);
        const retryClient = await getAI();
        result = await retryClient.ai.models.embedContent({
          model: 'gemini-embedding-2-preview',
          contents: query,
        });
      } else {
        throw embedErr;
      }
    }

    const queryEmbedding = result.embeddings?.[0]?.values;
    if (!queryEmbedding || queryEmbedding.length === 0) return [];

    const queryVector = admin.firestore.FieldValue.vector(queryEmbedding as number[]);
    const kbRef = db.collection('knowledge_base');

    const snapshot = await kbRef.findNearest({
      vectorField: 'embedding',
      queryVector,
      distanceMeasure: 'COSINE',
      limit
    }).get();

    if (snapshot.empty) return [];

    return snapshot.docs.map(doc => {
      const data = doc.data();
      const rawContent = data.content || '';
      const scrubbed = inspectAndScrubUntrustedText(rawContent, 'rag_chunk');
      return {
        content: scrubbed.sanitizedText,
        source: data.source || data.course_code || 'Knowledge Base',
        type: (data.type as any) || 'question',
        score: 1.0 // findNearest ranks by similarity descending
      };
    });
  } catch (error) {
    console.error('Error in semantic search:', error);
    return [];
  }
}
