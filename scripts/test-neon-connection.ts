/**
 * UniAce Mastery Hub: Neon PostgreSQL Connection Probe
 * Tests TCP connection, SSL handshake, and pooler latency for Stage 5B.
 */

import dotenv from 'dotenv';
import { probeNeonConnection, NeonHealthStatus } from '../server/postgresPool';

dotenv.config();

export { probeNeonConnection, NeonHealthStatus };

// Standalone CLI probe execution only if explicitly invoked from CLI
const isDirectCli = typeof process !== 'undefined' && process.argv && process.argv[1] && (
  process.argv[1].endsWith('test-neon-connection.ts') || 
  process.argv[1].endsWith('test-neon-connection.js')
);

if (isDirectCli) {
  console.log('Probing Neon PostgreSQL Connection...');
  probeNeonConnection().then((res) => {
    console.log('Probe Result:', JSON.stringify(res, null, 2));
    process.exit(res.connected ? 0 : 1);
  });
}
