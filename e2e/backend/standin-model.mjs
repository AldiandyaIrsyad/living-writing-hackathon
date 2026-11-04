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
    // The flow reading (src/agent/flow.ts): it places the scene from the outline it was given, and finds a mood that
    // does not fit whenever someone comes into the scene with a state.
    if (messages[0].content.startsWith("You read a story's structure")) {
      const prompt = messages.find((m) => m.role === 'user').content;
      const [, n, of] = /this scene is (\d+) of (\d+) in reading order/.exec(prompt);
      const state = /Characters' states as this scene begins:\n- ([^:\n]+): (.+)/.exec(prompt);
      const answer = {
        position: `Scene ${n} of ${of} in reading order`,
        role: 'Turn',
        why: `Read by ${model}.`,
        tone: 'quiet, wary',
        shift: 'Calmer than the scene before it.',
        moodChecks: state ? [{ entity: state[1], state: state[2], sceneQuote: '', note: `${state[1]} seems at ease for someone ${state[2]}.` }] : [],
      };
      return reply({ role: 'assistant', content: JSON.stringify(answer) });
    }
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
