import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
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
        max_tokens: 2048,
        temperature: 0.3,
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HuggingFace API error: ${res.status} ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices[0].message.content ?? '{}';
}

/**
 * Robustly extract the first JSON object from a model response.
 * Models sometimes wrap their output in prose or markdown code fences;
 * this finds the first `{...}` block and returns it.
 */
function extractJson(raw: string): string {
  // Remove markdown code fences first
  const stripped = raw.replace(/^```(json)?\s*|```\s*$/gm, '').trim();
  // Find the first complete {...} block
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

const NOISE_SELECTORS = [
  'nav', 'header', 'footer', 'aside',
  '.cookie-banner', '.cookie-notice', '.gdpr', '#cookie',
  '.popup', '.modal', '.overlay',
  '.ad', '.ads', '.advertisement',
  '[class*="cookie"]', '[class*="popup"]', '[class*="banner"]', '[id*="cookie"]',
  '[role="banner"]', '[role="navigation"]',
];

const TEXT_SELECTORS = 'h1, h2, h3, h4, h5, h6, p, li, td, th, figcaption, blockquote, dt, dd';

type Mode = 'original' | 'simplified' | 'translated' | 'dyslexia';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');
  const mode = (searchParams.get('mode') || 'simplified') as Mode;

  if (!targetUrl) return new NextResponse('Missing URL', { status: 400 });

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  try {
    // ── 1. Fetch ────────────────────────────────────────────────────────────
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return new NextResponse(
        errorPage(`Could not reach that website (${response.status} ${response.statusText}). It may block automated access.`),
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('html')) {
      return new NextResponse(
        errorPage("That URL doesn't appear to be a webpage (e.g. it might be a PDF)."),
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // ── 2. Base tag ─────────────────────────────────────────────────────────
    const baseHref = targetUrl.endsWith('/')
      ? targetUrl
      : targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
    $('head base').remove();
    if ($('head').length === 0) $('html').prepend('<head></head>');
    $('head').prepend(`<base href="${baseHref}">`);

    // ── 3. Strip scripts (always) ───────────────────────────────────────────
    $('script').remove();
    $('noscript').remove();

    // ── 4. ORIGINAL mode — return with TTS + focus scripts ─────────────────
    if (mode === 'original') {
      injectAccessibilityScripts($);
      return new NextResponse($.html(), { headers: htmlHeaders() });
    }

    // ── 5. DYSLEXIA mode ────────────────────────────────────────────────────
    if (mode === 'dyslexia') {
      // Remove noise
      NOISE_SELECTORS.forEach(s => { try { $(s).remove(); } catch { } });

      // FIX: Use the jsDelivr-hosted OpenDyslexic font which has correct file paths,
      // combined with a reliable Google Fonts fallback. The previous npm CDN paths
      // for open-dyslexic@1.0.3 did not resolve correctly.
      $('head').append(`
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <style>
          /* OpenDyslexic via jsDelivr — verified working CDN paths */
          @font-face {
            font-family: 'OpenDyslexic';
            src: url('https://cdn.jsdelivr.net/gh/antijingoist/open-dyslexic@master/compiled/OpenDyslexic-Regular.otf') format('opentype');
            font-weight: normal;
            font-style: normal;
          }
          @font-face {
            font-family: 'OpenDyslexic';
            src: url('https://cdn.jsdelivr.net/gh/antijingoist/open-dyslexic@master/compiled/OpenDyslexic-Bold.otf') format('opentype');
            font-weight: bold;
            font-style: normal;
          }
          @font-face {
            font-family: 'OpenDyslexic';
            src: url('https://cdn.jsdelivr.net/gh/antijingoist/open-dyslexic@master/compiled/OpenDyslexic-Italic.otf') format('opentype');
            font-weight: normal;
            font-style: italic;
          }

          *, *::before, *::after {
            font-family: 'OpenDyslexic', 'Arial', sans-serif !important;
          }

          /* Dyslexia-friendly reading styles */
          body {
            background: #fdf6e3 !important; /* Warm cream — easier on the eyes */
            color: #1a1a1a !important;
            max-width: 800px !important;
            margin: 0 auto !important;
            padding: 2rem !important;
          }

          p, li, td, dd, span, div {
            font-size: 1.15rem !important;
            line-height: 1.8 !important;
            letter-spacing: 0.03em !important;
            word-spacing: 0.08em !important;
          }

          h1 { font-size: 2rem !important; line-height: 1.4 !important; margin-bottom: 1rem !important; }
          h2 { font-size: 1.6rem !important; line-height: 1.4 !important; }
          h3 { font-size: 1.3rem !important; line-height: 1.4 !important; }

          /* High contrast links */
          a { color: #1a0dab !important; text-decoration: underline !important; }
          a:visited { color: #551a8b !important; }

          /* Limit paragraph width — wide columns are harder for dyslexic readers */
          p { max-width: 70ch !important; }

          /* Remove busy backgrounds */
          * { background-image: none !important; }
          body, main, article, section, div {
            background-color: transparent !important;
          }
          body { background-color: #fdf6e3 !important; }

          /* Subtle coloured ruler every other paragraph to aid line tracking */
          p:nth-child(odd) {
            background-color: rgba(0,0,0,0.025) !important;
            padding: 4px 8px !important;
            border-radius: 4px !important;
          }
        </style>
      `);

      injectAccessibilityScripts($);
      return new NextResponse($.html(), { headers: htmlHeaders() });
    }

    // ── 6. SIMPLIFIED / TRANSLATED mode — run AI ───────────────────────────
    NOISE_SELECTORS.forEach(s => { try { $(s).remove(); } catch { } });

    const textNodes: { index: number; text: string; el: any }[] = [];
    $(TEXT_SELECTORS).each((i, el) => {
      const directText = $(el).clone().children().remove().end().text().trim();
      if (directText.length > 15) textNodes.push({ index: i, text: directText, el });
    });

    const nodesToProcess = textNodes.slice(0, 50);

    if (nodesToProcess.length === 0) {
      injectAccessibilityScripts($);
      return new NextResponse($.html(), { headers: htmlHeaders() });
    }

    const textMap: Record<number, string> = {};
    nodesToProcess.forEach(n => { textMap[n.index] = n.text; });

    // Call Qwen AI model for simplification / translation
    const promptInstruction = mode === 'translated'
      ? `You must respond with ONLY a raw JSON object — no markdown, no code fences, no explanation, no extra text.
Translate every VALUE in the JSON object below into Tamil. Keep all JSON keys exactly the same.
Example output format: {"0": "Tamil text here", "1": "Tamil text here"}

JSON to translate:`
      : `You must respond with ONLY a raw JSON object — no markdown, no code fences, no explanation, no extra text.
Rewrite every VALUE in the JSON object below so it reads at a 6th-grade level:
- Replace technical jargon with plain, everyday words
- Keep sentences short and clear
- Keep numbers and proper nouns exactly as-is
- Keep all JSON keys exactly the same
Example output format: {"0": "Simple text here", "1": "Simple text here"}

JSON to rewrite:`;

    let aiSucceeded = false;
    try {
      const aiResponseText = await callQwen(`${promptInstruction}\n${JSON.stringify(textMap)}`);
      const jsonStr = extractJson(aiResponseText);
      const updatedMap: Record<string, string> = JSON.parse(jsonStr);
      nodesToProcess.forEach(n => {
        const newText = updatedMap[String(n.index)] ?? updatedMap[n.index];
        if (newText && typeof newText === 'string') $(n.el).text(newText);
      });
      aiSucceeded = true;
    } catch (apiErr) {
      console.error('AI simplification error:', apiErr);
    }

    // If AI failed, inject a gentle notice banner so the user understands why text looks unchanged
    if (!aiSucceeded && mode === 'simplified') {
      $('body').prepend(`
        <div style="position:sticky;top:0;z-index:9999;background:#fef3c7;border-bottom:2px solid #f59e0b;padding:10px 16px;font-family:sans-serif;font-size:14px;color:#92400e;display:flex;align-items:center;gap:8px;">
          <span style="font-size:18px;">⚠️</span>
          <span><strong>AI simplification unavailable right now</strong> — showing the original page. The AI model may be busy; please try again in a moment.</span>
        </div>
      `);
    }

    // Inject mode-specific styles
    if (mode === 'simplified') {
      $('head').append(`
        <style>
          body { font-family: Georgia, serif !important; line-height: 1.8 !important; background: #fff !important; padding: 1.5rem !important; margin: 0 auto !important; max-width: 850px !important; }
          p, li, td, dd { font-size: 1.15rem !important; color: #1a1a1a !important; margin-bottom: 1.2rem !important; }
          h1 { font-size: 2rem !important; margin-bottom: 1.5rem !important; } h2 { font-size: 1.6rem !important; margin-top: 2rem !important; } h3 { font-size: 1.3rem !important; }
          a { color: #1d4ed8 !important; text-decoration: underline !important; }
          img { max-width: 100% !important; height: auto !important; border-radius: 8px !important; }
        </style>
      `);
    }

    if (mode === 'translated') {
      $('head').append(`
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Noto Sans Tamil', 'Latha', sans-serif !important; line-height: 2 !important; }
          p, li, td { font-size: 1.15rem !important; color: #1a1a1a !important; }
        </style>
      `);
    }

    injectAccessibilityScripts($);
    return new NextResponse($.html(), { headers: htmlHeaders() });

  } catch (err: any) {
    console.error('Proxy error:', err);
    const msg = err.name === 'TimeoutError'
      ? 'That website took too long to respond. Try a different URL.'
      : `Something went wrong: ${err.message}`;
    return new NextResponse(errorPage(msg), { headers: { 'Content-Type': 'text/html' } });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Injects two scripts into the page:
 * 1. TTS responder — sends page text back to parent on request
 * 2. Focus mode controller — pauses GIFs, videos, CSS animations on command
 */
function injectAccessibilityScripts($: ReturnType<typeof cheerio.load>) {
  $('body').append(`
    <script>
    (function() {
      // ── TTS responder ────────────────────────────────────────────────────
      window.addEventListener('message', function(e) {
        if (e.data === 'REQUEST_READABLE_TEXT') {
          var text = document.body ? document.body.innerText : '';
          e.source.postMessage({ type: 'READABLE_TEXT', text: text }, e.origin || '*');
        }

        // ── Focus mode controller ────────────────────────────────────────
        if (e.data === 'EQUINET_FOCUS_ON') {
          applyFocusMode(true);
        }
        if (e.data === 'EQUINET_FOCUS_OFF') {
          applyFocusMode(false);
        }
      });

      function applyFocusMode(on) {
        // 1. Pause / play all <video> elements
        var videos = document.querySelectorAll('video');
        videos.forEach(function(v) {
          if (on) { v.pause(); v.dataset.equinetPaused = '1'; }
          else if (v.dataset.equinetPaused) { v.play(); delete v.dataset.equinetPaused; }
        });

        // 2. Freeze animated GIFs by replacing src with a canvas snapshot
        var imgs = document.querySelectorAll('img');
        imgs.forEach(function(img) {
          if (on) {
            if (!img.src || !img.src.toLowerCase().includes('.gif')) return;
            if (img.dataset.equinetOrigSrc) return; // already frozen
            try {
              var c = document.createElement('canvas');
              c.width = img.naturalWidth || img.width;
              c.height = img.naturalHeight || img.height;
              var ctx = c.getContext('2d');
              if (!ctx) return;
              ctx.drawImage(img, 0, 0);
              img.dataset.equinetOrigSrc = img.src;
              img.src = c.toDataURL();
            } catch(err) { /* cross-origin images will throw — skip */ }
          } else {
            if (img.dataset.equinetOrigSrc) {
              img.src = img.dataset.equinetOrigSrc;
              delete img.dataset.equinetOrigSrc;
            }
          }
        });

        // 3. Halt / resume CSS animations and transitions
        var style = document.getElementById('equinet-focus-style');
        if (on) {
          if (!style) {
            style = document.createElement('style');
            style.id = 'equinet-focus-style';
            style.textContent = [
              '*, *::before, *::after {',
              '  animation-play-state: paused !important;',
              '  transition: none !important;',
              '}'
            ].join('');
            document.head.appendChild(style);
          }
        } else {
          if (style) style.remove();
        }
      }
    })();
    </script>
  `);
}

function htmlHeaders() {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Frame-Options': 'SAMEORIGIN',
  };
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>EquiNet — Could Not Load</title>
  <style>
    body { font-family: -apple-system, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#f8fafc; }
    .card { max-width:480px; padding:3rem 2rem; text-align:center; background:white; border-radius:1.5rem; box-shadow:0 4px 24px rgba(0,0,0,0.08); border:1px solid #e2e8f0; }
    .icon { font-size:3rem; margin-bottom:1rem; }
    h2 { font-size:1.25rem; margin:0 0 0.75rem; color:#0f172a; }
    p { font-size:0.95rem; line-height:1.6; color:#64748b; margin:0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h2>Page Could Not Be Loaded</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
}