/**
 * Simulate mode — self-contained demo with mock data and colored terminal output.
 * No API keys or GitHub access required.
 */

import { SEVERITY_EMOJI } from './types/reviewer.js';
import type { ReviewResult } from './types/reviewer.js';

export async function runSimulate(): Promise<ReviewResult> {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   niteni-multi-llm — Simulation Mode        ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const mockFindings = [
    {
      severity: 'CRITICAL' as const,
      file: 'src/auth/jwt.ts',
      line: 42,
      description:
        'JWT secret is hardcoded in source code. This exposes the secret to anyone with repository access.',
      suggestion: 'Move the secret to an environment variable:\n  const secret = process.env.JWT_SECRET;',
      rationale: 'Hardcoded secrets are a security vulnerability that can lead to token forgery.',
    },
    {
      severity: 'HIGH' as const,
      file: 'src/api/users.ts',
      line: 118,
      description: 'SQL query uses string concatenation instead of parameterized queries.',
      suggestion:
        'Use parameterized query:\n  db.query("SELECT * FROM users WHERE id = $1", [userId])',
      rationale: 'String concatenation is vulnerable to SQL injection attacks.',
    },
    {
      severity: 'MEDIUM' as const,
      file: 'src/utils/validate.ts',
      line: 25,
      description:
        'Email validation regex does not handle all valid email formats (e.g., plus addressing).',
      suggestion: 'Use a well-tested regex or the built-in URL API for validation.',
    },
    {
      severity: 'LOW' as const,
      file: 'README.md',
      line: 10,
      description: 'API endpoint documentation is missing the new /health endpoint.',
      suggestion: 'Add documentation for the /health endpoint.',
    },
  ];

  const mockResult: ReviewResult = {
    summary:
      'Reviewed 8 files with 4 findings (1 CRITICAL, 1 HIGH, 1 MEDIUM, 1 LOW). The critical finding involves a hardcoded JWT secret that must be addressed before merge.',
    findings: mockFindings,
    hasCritical: true,
    provider: 'simulate',
    model: 'mock-v1',
  };

  // ANSI color codes
  const RESET = '\x1b[0m';
  const BOLD = '\x1b[1m';
  const DIM = '\x1b[2m';
  const RED = '\x1b[31m';
  const YELLOW = '\x1b[33m';
  const BLUE = '\x1b[34m';
  const WHITE = '\x1b[37m';

  console.log(`${BOLD}Review Summary${RESET}`);
  console.log(mockResult.summary);
  console.log('');

  for (const finding of mockResult.findings) {
    const colors: Record<string, string> = {
      CRITICAL: RED,
      HIGH: YELLOW,
      MEDIUM: BLUE,
      LOW: WHITE,
    };
    const color = colors[finding.severity] || WHITE;
    const emoji = SEVERITY_EMOJI[finding.severity];

    console.log(
      `${color}${emoji} ${BOLD}${finding.severity}${RESET} ${finding.file}:${finding.line}`
    );
    console.log(`  ${finding.description}`);
    if (finding.suggestion) {
      console.log(`  ${DIM}Suggestion: ${finding.suggestion}${RESET}`);
    }
    console.log('');
  }

  return mockResult;
}
