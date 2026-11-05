/* core.js - 책 텍스트 처리(본문 찾기, 문장 나누기, 단어 뽑기). 브라우저와 node 둘 다에서 동작 */
(function (root) {
  'use strict';

  const ABBR = /(?:^|[\s“"‘'(])(Mr|Mrs|Ms|Dr|St|Messrs|Mme|Mlle|M|Jr|Sr|Capt|Col|Gen|Lt|Sgt|Prof|Rev|Hon|vs|etc|No|Mt|Co)\.$/;

  function normalizeText(raw) {
    let t = raw.replace(/\r/g, '');
    t = t.replace(/\\([*_!\[\]#])/g, '$1');            // 마크다운 이스케이프 제거
    t = t.replace(/  \n/g, '\n');
    return t;
  }

  /** 구텐베르크 머리말/꼬리말 제거 후 본문 문단 목록을 돌려줌 */
  function extractParagraphs(raw) {
    let t = normalizeText(raw);
    const meta = {};
    const mt = t.match(/^Title:\s*(.+)$/m); if (mt) meta.title = mt[1].trim();
    const ma = t.match(/^Author:\s*(.+)$/m); if (ma) meta.author = ma[1].trim();

    const s = t.search(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
    if (s >= 0) t = t.slice(t.indexOf('\n', s) + 1);
    const e = t.search(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG/i);
    if (e >= 0) t = t.slice(0, e);

    const lines = t.split('\n').map(l => l.replace(/\s+$/, ''));
    // 문단 = 빈 줄로 구분
    const blocks = [];
    let cur = [];
    for (const l of lines) {
      if (l.trim() === '') { if (cur.length) { blocks.push(cur); cur = []; } }
      else cur.push(l);
    }
    if (cur.length) blocks.push(cur);

    const isChapterLine = l => /^\s*(CHAPTER|Chapter)\s+([IVXLC]+|\d+|[A-Z][a-z]+)\.?\s*$/.test(l);
    // 본문 시작: 홀로 서 있는 "CHAPTER I" (목차 줄은 뒤에 제목이 붙어서 걸리지 않음)
    let startBlock = blocks.findIndex(b => b.length <= 3 && isChapterLine(b[0]) &&
      /^\s*(CHAPTER|Chapter)\s+(I|1|ONE|One)\.?\s*$/.test(b[0]));
    // 제목이 같은 블록에 없고 다음 블록이 제목인 경우를 위해 아래에서 제목 블록도 같이 제거
    const paras = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const text = b.map(x => x.trim()).join(' ').replace(/\s+/g, ' ').trim();
      paras.push({ text, chapterHead: b.length <= 3 && isChapterLine(b[0]), blockIndex: i, lines: b });
    }
    if (startBlock < 0) {
      // 대체: 200자 넘는 첫 문단
      startBlock = blocks.findIndex(b => b.join(' ').length > 200);
      if (startBlock < 0) startBlock = 0;
    }
    const out = [];
    const chapters = [];                  // 장 시작 위치(문단 번호)와 제목
    let skipTitle = false;
    for (let i = startBlock; i < paras.length; i++) {
      const p = paras[i];
      if (p.chapterHead) { chapters.push({ para: out.length, label: p.text, title: '' }); skipTitle = true; if (p.lines.length > 1) skipTitle = false; continue; }
      if (skipTitle) {                    // 챕터 제목(짧은 줄) 건너뛰기
        skipTitle = false;
        if (p.text.length < 80 && !/[.!?]["”’]?$/.test(p.text)) { if (chapters.length) chapters[chapters.length - 1].title = p.text.replace(/\.$/, ''); continue; }
      }
      let txt = p.text.replace(/\[Illustration[^\]]*\]/gi, '').replace(/_/g, '').replace(/\s+/g, ' ').trim();
      if (!txt) continue;
      if (/^(THE END|FINIS|\* \* \*.*)$/i.test(txt)) continue;
      if (/^(\*\s*){3,}$/.test(txt)) continue;
      if (/^(Produced by|Transcriber)/i.test(txt)) continue;
      out.push(txt);
    }
    return { paragraphs: out, meta, chapters };
  }

  function wordCount(s) { return (s.match(/[A-Za-z]+/g) || []).length; }

  function splitSentences(paragraphs) {
    const seg = (typeof Intl !== 'undefined' && Intl.Segmenter)
      ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;
    const result = [];
    for (let pi = 0; pi < paragraphs.length; pi++) {
      let parts = [];
      const p = paragraphs[pi];
      if (seg) { for (const x of seg.segment(p)) parts.push(x.segment.trim()); }
      else parts = (p.match(/[^.!?]+(?:[.!?]+["”’)]*|$)\s*/g) || [p]).map(x => x.trim());
      parts = parts.filter(Boolean);
      // 줄임말(Mr. 등) 뒤에서 잘린 것 다시 합치기
      const merged = [];
      for (const part of parts) {
        const prev = merged[merged.length - 1];
        if (prev && (ABBR.test(prev) || /^[a-z]/.test(part) || /^\([a-z]/.test(part) || /^[”’"'),;:]/.test(part))) merged[merged.length - 1] = prev + ' ' + part;
        else merged.push(part);
      }
      // 너무 짧은 조각(감탄사 등)은 이웃과 합치기: 3단어 미만이면 다음 문장 앞에 붙임
      const fin = [];
      let carry = '';
      for (let i = 0; i < merged.length; i++) {
        let cur = carry ? carry + ' ' + merged[i] : merged[i];
        carry = '';
        if (wordCount(cur) < 3 && i < merged.length - 1) { carry = cur; continue; }
        fin.push(cur);
      }
      if (carry) { if (fin.length) fin[fin.length - 1] += ' ' + carry; else fin.push(carry); }
      for (const f of fin) result.push({ text: f, para: pi });
    }
    return result;
  }

  function tokenize(sentence) {
    const out = [];
    const re = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
    let m, last = 0;
    while ((m = re.exec(sentence))) {
      if (m.index > last) out.push({ type: 'sep', text: sentence.slice(last, m.index) });
      out.push({ type: 'word', text: m[0], key: wordKey(m[0]) });
      last = m.index + m[0].length;
    }
    if (last < sentence.length) out.push({ type: 'sep', text: sentence.slice(last) });
    return out;
  }

  function wordKey(w) {
    return w.toLowerCase().replace(/’/g, "'").replace(/'s$/, '');
  }

  function normSentence(s) {
    return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  }
  function hashSentence(s) {
    const n = normSentence(s);
    let h1 = 5381, h2 = 52711;
    for (let i = 0; i < n.length; i++) {
      const c = n.charCodeAt(i);
      h1 = ((h1 << 5) + h1 + c) | 0;
      h2 = ((h2 << 5) ^ h2 ^ c) | 0;
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  }

  function parseBook(raw) {
    const { paragraphs, meta, chapters: chs } = extractParagraphs(raw);
    const sp = splitSentences(paragraphs);
    const sentences = sp.map(s => s.text);
    // 장 목록: 각 장이 시작하는 문장 번호(0부터)
    const chapters = [];
    (chs || []).forEach((c, k) => {
      const start = sp.findIndex(x => x.para >= c.para);
      if (start < 0) return;
      if (chapters.length && chapters[chapters.length - 1].start === start) return;
      let ti = (c.title || String(c.label || '').replace(/^\s*chapter\s+[A-Za-z0-9]+\.?\s*/i, '')).trim();
      if (ti && ti === ti.toUpperCase()) ti = ti.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/([’'])S\b/g, '$1s').replace(/\b(Of|The|A|An|In|At|To|And|For|On)\b(?!$)/g, w => w.toLowerCase()).replace(/^./, x => x.toUpperCase());
      chapters.push({ n: chapters.length + 1, title: ti, start });
    });
    if (!chapters.length || chapters[0].start > 0) chapters.unshift({ n: 0, title: '', start: 0 });
    chapters.forEach((c, k) => { c.n = k + 1; c.end = k + 1 < chapters.length ? chapters[k + 1].start : sentences.length; });
    return { meta, paragraphs, sentences, chapters };
  }

  const api = { parseBook, extractParagraphs, splitSentences, tokenize, wordKey, hashSentence, normSentence };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
