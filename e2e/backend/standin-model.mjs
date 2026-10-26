// A stand-in for the model service, for the agent's browser test (see playwright.backend.config.ts). It looks a
// character up first, as the agent's tools allow, then answers from what the prompt contains.
import { createServer } from 'node:http';

createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    if (req.method !== 'POST') return res.writeHead(200).end('ok');
    const { model, messages, tools } = JSON.parse(raw);
    const reply = (message) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message }] }));
    if (tools && !messages.some((m) => m.role === 'tool')) {
      return reply({ role: 'assistant', content: null, tool_calls: [{ id: 'look', type: 'function', function: { name: 'get_entity', arguments: JSON.stringify({ name: 'Norman' }) } }] });
    }
    const prompt = messages.find((m) => m.role === 'user').content;
    const missing = (/Links with no page yet: (.*)/.exec(prompt)?.[1] ?? '').split(', ').filter((name) => name && name !== '(none)');
    // Someone named without a link, for "Link and file them".
    if (/\bBram\b/.test(prompt) && !prompt.includes('[[Bram]]')) missing.push('Bram');
    const answer = {
      newEntities: missing.map((name) => ({ name, type: 'Character', aliases: [] })),
      pages: missing.map((name) => ({ entity: name, edits: [{ add: 'Arrived at the inn in the rain.' }], certainty: 'stated' })),
      states: [{ entity: 'Norman', state: `surprised by a late guest (read by ${model})` }],
      contradictions: prompt.includes('never set foot in Ashford')
        ? [{ entity: 'Norman', claim: 'Norman has never been to Ashford', sceneQuote: 'Norman had never set foot in Ashford', wikiQuote: 'Norman keeps the inn at' }]
        : [],
    };
    reply({ role: 'assistant', content: `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` });
  });
}).listen(9912, '127.0.0.1');
