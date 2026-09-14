// Minimal Ada syntax highlighter — tokenizes a line/source into HTML spans.
const ADA_KEYWORDS = new Set([
  "abort","abs","abstract","accept","access","aliased","all","and","array","at",
  "begin","body","case","constant","declare","delay","delta","digits","do",
  "else","elsif","end","entry","exception","exit","for","function","generic",
  "goto","if","in","interface","is","limited","loop","mod","new","not","null",
  "of","or","others","out","overriding","package","pragma","private","procedure",
  "protected","raise","range","record","rem","renames","requeue","return",
  "reverse","select","separate","some","subtype","synchronized","tagged","task",
  "terminate","then","type","until","use","when","while","with","xor"
]);

const ADA_TYPES = new Set([
  "Integer","Float","Boolean","Character","String","Natural","Positive",
  "Duration","Long_Integer","Long_Float","Short_Integer","Wide_Character",
  "Wide_String","Unbounded_String"
]);

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightAda(source) {
  const out = [];
  let i = 0;
  const n = source.length;

  const isIdentStart = c => /[A-Za-z]/.test(c);
  const isIdentPart = c => /[A-Za-z0-9_]/.test(c);
  const isDigit = c => /[0-9]/.test(c);

  while (i < n) {
    const c = source[i];

    // line comment
    if (c === "-" && source[i + 1] === "-") {
      let j = i;
      while (j < n && source[j] !== "\n") j++;
      out.push(`<span class="tok-comment">${escapeHtml(source.slice(i, j))}</span>`);
      i = j;
      continue;
    }

    // string literal
    if (c === '"') {
      let j = i + 1;
      while (j < n && source[j] !== '"') j++;
      j = Math.min(j + 1, n);
      out.push(`<span class="tok-string">${escapeHtml(source.slice(i, j))}</span>`);
      i = j;
      continue;
    }

    // character literal 'x'
    if (c === "'" && source[i + 2] === "'" && i + 2 < n) {
      out.push(`<span class="tok-string">${escapeHtml(source.slice(i, i + 3))}</span>`);
      i += 3;
      continue;
    }

    // attribute 'Something
    if (c === "'" && isIdentStart(source[i + 1] || "")) {
      let j = i + 1;
      while (j < n && isIdentPart(source[j])) j++;
      out.push(`<span class="tok-attr">${escapeHtml(source.slice(i, j))}</span>`);
      i = j;
      continue;
    }

    // number
    if (isDigit(c)) {
      let j = i;
      while (j < n && /[0-9_.eE#A-Fa-f+\-]/.test(source[j])) {
        if (/[+\-]/.test(source[j]) && !/[eE#]/.test(source[j - 1] || "")) break;
        j++;
      }
      out.push(`<span class="tok-number">${escapeHtml(source.slice(i, j))}</span>`);
      i = j;
      continue;
    }

    // identifier / keyword / type
    if (isIdentStart(c)) {
      let j = i;
      while (j < n && isIdentPart(source[j])) j++;
      const word = source.slice(i, j);
      const lower = word.toLowerCase();
      if (ADA_KEYWORDS.has(lower)) {
        out.push(`<span class="tok-keyword">${escapeHtml(word)}</span>`);
      } else if (ADA_TYPES.has(word)) {
        out.push(`<span class="tok-type">${escapeHtml(word)}</span>`);
      } else if (source[j] === "(" ) {
        out.push(`<span class="tok-call">${escapeHtml(word)}</span>`);
      } else {
        out.push(escapeHtml(word));
      }
      i = j;
      continue;
    }

    // punctuation / operators
    if (/[:;,.()\[\]]/.test(c)) {
      out.push(`<span class="tok-punct">${escapeHtml(c)}</span>`);
      i++;
      continue;
    }
    if (/[+\-*/<>=&]/.test(c)) {
      let j = i;
      while (j < n && /[+\-*/<>=&]/.test(source[j])) j++;
      out.push(`<span class="tok-op">${escapeHtml(source.slice(i, j))}</span>`);
      i = j;
      continue;
    }

    out.push(escapeHtml(c));
    i++;
  }

  return out.join("");
}
