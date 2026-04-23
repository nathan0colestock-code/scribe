// Gemini-backed proofreading and style-check.
//
// Returns structured suggestions as JSON so the frontend can render them as
// ProseMirror decorations. Never writes to Yjs or SQLite — it's a pure
// request/response surface.

import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = process.env.GEMINI_API_KEY || '';
const genai = API_KEY ? new GoogleGenerativeAI(API_KEY) : null;

const PROOFREAD_PROMPT = `You are a careful proofreader. Return ONLY a JSON array of issues you found in the provided text, no prose.

Each issue: {"start": int, "end": int, "kind": "grammar"|"capitalization"|"spelling", "before": string, "after": string, "reason": string}

"start" and "end" are character offsets into the PROVIDED TEXT (not context). "before" is the exact substring at [start, end). "after" is your suggested replacement. "reason" is one short sentence. Skip stylistic preferences — only mechanical issues.

Return [] if nothing is wrong. No markdown, no code fences, no leading text.`;

function styleCheckPrompt(guide) {
  return `You are a writing coach. The user's style guide is:

<style-guide>
${guide || '(no guide provided)'}
</style-guide>

Return ONLY a JSON array of specific rewrites that improve adherence to the guide. No prose.

Each item: {"start": int, "end": int, "kind": "style", "before": string, "after": string, "rule": string, "reason": string}

"rule" is a short quote from the guide that the issue violates (or the guide's closest rule). "start" and "end" are character offsets into the provided text. Skip grammar/spelling — those are handled elsewhere. Prefer concrete, concise suggestions. If there are no issues, return [].`;
}

async function runModel(modelName, prompt, text) {
  if (!genai) {
    return { error: 'GEMINI_API_KEY not set', suggestions: [] };
  }
  const model = genai.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  });
  const contents = [
    { role: 'user', parts: [{ text: prompt }] },
    { role: 'user', parts: [{ text: `<text>\n${text}\n</text>` }] },
  ];
  const res = await model.generateContent({ contents });
  const raw = res.response.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { parsed = JSON.parse(cleaned); } catch { parsed = []; }
  }
  if (!Array.isArray(parsed)) parsed = [];
  // Validate shape and clamp to text length.
  const len = text.length;
  const suggestions = parsed
    .filter(s => s && typeof s === 'object' && Number.isInteger(s.start) && Number.isInteger(s.end))
    .map(s => ({
      start: Math.max(0, Math.min(len, s.start)),
      end: Math.max(0, Math.min(len, s.end)),
      kind: String(s.kind || 'grammar'),
      before: typeof s.before === 'string' ? s.before : '',
      after: typeof s.after === 'string' ? s.after : '',
      reason: typeof s.reason === 'string' ? s.reason : '',
      rule: typeof s.rule === 'string' ? s.rule : undefined,
    }))
    .filter(s => s.end > s.start);
  return { suggestions };
}

export async function proofread(text) {
  return runModel('gemini-2.5-flash', PROOFREAD_PROMPT, text || '');
}

export async function styleCheck(text, styleGuideBody) {
  return runModel('gemini-2.5-pro', styleCheckPrompt(styleGuideBody), text || '');
}
