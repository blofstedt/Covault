import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

interface Vault {
  userId: string;
  token: string;
  vendor: string;
  transactionId: string;
}

const vaults = new Map<string, Vault>();

function reply(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of req) body += String(chunk);
  return JSON.parse(body);
}

/** One server holds all browser workers' data, and every REST read checks its token. */
export function mockSupabase(): Plugin {
  return {
    name: 'covault-e2e-mock-supabase',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/mock-supabase', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (url.pathname === '/__test/vaults' && req.method === 'POST') {
          try {
            const data = await readBody(req) as Vault;
            if (!data.userId || !data.token || !data.vendor || !data.transactionId ||
                vaults.has(data.userId) || [...vaults.values()].some(v => v.token === data.token)) {
              reply(res, 400, { message: 'A unique, complete vault is required.' });
              return;
            }
            vaults.set(data.userId, data);
            reply(res, 201, { userId: data.userId });
          } catch {
            reply(res, 400, { message: 'Invalid vault.' });
          }
          return;
        }

        if (url.pathname.startsWith('/__test/vaults/') && req.method === 'DELETE') {
          vaults.delete(decodeURIComponent(url.pathname.slice('/__test/vaults/'.length)));
          reply(res, 200, { removed: true });
          return;
        }

        const token = req.headers.authorization?.replace(/^Bearer /, '');
        const vault = [...vaults.values()].find(v => v.token === token);
        if (!vault) {
          reply(res, 401, { message: 'Unknown test session.' });
          return;
        }

        const requestedUser = url.searchParams.get('user_id') ?? url.searchParams.get('user_uuid');
        if (requestedUser && requestedUser !== `eq.${vault.userId}`) {
          reply(res, 403, { message: 'Another vault is not accessible.' });
          return;
        }

        if (url.pathname === '/rest/v1/settings' && req.method === 'GET') {
          reply(res, 200, [{
            user_id: vault.userId,
            monthly_income: 5000,
            theme_selected: 'dark',
            subscription_status: 'active',
            is_tester: true,
            budgeting_solo: true,
            partner_id: null,
          }]);
          return;
        }

        if (url.pathname === '/rest/v1/budgets' && req.method === 'GET') {
          reply(res, 200, [{ id: `budget-${vault.userId}`, user_uuid: vault.userId,
            budget: 'Food', amount: 500, Visible: true }]);
          return;
        }

        if (url.pathname === '/rest/v1/budgets' && req.method === 'POST') {
          reply(res, 201, []);
          return;
        }

        if (url.pathname === '/rest/v1/transactions' && req.method === 'GET') {
          reply(res, 200, [{
            id: vault.transactionId,
            user_id: vault.userId,
            vendor: vault.vendor,
            amount: 14.25,
            date: new Date().toISOString().slice(0, 10),
            created_at: new Date().toISOString(),
            budget: 'Food',
            recurrence: 'One-time',
            label: 'Manual',
            is_projected: false,
          }]);
          return;
        }

        if (url.pathname === '/rest/v1/rpc/server_now' && req.method === 'POST') {
          reply(res, 200, new Date().toISOString());
          return;
        }

        reply(res, 404, { message: `Unimplemented test endpoint: ${req.method} ${url.pathname}` });
      });
    },
  };
}
