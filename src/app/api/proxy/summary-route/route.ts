import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

const TEXT_SELECTORS = 'h1, h2, h3, h4, p, li, blockquote';

// ── HuggingFace Qwen2.5 helper ───────────────────────────────────────────────
async function callQwen(prompt: string): Promise<string> {
  const res = await fetch(
    'https://router.huggingface.co/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'Qwen/Qwen2.5-72B-Instruct:fastest',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
        temperature: 0.3,
        // NOTE: response_format is NOT sent — OpenAI-only, HuggingFace rejects it
      }),
      signal: AbortSignal.timeout(55_000),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HuggingFace API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '{}';
}

/**
 * Robustly extract the first JSON object from a model response.
 * Models sometimes wrap output in prose or markdown code fences.
 */
function extractJson(raw: string): string {
  const stripped = raw.replace(/^```(json)?\s*|```\s*$/gm, '').trim();
  const start = stripped.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in model response');
  let depth = 0;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') {
      depth--;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  throw new Error('Unterminated JSON object in model response');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return NextResponse.json({ error: 'Missing URL' }, { status: 400 });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      return NextResponse.json({ bullets: [], readingTime: '' });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove noise before extracting text
    $('nav, header, footer, aside, script, noscript, style, .cookie-banner, .modal, .ad').remove();

    let fullText = '';
    $(TEXT_SELECTORS).each((i, el) => {
      fullText += $(el).text() + '\n';
    });

    // Truncate to keep tokens manageable (summary only needs a sample)
    const truncatedText = fullText.substring(0, 6000);

    if (truncatedText.trim().length < 100) {
      return NextResponse.json({ bullets: [], readingTime: '' });
    }

    // Estimate reading time (avg 200 words/min)
    const wordCount = fullText.split(/\s+/).length;
    const minutes = Math.ceil(wordCount / 200);
    const readingTime = minutes <= 1 ? '~1 min' : `~${minutes} min`;

    const promptText = `You must respond with ONLY a raw JSON object — no markdown, no code fences, no explanation, no extra text.
Return exactly this structure: {"bullets": ["sentence one", "sentence two", "sentence three"], "readingTime": "${readingTime}"}

Rules:
- Exactly 3 bullet points
- Each bullet must be one clear sentence, under 20 words
- Use simple language (Grade 5 reading level)
- Focus on what the page is ACTUALLY about

Webpage text to summarise:
${truncatedText}`.trim();

    try {
      const textResponse = await callQwen(promptText);
      const jsonStr = extractJson(textResponse);
      const summaryData = JSON.parse(jsonStr);
      return NextResponse.json({
        bullets: Array.isArray(summaryData.bullets) ? summaryData.bullets.slice(0, 3) : [],
        readingTime: summaryData.readingTime || readingTime,
      });
    } catch (apiError: any) {
      console.error('Summary AI error:', apiError.message);
      // Graceful fallback — do not 500, just return empty so UI shows the fallback message
      return NextResponse.json({ bullets: [], readingTime });
    }

  } catch (err: any) {
    console.error('Summary route error:', err.message);
    return NextResponse.json({ bullets: [], readingTime: '' });
  }
}