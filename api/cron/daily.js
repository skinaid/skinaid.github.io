/**
 * Өдөр бүрийн cron — vercel.json `crons` (УБ 04:00). Логик: api/_lib/cron.js. CRON_SECRET-гүй хүсэлт = 401.
 */
import { createCronHandler } from '../_lib/cron.js';
import { getRuntime } from '../_lib/runtime.js';

const handler = createCronHandler({ getRuntime: () => getRuntime() });

export function GET(request) {
  return handler(request);
}
