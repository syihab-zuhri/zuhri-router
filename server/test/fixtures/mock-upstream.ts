// Mock upstream for gateway tests (copied from the TASK-006 spike). Behaviour is selected by the upstream model name.
import http from 'node:http';

export type MockStats = { calls: Record<string, number>; aborts: number; last?: { url: string; headers: any; body: any } };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function startMock(port: number): Promise<{ server: http.Server; stats: MockStats }> {
  const stats: MockStats = { calls: {}, aborts: 0 };
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const j = JSON.parse(body || '{}'); const mode: string = j.model ?? 'ok';
    stats.last = { url: req.url!, headers: req.headers, body: j };
    stats.calls[mode] = (stats.calls[mode] ?? 0) + 1;
    let finished = false; res.on('close', () => { if (!finished) stats.aborts++; });
    const anthropic = req.url!.includes('/messages');
    if (mode === 'fail503') { res.writeHead(503, { 'content-type': 'application/json' }); finished = true; return res.end('{"error":{"message":"overloaded"}}'); }
    if (mode === 'bad400') { res.writeHead(400, { 'content-type': 'application/json' }); finished = true; return res.end('{"error":{"message":"invalid format"}}'); }
    if (mode === 'hang-first') { await sleep(5000); finished = true; return res.destroy(); }
    if (j.stream !== true) {
      finished = true; res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(anthropic
        ? { type: 'message', content: [{ type: 'text', text: 'Halo dari upstream tiruan' }], usage: { input_tokens: 2000, cache_read_input_tokens: 8000, cache_creation_input_tokens: 0, output_tokens: 1000 } }
        : { choices: [{ index: 0, message: { role: 'assistant', content: 'Halo dari upstream tiruan' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10000, completion_tokens: 1000, total_tokens: 11000, prompt_cache_hit_tokens: 8000, prompt_cache_miss_tokens: 2000 } }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const words = mode === 'zero' ? [] : ['Halo', ' dari', ' upstream', ' tiruan', ' ✓', ' selesai'];
    const gap = mode === 'slow' ? 150 : 0;
    const usage = mode === 'zero' ? { in: 0, out: 0, hit: 0 } : { in: 2000, out: 1000, hit: 8000 };
    const send = (s: string) => res.write(s);
    if (anthropic) {
      send(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: usage.in, cache_read_input_tokens: usage.hit, cache_creation_input_tokens: 0, output_tokens: 0 } } })}\n\n`);
      send(`event: ping\ndata: {"type":"ping"}\n\n`);
      for (let i = 0; i < words.length; i++) {
        if (mode === 'die-mid' && i === 3) { await sleep(40); finished = true; return res.destroy(); } // let earlier chunks flush first
        send(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: words[i] } })}\n\n`);
        if (gap) await sleep(gap);
      }
      send(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: usage.out } })}\n\n`);
      send(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
    } else {
      for (let i = 0; i < words.length; i++) {
        if (mode === 'die-mid' && i === 3) { await sleep(40); finished = true; return res.destroy(); } // let earlier chunks flush first
        send(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: words[i] } }] })}\n\n`);
        if (gap) await sleep(gap);
      }
      // OpenAI-compatible shape with inclusive prompt_tokens, split into cache hit/miss (DeepSeek-style)
      send(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: usage.in + usage.hit, completion_tokens: usage.out, total_tokens: usage.in + usage.hit + usage.out, prompt_cache_hit_tokens: usage.hit, prompt_cache_miss_tokens: usage.in } })}\n\n`);
      send('data: [DONE]\n\n');
    }
    finished = true; res.end();
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, stats })));
}
