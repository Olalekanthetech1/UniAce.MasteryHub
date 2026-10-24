import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';

async function testChatAnalytics() {
  const db = getDb();
  const pool = getPostgresPool();
  if (!db || !pool) return;

  console.log('=== ITEM C: CHAT ANALYTICS ISOLATION TEST ===\n');

  // Neon count before
  const neonBefore = await pool.query('SELECT count(*) FROM chat_analytics;');
  const countNeonBefore = Number(neonBefore.rows[0].count);

  // Firestore count before
  const fsSnapBefore = await db.collection('chat_analytics').get().catch(() => ({ size: 0 }));
  const countFsBefore = fsSnapBefore.size;

  console.log(`Neon chat_analytics BEFORE: ${countNeonBefore}`);
  console.log(`Firestore chat_analytics BEFORE: ${countFsBefore}\n`);

  // Send a chat request to local server on port 3000
  console.log('Sending AI generation request to http://localhost:3000/api/ai/generate ...');
  const chatRes = await fetch('http://localhost:3000/api/ai/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer uniace-secure-local-eval-token'
    },
    body: JSON.stringify({
      prompt: 'What is a matrix in linear algebra?',
      complexity: 'standard',
      taskType: 'chat'
    })
  }).catch(e => console.error('Fetch error:', e));

  if (chatRes) {
    console.log(`Chat Response Status: HTTP ${chatRes.status}`);
  }

  await new Promise(r => setTimeout(r, 1500));

  // Neon count after
  const neonAfter = await pool.query('SELECT count(*) FROM chat_analytics;');
  const countNeonAfter = Number(neonAfter.rows[0].count);

  // Firestore count after
  const fsSnapAfter = await db.collection('chat_analytics').get().catch(() => ({ size: 0 }));
  const countFsAfter = fsSnapAfter.size;

  console.log(`\nNeon chat_analytics AFTER: ${countNeonAfter} (Diff: +${countNeonAfter - countNeonBefore})`);
  console.log(`Firestore chat_analytics AFTER: ${countFsAfter} (Diff: +${countFsAfter - countFsBefore})`);

  await pool.end();
}

testChatAnalytics().catch(console.error);
