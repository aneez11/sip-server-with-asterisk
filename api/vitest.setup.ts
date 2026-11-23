/**
 * Vitest global setup: the API parses its env with zod at import time, and ESM
 * hoists imports above any statement in a test file. Setting the minimum env
 * here is the only place that reliably runs first.
 */
process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "mysql://root:test@localhost:3306/infinity_echo_test";
process.env.AMI_SECRET ??= "test-ami-secret";
process.env.ADMIN_PASSWORD ??= "test-admin-password";
process.env.SESSION_SECRET ??= "test-session-secret";
