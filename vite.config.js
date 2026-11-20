import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';

// 앱의 [네이버 로그인으로 가져오기] 버튼 → 로컬에서 Playwright 브라우저를 띄워 로그인/수집
const naverImport = () => {
  let running = null;
  return {
    name: 'naver-import',
    configureServer(server) {
      server.middlewares.use('/api/naver-import', (req, res) => {
        const wbId = new URL(req.url, 'http://x').searchParams.get('wbId') || '';
        if (running) { res.statusCode = 409; return res.end(JSON.stringify({ error: '이미 실행 중' })); }
        let log = '';
        running = spawn(process.execPath, ['scripts/naver-import.mjs', ...(wbId ? [wbId] : [])], { cwd: process.cwd() });
        running.stdout.on('data', (d) => { log += d; process.stdout.write(d); });
        running.stderr.on('data', (d) => { log += d; process.stderr.write(d); });
        running.on('close', (code) => {
          running = null;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: code === 0, log }));
        });
      });
    },
  };
};

export default defineConfig({ base: './', plugins: [naverImport()] });
