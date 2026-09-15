// ===== bundled: highlight.js + interpreter.js + app.js (merged to cut per-visit request count on Vercel) =====
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

// A small, educational Ada interpreter — supports a wide, realistic subset of Ada:
// procedures & functions (parameters, recursion, in/out/in-out modes), variables,
// constants, arrays (anonymous & named types), records, enumerated types, subtypes/
// aliases, field & index access (incl. nested, e.g. A(I).Field), if/elsif/else,
// case, for/while loops, declare blocks, exception handling, abs, and-then/or-else
// short-circuit operators, 'First/'Last/'Length/'Pos/'Val/'Image attributes,
// Put_Line/Put/New_Line, and Ada's usual expression operators.
// It is NOT a real compiler — it's enough to make real student algorithms
// (recursion, sorting, searching, small data models) run in the browser terminal.

class AdaError extends Error {
  constructor(message, line, col) {
    super(message);
    this.line = line;
    this.col = col;
  }
}

// Internal control-flow signal used to unwind out of a subprogram on `return`.
class ReturnSignal {
  constructor(value) { this.value = value; }
}

class LoopExitSignal {}

class AdaArray {
  constructor(low, high, items) {
    this.low = low;
    this.high = high;
    this.items = items;
  }
}

class AdaRecord {
  constructor(fieldDefs) {
    this.fieldOrder = fieldDefs.map(f => f.name);
    this.values = new Map();
  }
  get(name) {
    const key = name.toLowerCase();
    if (!this.values.has(key)) throw new AdaError(`"${name}" is not a field of this record`);
    return this.values.get(key);
  }
  set(name, val) { this.values.set(name.toLowerCase(), val); }
}

// Backs Ada.Containers.Vectors' Vector type — a plain growable array. Real Ada tracks
// an Index_Type/Element_Type per instantiation; we don't type-check element contents,
// so one class serves every instantiation regardless of its generic parameters.
class AdaVector {
  constructor() { this.items = []; }
}

class AdaEnum {
  constructor(typeName, name, ordinal) {
    this.typeName = typeName;
    this.name = name;
    this.ordinal = ordinal;
  }
}

function valuesEqual(a, b) {
  if (a instanceof AdaEnum && b instanceof AdaEnum) return a.ordinal === b.ordinal && a.typeName === b.typeName;
  return a === b;
}
function ordinalOf(v) { return v instanceof AdaEnum ? v.ordinal : v; }
// Ada rounds to the nearest whole number, ties away from zero (RM 4.6) — unlike
// JS Math.round, which rounds -2.5 to -2 instead of -3.
function adaRound(x) { return x < 0 ? -Math.round(-x) : Math.round(x); }

// Resolves a call's arguments — parsed as {name, expr}[], some possibly named
// ("Item => X") — against an ordered list of parameter names, Ada-style: positional
// arguments fill left-to-right, named ones fill by name, and a named argument can't
// be followed by a positional one. Returns an array of expr nodes (or undefined for
// any parameter nothing was passed for), aligned to `paramNames`.
// Ada.Float_Text_IO / Ada.Integer_Text_IO-style Put(Item, Fore, Aft, Exp): Aft digits
// after the decimal point, Exp = 0 for plain fixed notation (student programs never
// ask for real scientific notation here), Fore = minimum digit width before the point.
function formatAdaFloat(v, fore, aft, exp) {
  if (exp && exp > 0) return v.toExponential(aft);
  const sign = v < 0 ? "-" : "";
  const fixed = Math.abs(v).toFixed(Math.max(0, aft));
  const [intPart, fracPart] = fixed.split(".");
  const body = intPart.padStart(Math.max(0, fore), " ") + (fracPart !== undefined ? "." + fracPart : "");
  return sign + body;
}

function resolveArgs(paramNames, args) {
  const result = new Array(paramNames.length).fill(undefined);
  let sawNamed = false;
  args.forEach((a, i) => {
    if (a.name != null) {
      sawNamed = true;
      const idx = paramNames.findIndex(p => p.toLowerCase() === a.name.toLowerCase());
      if (idx === -1) throw new AdaError(`no parameter named "${a.name}" here`);
      result[idx] = a.expr;
    } else {
      if (sawNamed) throw new AdaError(`positional parameter association cannot follow a named association`);
      result[i] = a.expr;
    }
  });
  return result;
}

class Lexer {
  constructor(src) {
    this.src = src;
    this.pos = 0;
    this.tokens = [];
    // prefix sum of line-start offsets, used to turn a char index into line:col
    this.lineStarts = [0];
    for (let k = 0; k < src.length; k++) if (src[k] === "\n") this.lineStarts.push(k + 1);
    this.tokenize();
  }
  posOf(idx) {
    let lo = 0, hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return { line: lo + 1, col: idx - this.lineStarts[lo] + 1 };
  }
  tokenize() {
    const src = this.src;
    const n = src.length;
    let i = 0;
    const push = (type, value, startIdx) => {
      const { line, col } = this.posOf(startIdx);
      this.tokens.push({ type, value, line, col });
    };
    while (i < n) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "-" && src[i + 1] === "-") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === '"') {
        const start = i;
        let j = i + 1, str = "";
        while (j < n && src[j] !== '"') { str += src[j]; j++; }
        j++;
        push("string", str, start);
        i = j;
        continue;
      }
      if (c === "'" && src[i + 2] === "'") {
        push("char", src[i + 1], i);
        i += 3;
        continue;
      }
      if (c === "'" && /[A-Za-z]/.test(src[i + 1] || "")) {
        const start = i;
        let j = i + 1;
        while (j < n && /[A-Za-z]/.test(src[j])) j++;
        push("attr", src.slice(i + 1, j), start);
        i = j;
        continue;
      }
      if (/[0-9]/.test(c)) {
        const start = i;
        let j = i;
        while (j < n && /[0-9_.]/.test(src[j])) j++;
        // scientific notation: 6.674E-11, 1E10, 5_972E24, ...
        if ((src[j] === "e" || src[j] === "E") && /[0-9+-]/.test(src[j + 1] || "")) {
          j++;
          if (src[j] === "+" || src[j] === "-") j++;
          while (j < n && /[0-9_]/.test(src[j])) j++;
        }
        push("number", src.slice(i, j).replace(/_/g, ""), start);
        i = j;
        continue;
      }
      if (/[A-Za-z]/.test(c)) {
        const start = i;
        let j = i;
        while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        const word = src.slice(i, j);
        push("ident", word, start);
        i = j;
        continue;
      }
      // multi-char operators
      const two = src.slice(i, i + 2);
      if ([":=", "..", "/=", "<=", ">=", "**", "=>"].includes(two)) {
        push("op", two, i);
        i += 2;
        continue;
      }
      if ("+-*/<>=&(),;:.|".includes(c)) {
        push("op", c, i);
        i++;
        continue;
      }
      i++; // skip unknown char
    }
    push("eof", null, n);
  }
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }
  peek(offset = 0) { return this.tokens[this.pos + offset]; }
  next() { return this.tokens[this.pos++]; }
  atKeyword(word) {
    const t = this.peek();
    return t.type === "ident" && t.value.toLowerCase() === word;
  }
  atOp(op) {
    const t = this.peek();
    return t.type === "op" && t.value === op;
  }
  expectKeyword(word) {
    if (!this.atKeyword(word)) {
      const t = this.peek();
      throw new AdaError(`expected "${word}" but found "${t.value ?? "end of file"}"`, t.line, t.col);
    }
    return this.next();
  }
  expectOp(op) {
    const t = this.peek();
    if (t.type !== "op" || t.value !== op) {
      throw new AdaError(`missing "${op}"`, t.line, t.col);
    }
    return this.next();
  }
  expectIdent() {
    const t = this.peek();
    if (t.type !== "ident") throw new AdaError(`identifier expected`, t.line, t.col);
    return this.next().value;
  }

  // Looks ahead past a "(" to decide whether it starts an aggregate — a named
  // ("X => 1"), positional ("1, 2, 3") or "others =>" list — vs. a plain
  // parenthesized expression like "(A + B)". Doesn't consume anything.
  looksLikeAggregate() {
    if (!this.atOp("(")) return false;
    if (this.peek(1).type === "ident" && this.peek(1).value.toLowerCase() === "others") return true;
    let depth = 0;
    for (let i = this.pos; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.type === "op" && t.value === "(") depth++;
      else if (t.type === "op" && t.value === ")") { depth--; if (depth === 0) break; }
      else if (depth === 1 && t.type === "op" && (t.value === "," || t.value === "=>")) return true;
    }
    return false;
  }

  parseProgram() {
    while (this.atKeyword("with") || this.atKeyword("use")) {
      while (!this.atOp(";")) this.next();
      this.next();
    }
    this.expectKeyword("procedure");
    const name = this.expectIdent();
    if (this.atOp("(")) this.parseParams();
    this.expectKeyword("is");
    const decls = this.parseDeclarations();
    this.expectKeyword("begin");
    const body = this.parseStatements(["exception", "end"]);
    let handlers = null;
    if (this.atKeyword("exception")) { this.next(); handlers = this.parseExceptionHandlers(); }
    this.expectKeyword("end");
    if (this.peek().type === "ident") this.next();
    this.expectOp(";");
    return { name, decls, body, handlers };
  }

  parseParams() {
    const params = [];
    this.expectOp("(");
    if (!this.atOp(")")) {
      do {
        const names = [this.expectIdent()];
        while (this.atOp(",")) { this.next(); names.push(this.expectIdent()); }
        this.expectOp(":");
        let mode = "in";
        if (this.atKeyword("in")) { this.next(); if (this.atKeyword("out")) { this.next(); mode = "inout"; } }
        else if (this.atKeyword("out")) { this.next(); mode = "out"; }
        const type = this.expectIdent();
        for (const nm of names) params.push({ name: nm, type, mode });
      } while (this.atOp(";") ? (this.next(), true) : false);
    }
    this.expectOp(")");
    return params;
  }

  parseSubprogram() {
    const kind = this.next().value.toLowerCase(); // "procedure" | "function"
    const name = this.expectIdent();
    const params = this.atOp("(") ? this.parseParams() : [];
    let returnType = null;
    if (kind === "function") { this.expectKeyword("return"); returnType = this.expectIdent(); }
    this.expectKeyword("is");
    const decls = this.parseDeclarations();
    this.expectKeyword("begin");
    const body = this.parseStatements(["exception", "end"]);
    let handlers = null;
    if (this.atKeyword("exception")) { this.next(); handlers = this.parseExceptionHandlers(); }
    this.expectKeyword("end");
    if (this.peek().type === "ident") this.next();
    this.expectOp(";");
    return { kind, name, params, returnType, decls, body, handlers };
  }

  parseExceptionHandlers() {
    const handlers = [];
    while (this.atKeyword("when")) {
      this.next();
      let names = [];
      if (this.atKeyword("others")) { this.next(); names = ["others"]; }
      else {
        names.push(this.expectIdent());
        while (this.atOp("|")) { this.next(); names.push(this.expectIdent()); }
      }
      this.expectOp("=>");
      const body = this.parseStatements(["when", "end"]);
      handlers.push({ names, body });
    }
    return handlers;
  }

  parseTypeDecl() {
    this.next(); // 'type' or 'subtype'
    const name = this.expectIdent();
    this.expectKeyword("is");
    if (this.atKeyword("tagged") || this.atKeyword("abstract") || this.atKeyword("interface")) {
      const t = this.peek();
      throw new AdaError(`tagged types / inheritance ("${t.value}") are not supported by this mini-interpreter`, t.line, t.col);
    }
    if (this.atOp("(")) {
      this.next();
      const literals = [this.expectIdent()];
      while (this.atOp(",")) { this.next(); literals.push(this.expectIdent()); }
      this.expectOp(")");
      this.expectOp(";");
      return { kind: "type", name, def: { kind: "enum", literals } };
    }
    if (this.atKeyword("record")) {
      this.next();
      const fields = [];
      while (!this.atKeyword("end")) {
        const names = [this.expectIdent()];
        while (this.atOp(",")) { this.next(); names.push(this.expectIdent()); }
        this.expectOp(":");
        const ftype = this.expectIdent();
        this.expectOp(";");
        for (const nm of names) fields.push({ name: nm, type: ftype });
      }
      this.expectKeyword("end");
      this.expectKeyword("record");
      this.expectOp(";");
      return { kind: "type", name, def: { kind: "record", fields } };
    }
    if (this.atKeyword("array")) {
      this.next();
      this.expectOp("(");
      const low = this.parseExpr();
      this.expectOp("..");
      const high = this.parseExpr();
      this.expectOp(")");
      this.expectKeyword("of");
      const elemType = this.expectIdent();
      this.expectOp(";");
      return { kind: "type", name, def: { kind: "array", low, high, elemType } };
    }
    // subtype / derived-type fallback: "is [new] Base [range ...] [digits ...];" — we keep
    // just the base type name and treat it as a plain alias.
    if (this.atKeyword("new")) this.next();
    let base = "Integer";
    if (this.peek().type === "ident") base = this.peek().value;
    while (!this.atOp(";")) this.next();
    this.next();
    return { kind: "type", name, def: { kind: "alias", base } };
  }

  parseDeclarations() {
    const decls = [];
    while (!this.atKeyword("begin")) {
      if (this.atKeyword("procedure") || this.atKeyword("function")) {
        decls.push(this.parseSubprogram());
        continue;
      }
      if (this.atKeyword("type") || this.atKeyword("subtype")) {
        decls.push(this.parseTypeDecl());
        continue;
      }
      if (this.atKeyword("use")) {
        // A "use Package;" (or "use type T;") clause inside the declarative part, not
        // just at the top of the file — e.g. right after a generic package instantiation.
        // We don't scope names to packages at all, so this is parsed and discarded.
        this.next();
        if (this.atKeyword("type")) this.next();
        this.expectIdent();
        while (this.atOp(".")) { this.next(); this.expectIdent(); }
        this.expectOp(";");
        continue;
      }
      if (this.atKeyword("package")) {
        // Generic package instantiation, e.g.
        // "package Int_Vectors is new Ada.Containers.Vectors(Natural, Integer);" — we
        // don't model packages/generics for real, so this is parsed and discarded:
        // "Vector", Append/Element/etc are already universal builtins (see execCall/
        // evalExpr), so no registration is needed for the instantiation to work.
        this.next();
        this.expectIdent(); // package name
        this.expectKeyword("is");
        this.expectKeyword("new");
        this.expectIdent();
        while (this.atOp(".")) { this.next(); this.expectIdent(); }
        if (this.atOp("(")) {
          let depth = 0;
          do {
            const t = this.next();
            if (t.type === "op" && t.value === "(") depth++;
            else if (t.type === "op" && t.value === ")") depth--;
          } while (depth > 0);
        }
        this.expectOp(";");
        continue;
      }
      const names = [this.expectIdent()];
      while (this.atOp(",")) { this.next(); names.push(this.expectIdent()); }
      this.expectOp(":");
      let constant = false;
      if (this.atKeyword("constant")) { constant = true; this.next(); }
      let arrayType = null, typeName = null;
      if (this.atKeyword("array")) {
        this.next();
        this.expectOp("(");
        const low = this.parseExpr();
        this.expectOp("..");
        const high = this.parseExpr();
        this.expectOp(")");
        this.expectKeyword("of");
        const elemType = this.expectIdent();
        arrayType = { low, high, elemType };
      } else {
        typeName = this.expectIdent();
        // Discard package qualifiers on the type name ("Int_Vectors.Vector" -> "Vector") —
        // we don't scope types to packages, so only the last segment matters.
        while (this.atOp(".")) { this.next(); typeName = this.expectIdent(); }
      }
      let init = null;
      if (this.atOp(":=")) {
        this.next();
        init = this.looksLikeAggregate() ? this.parseAggregate() : this.parseExpr();
      }
      this.expectOp(";");
      for (const nm of names) decls.push({ kind: "var", name: nm, type: typeName, arrayType, init, constant });
    }
    return decls;
  }

  // Parses "(expr, expr, ...)" | "(others => expr)" | "(Name => expr, Name => expr, ...)"
  parseAggregate() {
    this.expectOp("(");
    if (this.atKeyword("others")) {
      this.next();
      this.expectOp("=>");
      const e = this.parseExpr();
      this.expectOp(")");
      return { others: e };
    }
    if (this.peek().type === "ident" && this.peek(1).type === "op" && this.peek(1).value === "=>") {
      const pairs = [];
      do {
        const name = this.expectIdent();
        this.expectOp("=>");
        pairs.push({ name, expr: this.parseExpr() });
      } while (this.atOp(",") ? (this.next(), true) : false);
      this.expectOp(")");
      return { pairs };
    }
    const items = [this.parseExpr()];
    while (this.atOp(",")) { this.next(); items.push(this.parseExpr()); }
    this.expectOp(")");
    return { items };
  }

  parseStatements(stopWords) {
    const stmts = [];
    while (true) {
      const t = this.peek();
      if (t.type === "ident" && stopWords.includes(t.value.toLowerCase())) break;
      if (t.type === "eof") break;
      stmts.push(this.parseStatement());
    }
    return stmts;
  }

  // One call argument: either positional ("Expr") or named ("Name => Expr", as in
  // `Put(Item => X, Fore => 1, Aft => 2, Exp => 0)`).
  parseCallArg() {
    if (this.peek().type === "ident" && this.peek(1).type === "op" && this.peek(1).value === "=>") {
      const name = this.expectIdent();
      this.expectOp("=>");
      return { name, expr: this.parseExpr() };
    }
    return { name: null, expr: this.parseExpr() };
  }

  parseStatement() {
    if (this.atKeyword("if")) return this.parseIf();
    if (this.atKeyword("for")) return this.parseFor();
    if (this.atKeyword("while")) return this.parseWhile();
    if (this.atKeyword("loop")) return this.parseBareLoop();
    if (this.atKeyword("case")) return this.parseCase();
    if (this.atKeyword("declare")) return this.parseDeclare();
    if (this.atKeyword("begin")) return this.parseBareBlock();
    if (this.atKeyword("null")) { this.next(); this.expectOp(";"); return { kind: "null" }; }
    if (this.atKeyword("return")) {
      const t = this.next();
      if (this.atOp(";")) { this.next(); return { kind: "return", expr: null, line: t.line, col: t.col }; }
      const expr = this.parseExpr();
      this.expectOp(";");
      return { kind: "return", expr, line: t.line, col: t.col };
    }
    if (this.atKeyword("raise")) {
      const t = this.next();
      const excName = this.expectIdent();
      let msg = null;
      if (this.atKeyword("with")) {
        this.next();
        const strTok = this.peek();
        if (strTok.type === "string") { this.next(); msg = strTok.value; }
      }
      this.expectOp(";");
      return { kind: "raise", excName, msg, line: t.line, col: t.col };
    }
    if (this.atKeyword("delay")) {
      const t = this.next();
      let until = false;
      if (this.atKeyword("until")) { this.next(); until = true; }
      const expr = this.parseExpr();
      this.expectOp(";");
      return { kind: "delay", until, expr, line: t.line, col: t.col };
    }
    if (this.atKeyword("exit")) {
      this.next();
      let cond = null;
      if (this.atKeyword("when")) { this.next(); cond = this.parseExpr(); }
      this.expectOp(";");
      return { kind: "exit", cond };
    }

    // assignment, field/index paths, or procedure calls
    const nameTok = this.peek();
    const name = this.expectIdent();

    if (this.atOp("(")) {
      this.next();
      const args = [];
      if (!this.atOp(")")) {
        args.push(this.parseCallArg());
        while (this.atOp(",")) { this.next(); args.push(this.parseCallArg()); }
      }
      this.expectOp(")");
      const path = [{ type: "index", args }];
      while (this.atOp(".")) { this.next(); path.push({ type: "field", field: this.expectIdent() }); }
      if (this.atOp(":=")) {
        this.next();
        const expr = this.parseRhsExpr();
        this.expectOp(";");
        return { kind: "pathassign", name, path, expr, line: nameTok.line, col: nameTok.col };
      }
      this.expectOp(";");
      if (path.length > 1) return { kind: "null" };
      return { kind: "call", name, args, line: nameTok.line, col: nameTok.col };
    }

    if (this.atOp(".")) {
      const path = [];
      while (this.atOp(".")) { this.next(); path.push({ type: "field", field: this.expectIdent() }); }
      if (this.atOp(":=")) {
        this.next();
        const expr = this.parseRhsExpr();
        this.expectOp(";");
        return { kind: "pathassign", name, path, expr, line: nameTok.line, col: nameTok.col };
      }
      // Could be a prefixed/OOP-style call ("V.Append(10);" == "Append(V, 10);", where V
      // is a real variable) or a fully package-qualified call ("Ada.Text_IO.Put_Line(x);",
      // where "Ada" isn't a variable at all — just a namespace we don't track). Which one
      // it is can't be told apart here (no symbol table during parsing), so both the
      // receiver and the plain-qualified-call args are kept and the decision is made at
      // runtime, in execStatement's "dotcall" case, based on whether `name` actually
      // resolves to a variable.
      const method = path[path.length - 1].field;
      const args = [];
      if (this.atOp("(")) {
        this.next();
        if (!this.atOp(")")) {
          args.push(this.parseCallArg());
          while (this.atOp(",")) { this.next(); args.push(this.parseCallArg()); }
        }
        this.expectOp(")");
      }
      this.expectOp(";");
      return { kind: "dotcall", name, path, method, args, line: nameTok.line, col: nameTok.col };
    }

    if (this.atOp(":=")) {
      this.next();
      const expr = this.parseRhsExpr();
      this.expectOp(";");
      return { kind: "assign", name, expr, line: nameTok.line, col: nameTok.col };
    }
    // bare call e.g. New_Line;
    this.expectOp(";");
    return { kind: "call", name, args: [], line: nameTok.line, col: nameTok.col };
  }

  // Right-hand side of an assignment: either a plain expression, or an
  // aggregate literal like "(X => 1, Y => 2)" / "(1, 2, 3)" whose shape is
  // only resolved at runtime against the assignment target's current value.
  parseRhsExpr() {
    if (this.looksLikeAggregate()) return { kind: "aggregate", agg: this.parseAggregate() };
    return this.parseExpr();
  }

  parseBareBlock() {
    this.next(); // begin
    const body = this.parseStatements(["exception", "end"]);
    let handlers = null;
    if (this.atKeyword("exception")) { this.next(); handlers = this.parseExceptionHandlers(); }
    this.expectKeyword("end");
    this.expectOp(";");
    return { kind: "declare", decls: [], body, handlers };
  }

  parseIf() {
    this.next(); // if
    const branches = [];
    const cond = this.parseExpr();
    this.expectKeyword("then");
    const thenStmts = this.parseStatements(["elsif", "else", "end"]);
    branches.push({ cond, body: thenStmts });
    while (this.atKeyword("elsif")) {
      this.next();
      const c = this.parseExpr();
      this.expectKeyword("then");
      const s = this.parseStatements(["elsif", "else", "end"]);
      branches.push({ cond: c, body: s });
    }
    let elseStmts = null;
    if (this.atKeyword("else")) {
      this.next();
      elseStmts = this.parseStatements(["end"]);
    }
    this.expectKeyword("end");
    this.expectKeyword("if");
    this.expectOp(";");
    return { kind: "if", branches, elseStmts };
  }

  parseCase() {
    const t = this.next(); // case
    const expr = this.parseExpr();
    this.expectKeyword("is");
    const whens = [];
    while (this.atKeyword("when")) {
      this.next();
      let isOthers = false;
      const choices = [];
      if (this.atKeyword("others")) { this.next(); isOthers = true; }
      else {
        do {
          const first = this.parseExpr();
          if (this.atOp("..")) { this.next(); const second = this.parseExpr(); choices.push({ from: first, to: second }); }
          else choices.push({ value: first });
        } while (this.atOp("|") ? (this.next(), true) : false);
      }
      this.expectOp("=>");
      const body = this.parseStatements(["when", "end"]);
      whens.push({ isOthers, choices, body });
    }
    this.expectKeyword("end");
    this.expectKeyword("case");
    this.expectOp(";");
    return { kind: "case", expr, whens, line: t.line, col: t.col };
  }

  parseDeclare() {
    this.next(); // declare
    const decls = this.parseDeclarations();
    this.expectKeyword("begin");
    const body = this.parseStatements(["exception", "end"]);
    let handlers = null;
    if (this.atKeyword("exception")) { this.next(); handlers = this.parseExceptionHandlers(); }
    this.expectKeyword("end");
    this.expectOp(";");
    return { kind: "declare", decls, body, handlers };
  }

  parseFor() {
    this.next(); // for
    const varName = this.expectIdent();
    if (this.atKeyword("of")) {
      // "for X of Container loop ... end loop;" — element iteration (Vector, array).
      this.next();
      const container = this.parseExpr();
      this.expectKeyword("loop");
      const body = this.parseStatements(["end"]);
      this.expectKeyword("end");
      this.expectKeyword("loop");
      this.expectOp(";");
      return { kind: "forof", varName, container, body };
    }
    this.expectKeyword("in");
    let reverse = false;
    if (this.atKeyword("reverse")) { reverse = true; this.next(); }
    const from = this.parseExpr();
    this.expectOp("..");
    const to = this.parseExpr();
    this.expectKeyword("loop");
    const body = this.parseStatements(["end"]);
    this.expectKeyword("end");
    this.expectKeyword("loop");
    this.expectOp(";");
    return { kind: "for", varName, from, to, reverse, body };
  }

  parseWhile() {
    this.next(); // while
    const cond = this.parseExpr();
    this.expectKeyword("loop");
    const body = this.parseStatements(["end"]);
    this.expectKeyword("end");
    this.expectKeyword("loop");
    this.expectOp(";");
    return { kind: "while", cond, body };
  }

  // Bare `loop ... end loop;` — an unconditional loop, terminated only by `exit`/`exit when`.
  parseBareLoop() {
    this.next(); // loop
    const body = this.parseStatements(["end"]);
    this.expectKeyword("end");
    this.expectKeyword("loop");
    this.expectOp(";");
    return { kind: "loop", body };
  }

  // expression parsing (precedence climbing)
  parseExpr() { return this.parseOr(); }
  parseOr() {
    let left = this.parseAnd();
    while (this.atKeyword("or") || this.atKeyword("xor")) {
      let op = this.next().value.toLowerCase();
      if (op === "or" && this.atKeyword("else")) { this.next(); op = "orelse"; }
      left = { kind: "bin", op, left, right: this.parseAnd() };
    }
    return left;
  }
  parseAnd() {
    let left = this.parseNot();
    while (this.atKeyword("and")) {
      this.next();
      let op = "and";
      if (this.atKeyword("then")) { this.next(); op = "andthen"; }
      left = { kind: "bin", op, left, right: this.parseNot() };
    }
    return left;
  }
  parseNot() {
    if (this.atKeyword("not")) { this.next(); return { kind: "not", expr: this.parseNot() }; }
    return this.parseCompare();
  }
  parseCompare() {
    let left = this.parseConcat();
    const cmpOps = ["=", "/=", "<", "<=", ">", ">="];
    if (this.peek().type === "op" && cmpOps.includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseConcat();
      return { kind: "bin", op, left, right };
    }
    return left;
  }
  parseConcat() {
    let left = this.parseAdd();
    while (this.atOp("&")) {
      this.next();
      left = { kind: "bin", op: "&", left, right: this.parseAdd() };
    }
    return left;
  }
  parseAdd() {
    let left = this.parseMul();
    while (this.peek().type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.next().value;
      left = { kind: "bin", op, left, right: this.parseMul() };
    }
    return left;
  }
  parseMul() {
    let left = this.parseUnary();
    while (
      (this.peek().type === "op" && (this.peek().value === "*" || this.peek().value === "/")) ||
      this.atKeyword("mod") || this.atKeyword("rem")
    ) {
      const opTok = this.peek();
      const op = this.next().value.toLowerCase();
      left = { kind: "bin", op, left, right: this.parseUnary(), line: opTok.line, col: opTok.col };
    }
    return left;
  }
  parseUnary() {
    if (this.peek().type === "op" && (this.peek().value === "-" || this.peek().value === "+")) {
      const op = this.next().value;
      return { kind: "unary", op, expr: this.parseUnary() };
    }
    if (this.atKeyword("abs")) { this.next(); return { kind: "unary", op: "abs", expr: this.parseUnary() }; }
    return this.parsePow();
  }
  parsePow() {
    let left = this.parsePostfix();
    if (this.atOp("**")) {
      this.next();
      return { kind: "bin", op: "**", left, right: this.parseUnary() };
    }
    return left;
  }
  parsePostfix() {
    let expr = this.parsePrimary();
    while (true) {
      if (this.peek().type === "attr") {
        const attr = this.next().value;
        if (this.atOp("(")) {
          this.next();
          const args = [];
          if (!this.atOp(")")) {
            args.push(this.parseCallArg());
            while (this.atOp(",")) { this.next(); args.push(this.parseCallArg()); }
          }
          this.expectOp(")");
          expr = { kind: "attrcall", expr, attr, args };
        } else {
          expr = { kind: "attr", expr, attr };
        }
        continue;
      }
      if (this.atOp(".")) {
        this.next();
        const field = this.expectIdent();
        expr = { kind: "field", expr, field };
        continue;
      }
      break;
    }
    return expr;
  }
  parsePrimary() {
    const t = this.peek();
    if (t.type === "number") { this.next(); return { kind: "lit", value: parseFloat(t.value), isFloat: /[.eE]/.test(t.value) }; }
    if (t.type === "string") { this.next(); return { kind: "lit", value: t.value, isString: true }; }
    if (t.type === "char") { this.next(); return { kind: "lit", value: t.value, isChar: true }; }
    if (this.atKeyword("true")) { this.next(); return { kind: "lit", value: true }; }
    if (this.atKeyword("false")) { this.next(); return { kind: "lit", value: false }; }
    if (t.type === "op" && t.value === "(") {
      this.next();
      const e = this.parseExpr();
      this.expectOp(")");
      return e;
    }
    if (t.type === "ident") {
      const name = this.next().value;
      if (this.atOp("(")) {
        this.next();
        const args = [];
        if (!this.atOp(")")) {
          args.push(this.parseCallArg());
          while (this.atOp(",")) { this.next(); args.push(this.parseCallArg()); }
        }
        this.expectOp(")");
        return { kind: "funcall", name, args, line: t.line, col: t.col };
      }
      return { kind: "var", name, line: t.line, col: t.col };
    }
    throw new AdaError(`unexpected token "${t.value}"`, t.line, t.col);
  }
}

// A lexical scope: variables, locally-declared subprograms and types, chained
// to a parent. Ada identifiers are case-insensitive, so all keys are lower-cased.
class Env {
  constructor(parent) {
    this.vars = new Map();
    this.subs = new Map();
    this.types = new Map();
    this.parent = parent;
  }
  setVarEntry(name, entry) { this.vars.set(name.toLowerCase(), entry); }
  defineSub(name, sub) { this.subs.set(name.toLowerCase(), sub); }
  setTypeDef(name, def) { this.types.set(name.toLowerCase(), def); }
  findVarEnv(name) {
    const key = name.toLowerCase();
    let e = this;
    while (e) { if (e.vars.has(key)) return e; e = e.parent; }
    return null;
  }
  getVarEntry(name) {
    const env = this.findVarEnv(name);
    return env ? env.vars.get(name.toLowerCase()) : undefined;
  }
  getSub(name) {
    const key = name.toLowerCase();
    let e = this;
    while (e) { if (e.subs.has(key)) return e.subs.get(key); e = e.parent; }
    return undefined;
  }
  getType(name) {
    const key = name.toLowerCase();
    let e = this;
    while (e) { if (e.types.has(key)) return e.types.get(key); e = e.parent; }
    return undefined;
  }
}

const SCALAR_BOUNDS = {
  integer: [-2147483648, 2147483647],
  natural: [0, 2147483647],
  positive: [1, 2147483647],
  long_integer: [-(2 ** 63), 2 ** 63 - 1],
  short_integer: [-32768, 32767],
  float: [-1e300, 1e300],
  boolean: [false, true],
};

// Ada.Numerics.Elementary_Functions, the handful that come up in student programs.
const MATH_FUNCTIONS = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  arctan: Math.atan,
  log: (x, base) => (base == null ? Math.log(x) : Math.log(x) / Math.log(base)),
  exp: Math.exp,
};

// Ada.Real_Time: Time and Time_Span are both represented as plain milliseconds
// (Clock, above in evalExpr's "var" case, returns Date.now()), so these conversions
// just scale into that same unit.
const TIME_FUNCTIONS = {
  milliseconds: (n) => n,
  seconds: (n) => n * 1000,
  minutes: (n) => n * 60000,
};

// Ada.Characters.Handling / Ada.Strings.Fixed / Ada.Strings.Unbounded. Unbounded_String
// is just a plain JS string here (same representation as String), so To_Unbounded_String
// and To_String are identity — there's nothing to convert.
const STRING_FUNCTIONS = {
  to_upper: (s) => String(s).toUpperCase(),
  to_lower: (s) => String(s).toLowerCase(),
  to_unbounded_string: (s) => String(s),
  to_string: (s) => String(s),
  index: (s, pat) => { const i = String(s).indexOf(String(pat)); return i === -1 ? 0 : i + 1; },
};

class Interpreter {
  constructor(onOutput) {
    this.onOutput = onOutput || (() => {});
    this.line = "";
    this.stepCount = 0;
  }

  // `onNeedInput` is called (and awaited) whenever the program executes Get/Get_Line;
  // it must resolve with the raw line of text the "user" typed at the terminal.
  async run(source, onNeedInput) {
    const tokens = new Lexer(source).tokens;
    const program = new Parser(tokens).parseProgram();
    const rootEnv = new Env(null);
    this.declareBlock(program.decls, rootEnv);
    try {
      await driveGenerator(this.execStatements(program.body, rootEnv), onNeedInput);
    } catch (err) {
      if (err instanceof AdaError && program.handlers && await driveGenerator(this.tryHandle(err, program.handlers, rootEnv), onNeedInput)) {
        // handled
      } else {
        this.flushLine();
        throw err;
      }
    }
    this.flushLine();
    return program.name;
  }

  bump() {
    if (++this.stepCount > 5_000_000) {
      throw new AdaError("raised PROGRAM_ERROR : possible infinite loop (exceeded step limit)");
    }
  }

  declareBlock(decls, env) {
    for (const d of decls) {
      if (d.kind === "procedure" || d.kind === "function") {
        env.defineSub(d.name, { ...d, closureEnv: env });
        continue;
      }
      if (d.kind === "type") {
        this.declareType(d, env);
        continue;
      }
      if (d.arrayType) {
        const value = d.init ? this.buildArrayFromAggregate(d.arrayType, d.init, env) : this.defaultArray(d.arrayType, env);
        env.setVarEntry(d.name, { type: "array", value, constant: d.constant });
        continue;
      }
      const typeDef = env.getType(d.type);
      let value;
      if (typeDef) {
        value = d.init != null ? this.evalInitForType(typeDef, d.init, env) : this.defaultForType(typeDef, env);
      } else {
        value = d.init != null ? this.evalExpr(d.init, env) : this.defaultValue(d.type);
      }
      env.setVarEntry(d.name, { type: d.type, value, constant: d.constant });
    }
  }

  declareType(d, env) {
    if (d.def.kind === "enum") {
      const literalValues = d.def.literals.map((lit, i) => new AdaEnum(d.name, lit, i));
      env.setTypeDef(d.name, { kind: "enum", literals: d.def.literals, literalValues });
      literalValues.forEach(lv => env.setVarEntry(lv.name, { type: d.name, value: lv, constant: true }));
    } else if (d.def.kind === "record") {
      env.setTypeDef(d.name, { kind: "record", fields: d.def.fields });
    } else if (d.def.kind === "array") {
      env.setTypeDef(d.name, { kind: "array", low: d.def.low, high: d.def.high, elemType: d.def.elemType });
    } else {
      env.setTypeDef(d.name, { kind: "alias", base: d.def.base });
    }
  }

  defaultForType(typeDef, env) {
    if (typeDef.kind === "enum") return typeDef.literalValues[0];
    if (typeDef.kind === "record") return this.defaultRecord(typeDef, env);
    if (typeDef.kind === "array") return this.defaultArray(typeDef, env);
    if (typeDef.kind === "alias") return this.defaultValue(typeDef.base);
    return null;
  }

  evalInitForType(typeDef, init, env) {
    const isAggregate = init && init.kind === undefined && (init.pairs || init.items || init.others !== undefined);
    if (typeDef.kind === "record" && isAggregate) return this.buildRecordFromAggregate(typeDef, init, env);
    if (typeDef.kind === "array" && isAggregate) return this.buildArrayFromAggregate(typeDef, init, env);
    return this.evalExpr(init, env);
  }

  defaultRecord(typeDef, env) {
    const rec = new AdaRecord(typeDef.fields);
    typeDef.fields.forEach(f => {
      const fieldTypeDef = env.getType(f.type);
      rec.set(f.name, fieldTypeDef ? this.defaultForType(fieldTypeDef, env) : this.defaultValue(f.type));
    });
    return rec;
  }

  buildRecordFromAggregate(typeDef, aggregate, env) {
    const rec = new AdaRecord(typeDef.fields);
    if (aggregate.pairs) {
      for (const p of aggregate.pairs) rec.set(p.name, this.evalExpr(p.expr, env));
      typeDef.fields.forEach(f => {
        if (!rec.values.has(f.name.toLowerCase())) rec.set(f.name, this.defaultValue(f.type));
      });
    } else if (aggregate.items) {
      typeDef.fields.forEach((f, i) => rec.set(f.name, this.evalExpr(aggregate.items[i], env)));
    }
    return rec;
  }

  defaultValue(type) {
    const t = (type || "").toLowerCase();
    if (["integer", "natural", "positive", "long_integer", "short_integer"].includes(t)) return 0;
    if (t === "float") return 0.0;
    if (t === "boolean") return false;
    if (t === "string" || t === "unbounded_string") return "";
    if (t === "character") return " ";
    if (t === "vector") return new AdaVector();
    return null;
  }

  defaultArray(arrayType, env) {
    const low = this.evalExpr(arrayType.low, env);
    const high = this.evalExpr(arrayType.high, env);
    const n = Math.max(0, high - low + 1);
    const elemTypeDef = env.getType(arrayType.elemType);
    const fill = elemTypeDef ? this.defaultForType(elemTypeDef, env) : this.defaultValue(arrayType.elemType);
    return new AdaArray(low, high, new Array(n).fill(fill));
  }

  buildArrayFromAggregate(arrayType, aggregate, env) {
    const low = this.evalExpr(arrayType.low, env);
    const high = this.evalExpr(arrayType.high, env);
    const n = Math.max(0, high - low + 1);
    let items;
    if (aggregate.others !== undefined) {
      const v = this.evalExpr(aggregate.others, env);
      items = new Array(n).fill(v);
    } else {
      items = (aggregate.items || []).map(e => this.evalExpr(e, env));
    }
    return new AdaArray(low, high, items);
  }

  flushLine() {
    if (this.line.length) {
      this.onOutput(this.line);
      this.line = "";
    }
  }

  *execStatements(stmts, env) {
    for (const s of stmts) yield* this.execStatement(s, env);
  }

  *tryHandle(err, handlers, env) {
    const excName = (err.message.match(/raised\s+(\S+)/i)?.[1] || "").replace(/[:.]$/, "").toUpperCase();
    for (const h of handlers) {
      if (h.names.includes("others") || h.names.some(n => n.toUpperCase() === excName)) {
        yield* this.execStatements(h.body, env);
        return true;
      }
    }
    return false;
  }

  // Walks one path segment (array index or record field) and returns the
  // value it points to; used for the non-final hops of a pathassign target.
  stepInto(value, seg, env, line, col) {
    if (seg.type === "index") {
      if (value instanceof AdaArray) {
        const idx = this.evalExpr(seg.args[0].expr, env);
        if (idx < value.low || idx > value.high) throw new AdaError(`raised CONSTRAINT_ERROR : index check failed`, line, col);
        return value.items[idx - value.low];
      }
      if (typeof value === "string") {
        const idx = this.evalExpr(seg.args[0].expr, env);
        if (idx < 1 || idx > value.length) throw new AdaError(`raised CONSTRAINT_ERROR : index check failed`, line, col);
        return value[idx - 1];
      }
      throw new AdaError(`cannot index this value`, line, col);
    }
    if (!(value instanceof AdaRecord)) throw new AdaError(`"${seg.field}" is not a field of this value`, line, col);
    return value.get(seg.field);
  }

  // Resolves an aggregate literal ("(X => 1, Y => 2)" / "(1, 2, 3)" / "(others => 0)")
  // against the shape of the value currently sitting at the assignment target.
  resolveAggregate(agg, currentValue, env) {
    if (currentValue instanceof AdaRecord) {
      const rec = new AdaRecord(currentValue.fieldOrder.map(n => ({ name: n })));
      currentValue.values.forEach((v, k) => rec.values.set(k, v));
      if (agg.pairs) agg.pairs.forEach(p => rec.set(p.name, this.evalExpr(p.expr, env)));
      else if (agg.items) currentValue.fieldOrder.forEach((n, i) => { if (agg.items[i] !== undefined) rec.set(n, this.evalExpr(agg.items[i], env)); });
      else if (agg.others !== undefined) { const v = this.evalExpr(agg.others, env); currentValue.fieldOrder.forEach(n => rec.set(n, v)); }
      return rec;
    }
    if (currentValue instanceof AdaArray) {
      const n = currentValue.high - currentValue.low + 1;
      let items;
      if (agg.others !== undefined) { const v = this.evalExpr(agg.others, env); items = new Array(n).fill(v); }
      else items = (agg.items || []).map(e => this.evalExpr(e, env));
      return new AdaArray(currentValue.low, currentValue.high, items);
    }
    throw new AdaError(`cannot use an aggregate here`);
  }

  *execStatement(s, env) {
    this.bump();
    switch (s.kind) {
      case "null": return;
      case "assign": {
        const entry = env.getVarEntry(s.name);
        if (!entry) throw new AdaError(`"${s.name}" is undefined`, s.line, s.col);
        if (entry.constant) throw new AdaError(`left hand side of assignment must not be constant`, s.line, s.col);
        entry.value = s.expr.kind === "aggregate"
          ? this.resolveAggregate(s.expr.agg, entry.value, env)
          : this.evalExpr(s.expr, env);
        return;
      }
      case "pathassign": {
        const entry = env.getVarEntry(s.name);
        if (!entry) throw new AdaError(`"${s.name}" is undefined`, s.line, s.col);
        if (entry.constant) throw new AdaError(`left hand side of assignment must not be constant`, s.line, s.col);
        let current = entry.value;
        for (let i = 0; i < s.path.length - 1; i++) current = this.stepInto(current, s.path[i], env, s.line, s.col);
        const last = s.path[s.path.length - 1];
        if (last.type === "index") {
          if (!(current instanceof AdaArray)) throw new AdaError(`cannot index this value`, s.line, s.col);
          const idx = this.evalExpr(last.args[0].expr, env);
          if (idx < current.low || idx > current.high) throw new AdaError(`raised CONSTRAINT_ERROR : index check failed`, s.line, s.col);
          const targetCurrent = current.items[idx - current.low];
          current.items[idx - current.low] = s.expr.kind === "aggregate"
            ? this.resolveAggregate(s.expr.agg, targetCurrent, env)
            : this.evalExpr(s.expr, env);
        } else {
          if (!(current instanceof AdaRecord)) throw new AdaError(`"${last.field}" is not a field of this value`, s.line, s.col);
          const targetCurrent = current.get(last.field);
          current.set(last.field, s.expr.kind === "aggregate"
            ? this.resolveAggregate(s.expr.agg, targetCurrent, env)
            : this.evalExpr(s.expr, env));
        }
        return;
      }
      case "call":
        yield* this.execCall(s.name, s.args, env, s.line, s.col);
        return;
      case "dotcall": {
        if (env.getVarEntry(s.name)) {
          // OOP-style call on a real value: "V.Append(10)" -> "Append(V, 10)"
          const receiver = s.path.slice(0, -1).reduce(
            (e, seg) => ({ kind: "field", expr: e, field: seg.field }),
            { kind: "var", name: s.name, line: s.line, col: s.col }
          );
          yield* this.execCall(s.method, [{ name: null, expr: receiver }, ...s.args], env, s.line, s.col);
        } else {
          // Fully package-qualified call, e.g. "Ada.Text_IO.Put_Line(x)" — "Ada"/"Text_IO"
          // aren't variables we track, so just call the last segment directly.
          yield* this.execCall(s.method, s.args, env, s.line, s.col);
        }
        return;
      }
      case "if": {
        for (const b of s.branches) {
          if (this.evalExpr(b.cond, env) === true) { yield* this.execStatements(b.body, env); return; }
        }
        if (s.elseStmts) yield* this.execStatements(s.elseStmts, env);
        return;
      }
      case "case": {
        const val = this.evalExpr(s.expr, env);
        let othersBranch = null;
        for (const w of s.whens) {
          if (w.isOthers) { othersBranch = w; continue; }
          const hit = w.choices.some(c =>
            c.value !== undefined
              ? valuesEqual(this.evalExpr(c.value, env), val)
              : ordinalOf(val) >= ordinalOf(this.evalExpr(c.from, env)) && ordinalOf(val) <= ordinalOf(this.evalExpr(c.to, env))
          );
          if (hit) { yield* this.execStatements(w.body, env); return; }
        }
        if (othersBranch) { yield* this.execStatements(othersBranch.body, env); return; }
        throw new AdaError(`raised CONSTRAINT_ERROR : case selector out of range`, s.line, s.col);
      }
      case "declare": {
        const childEnv = new Env(env);
        this.declareBlock(s.decls, childEnv);
        try {
          yield* this.execStatements(s.body, childEnv);
        } catch (err) {
          if (err instanceof AdaError && s.handlers && (yield* this.tryHandle(err, s.handlers, childEnv))) return;
          throw err;
        }
        return;
      }
      case "for": {
        const from = this.evalExpr(s.from, env);
        const to = this.evalExpr(s.to, env);
        const prevEntry = env.vars.get(s.varName.toLowerCase());
        env.setVarEntry(s.varName, { type: "Integer", value: from, constant: false });
        const entry = env.vars.get(s.varName.toLowerCase());
        try {
          if (s.reverse) {
            for (let i = to; i >= from; i--) { entry.value = i; yield* this.execStatements(s.body, env); }
          } else {
            for (let i = from; i <= to; i++) { entry.value = i; yield* this.execStatements(s.body, env); }
          }
        } catch (err) {
          if (!(err instanceof LoopExitSignal)) throw err;
        }
        if (prevEntry) env.vars.set(s.varName.toLowerCase(), prevEntry); else env.vars.delete(s.varName.toLowerCase());
        return;
      }
      case "forof": {
        const container = this.evalExpr(s.container, env);
        const items = container instanceof AdaVector ? container.items
          : container instanceof AdaArray ? container.items
          : typeof container === "string" ? [...container]
          : (() => { throw new AdaError(`cannot iterate "for ... of" over this value`, s.line, s.col); })();
        const prevEntry = env.vars.get(s.varName.toLowerCase());
        env.setVarEntry(s.varName, { type: null, value: undefined, constant: false });
        const entry = env.vars.get(s.varName.toLowerCase());
        try {
          for (const item of items) { entry.value = item; yield* this.execStatements(s.body, env); }
        } catch (err) {
          if (!(err instanceof LoopExitSignal)) throw err;
        }
        if (prevEntry) env.vars.set(s.varName.toLowerCase(), prevEntry); else env.vars.delete(s.varName.toLowerCase());
        return;
      }
      case "while": {
        try {
          while (this.evalExpr(s.cond, env) === true) {
            yield* this.execStatements(s.body, env);
            this.bump();
          }
        } catch (err) {
          if (!(err instanceof LoopExitSignal)) throw err;
        }
        return;
      }
      case "loop": {
        try {
          for (;;) {
            yield* this.execStatements(s.body, env);
            this.bump();
          }
        } catch (err) {
          if (!(err instanceof LoopExitSignal)) throw err;
        }
        return;
      }
      case "return":
        throw new ReturnSignal(s.expr != null ? this.evalExpr(s.expr, env) : undefined);
      case "raise": {
        const detail = s.msg ? ` : ${s.msg}` : "";
        throw new AdaError(`raised ${s.excName.toUpperCase()}${detail}`, s.line, s.col);
      }
      case "exit": {
        if (s.cond == null || this.evalExpr(s.cond, env) === true) throw new LoopExitSignal();
        return;
      }
      case "delay": {
        const target = this.evalExpr(s.expr, env);
        // `delay until T;` (Ada.Real_Time.Time, ms since epoch, matching Clock below) vs
        // plain `delay D;` (a Duration in seconds, per RM 9.6).
        const ms = s.until ? target - Date.now() : target * 1000;
        yield { __delayRequest: true, ms: Math.max(0, ms) };
        return;
      }
      default:
        throw new AdaError(`unsupported statement: ${s.kind}`);
    }
  }

  *execCall(name, args, env, line, col) {
    const lname = name.toLowerCase();
    if (lname === "put_line") {
      const [item] = resolveArgs(["Item"], args);
      this.flushLine();
      this.onOutput(this.stringify(this.evalExpr(item, env)));
      return;
    }
    if (lname === "put") {
      // Ada.Text_IO.Put(Item) and the Ada.Float_Text_IO/Integer_Text_IO formatted
      // Put(Item, Fore, Aft, Exp) share a name in real Ada via overloading; here we
      // just switch on whether Fore/Aft/Exp were actually supplied.
      const [item, fore, aft, exp] = resolveArgs(["Item", "Fore", "Aft", "Exp"], args);
      const v = this.evalExpr(item, env);
      if (fore !== undefined || aft !== undefined || exp !== undefined) {
        this.line += formatAdaFloat(
          v,
          fore !== undefined ? this.evalExpr(fore, env) : 2,
          aft !== undefined ? this.evalExpr(aft, env) : 2,
          exp !== undefined ? this.evalExpr(exp, env) : 3
        );
      } else {
        this.line += this.stringify(v);
      }
      return;
    }
    if (lname === "new_line") {
      this.flushLine();
      this.onOutput("");
      return;
    }
    if (lname === "flush") {
      this.flushLine(); // our terminal streams output live, so there's nothing else to flush
      return;
    }
    if (lname === "skip_line") {
      return; // no-op: Get() here always consumes one full line already
    }
    if (lname === "get" || lname === "get_line") {
      const [itemArg] = resolveArgs(["Item"], args);
      if (!itemArg || itemArg.kind !== "var") {
        throw new AdaError(`Get/Get_Line here only supports a plain variable argument`, line, col);
      }
      const entry = env.getVarEntry(itemArg.name);
      if (!entry) throw new AdaError(`"${itemArg.name}" is undefined`, line, col);
      if (entry.constant) throw new AdaError(`left hand side of assignment must not be constant`, line, col);
      this.flushLine(); // show any prompt text already Put() on this line before waiting on stdin
      const raw = (yield { __inputRequest: true }).trim();
      if (lname === "get_line") {
        entry.value = raw;
      } else if (typeof entry.value === "boolean") {
        entry.value = /^true$/i.test(raw);
      } else if (typeof entry.value === "number") {
        const n = Number(raw);
        if (raw === "" || Number.isNaN(n)) throw new AdaError(`raised DATA_ERROR`, line, col);
        entry.value = n;
      } else {
        entry.value = raw;
      }
      return;
    }
    // Ada.Containers.Vectors procedures (mutate the Vector object in place — it's a
    // reference type here, so no out-parameter machinery is needed) and
    // Ada.Strings.Unbounded.Append (Source is a plain var holding a string, so we
    // write back through its Env entry the same way Get/Get_Line do above).
    if (lname === "append" && args.length >= 2) {
      const recvExpr = args[0].expr;
      const recv = recvExpr && this.evalExpr(recvExpr, env);
      if (recv instanceof AdaVector) { recv.items.push(this.evalExpr(args[1].expr, env)); return; }
      if (recvExpr && recvExpr.kind === "var" && typeof recv === "string") {
        const entry = env.getVarEntry(recvExpr.name);
        entry.value = recv + this.stringify(this.evalExpr(args[1].expr, env));
        return;
      }
    }
    if (lname === "clear" && args.length) {
      const recv = this.evalExpr(args[0].expr, env);
      if (recv instanceof AdaVector) { recv.items.length = 0; return; }
    }
    if (lname === "delete_last" && args.length) {
      const recv = this.evalExpr(args[0].expr, env);
      if (recv instanceof AdaVector) { recv.items.pop(); return; }
    }
    const sub = env.getSub(name);
    if (sub) { yield* this.callSub(sub, args, env); return; }
    throw new AdaError(`"${name}" is undefined`, line, col);
  }

  *callSub(sub, args, callerEnv) {
    const argExprs = resolveArgs(sub.params.map(p => p.name), args);
    if (argExprs.some(a => a === undefined)) {
      throw new AdaError(`wrong number of arguments to "${sub.name}"`);
    }
    const newEnv = new Env(sub.closureEnv);
    sub.params.forEach((p, i) => {
      const val = this.evalExpr(argExprs[i], callerEnv);
      newEnv.setVarEntry(p.name, { type: p.type, value: val, constant: false });
    });
    this.declareBlock(sub.decls, newEnv);

    let result, returned = false;
    try {
      yield* this.execStatements(sub.body, newEnv);
    } catch (err) {
      if (err instanceof ReturnSignal) {
        result = err.value; returned = true;
      } else if (err instanceof AdaError && sub.handlers) {
        try {
          if (!(yield* this.tryHandle(err, sub.handlers, newEnv))) throw err;
        } catch (err2) {
          if (err2 instanceof ReturnSignal) { result = err2.value; returned = true; }
          else throw err2;
        }
      } else {
        throw err;
      }
    }

    sub.params.forEach((p, i) => {
      if ((p.mode === "out" || p.mode === "inout") && argExprs[i].kind === "var") {
        const callerEntry = callerEnv.getVarEntry(argExprs[i].name);
        if (callerEntry) callerEntry.value = newEnv.vars.get(p.name.toLowerCase()).value;
      }
    });

    if (sub.kind === "function" && !returned) {
      throw new AdaError(`raised PROGRAM_ERROR : function "${sub.name}" fell off the end without a return statement`);
    }
    return result;
  }

  stringify(v) {
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "number") return String(v);
    if (v instanceof AdaEnum) return v.name;
    if (v instanceof AdaArray) return `(${v.items.map(x => this.stringify(x)).join(", ")})`;
    if (v instanceof AdaRecord) return `(${v.fieldOrder.map(n => `${n} => ${this.stringify(v.get(n))}`).join(", ")})`;
    return String(v);
  }

  imageOf(v) {
    if (typeof v === "number") return v >= 0 ? ` ${v}` : String(v);
    return this.stringify(v);
  }

  // Handles Integer'First / Boolean'Last / MyEnum'First-style type attributes,
  // used on a bare (undeclared-as-a-variable) type name.
  typeAttrOf(typeNameExpr, attr, env) {
    if (typeNameExpr.kind !== "var" || env.findVarEnv(typeNameExpr.name)) return undefined;
    const tname = typeNameExpr.name.toLowerCase();
    if (SCALAR_BOUNDS[tname]) {
      const [lo, hi] = SCALAR_BOUNDS[tname];
      if (attr === "First") return lo;
      if (attr === "Last") return hi;
    }
    const typeDef = env.getType(typeNameExpr.name);
    if (typeDef && typeDef.kind === "enum") {
      if (attr === "First") return typeDef.literalValues[0];
      if (attr === "Last") return typeDef.literalValues[typeDef.literalValues.length - 1];
    }
    return undefined;
  }

  evalExpr(e, env) {
    switch (e.kind) {
      case "lit": return e.value;
      case "var": {
        const entry = env.getVarEntry(e.name);
        if (entry) return entry.value;
        // Ada.Real_Time.Clock is a parameterless function, callable bare (no "()")
        if (e.name.toLowerCase() === "clock") return Date.now();
        throw new AdaError(`"${e.name}" is undefined`, e.line, e.col);
      }
      case "field": {
        const v = this.evalExpr(e.expr, env);
        if (!(v instanceof AdaRecord)) throw new AdaError(`"${e.field}" is not a field of this value`);
        return v.get(e.field);
      }
      case "unary": {
        const v = this.evalExpr(e.expr, env);
        if (e.op === "-") return -v;
        if (e.op === "abs") return Math.abs(v);
        return v;
      }
      case "not": return !this.evalExpr(e.expr, env);
      case "attr": {
        if (["First", "Last"].includes(e.attr)) {
          const typeAttr = this.typeAttrOf(e.expr, e.attr, env);
          if (typeAttr !== undefined) return typeAttr;
        }
        const v = this.evalExpr(e.expr, env);
        if (v instanceof AdaArray) {
          if (e.attr === "First") return v.low;
          if (e.attr === "Last") return v.high;
          if (e.attr === "Length") return v.high - v.low + 1;
        }
        if (typeof v === "string" && e.attr === "Length") return v.length;
        if (e.attr === "Image") return this.imageOf(v);
        if (e.attr === "Round" && typeof v === "number") return adaRound(v);
        if (e.attr === "Truncation" && typeof v === "number") return Math.trunc(v);
        if (e.attr === "Succ" || e.attr === "Pred") {
          const delta = e.attr === "Succ" ? 1 : -1;
          if (v instanceof AdaEnum) {
            const typeDef = env.getType(v.typeName);
            const next = typeDef && typeDef.literalValues[v.ordinal + delta];
            if (!next) throw new AdaError(`raised CONSTRAINT_ERROR`, e.line, e.col);
            return next;
          }
          if (typeof v === "number") return v + delta;
        }
        return v;
      }
      case "attrcall": {
        const argv = e.args.map(a => this.evalExpr(a.expr, env));
        if (e.attr === "Min") return Math.min(argv[0], argv[1]);
        if (e.attr === "Max") return Math.max(argv[0], argv[1]);
        if (e.attr === "Succ" || e.attr === "Pred") {
          const delta = e.attr === "Succ" ? 1 : -1;
          const val = argv[0];
          if (val instanceof AdaEnum) {
            const typeDef = env.getType(val.typeName);
            const next = typeDef && typeDef.literalValues[val.ordinal + delta];
            if (!next) throw new AdaError(`raised CONSTRAINT_ERROR`, e.line, e.col);
            return next;
          }
          return val + delta;
        }
        if (e.attr === "Val") {
          const typeDef = e.expr.kind === "var" ? env.getType(e.expr.name) : null;
          if (typeDef && typeDef.kind === "enum") return typeDef.literalValues[argv[0]];
        }
        const v = argv.length ? argv[0] : this.evalExpr(e.expr, env);
        if (e.attr === "Image") return this.imageOf(v);
        if (e.attr === "Value") return typeof v === "string" ? parseFloat(v) : v;
        if (e.attr === "Pos") return v instanceof AdaEnum ? v.ordinal : v;
        return v;
      }
      case "funcall": {
        const lname = e.name.toLowerCase();
        const entry = env.getVarEntry(e.name);
        if (entry && e.args.length === 1) {
          if (entry.value instanceof AdaArray) {
            const idx = this.evalExpr(e.args[0].expr, env);
            if (idx < entry.value.low || idx > entry.value.high) {
              throw new AdaError(`raised CONSTRAINT_ERROR : index check failed`, e.line, e.col);
            }
            return entry.value.items[idx - entry.value.low];
          }
          if (entry.value instanceof AdaVector) {
            const idx = this.evalExpr(e.args[0].expr, env); // 0-based, matching Index_Type => Natural
            if (idx < 0 || idx >= entry.value.items.length) {
              throw new AdaError(`raised CONSTRAINT_ERROR : index check failed`, e.line, e.col);
            }
            return entry.value.items[idx];
          }
          if (typeof entry.value === "string") {
            const idx = this.evalExpr(e.args[0].expr, env);
            if (idx < 1 || idx > entry.value.length) {
              throw new AdaError(`raised CONSTRAINT_ERROR : index check failed`, e.line, e.col);
            }
            return entry.value[idx - 1];
          }
        }
        const sub = env.getSub(e.name);
        if (sub) {
          if (sub.kind !== "function") throw new AdaError(`"${e.name}" is not a function`, e.line, e.col);
          // evalExpr is synchronous, so a function used inside an expression can't pause for Get/Get_Line
          return runGenSync(this.callSub(sub, e.args, env), e.line, e.col);
        }
        if (["integer", "natural", "positive", "long_integer", "short_integer"].includes(lname)) {
          if (!e.args.length) return 0;
          const v = this.evalExpr(e.args[0].expr, env);
          return typeof v === "number" ? adaRound(v) : v; // Integer(3.7) rounds to 4, per RM 4.6
        }
        if (lname === "float" || lname === "long_float") {
          return e.args.length ? this.evalExpr(e.args[0].expr, env) : 0.0;
        }
        // Ada.Containers.Vectors functions — dispatch on the runtime value so "Length"
        // works uniformly for both a Vector and a String (Ada.Strings has Length too).
        if (["element", "first_element", "last_element", "length", "is_empty", "first_index", "last_index"].includes(lname) && e.args.length) {
          const v = this.evalExpr(e.args[0].expr, env);
          if (v instanceof AdaVector) {
            if (lname === "element") return v.items[this.evalExpr(e.args[1].expr, env)];
            if (lname === "first_element") return v.items[0];
            if (lname === "last_element") return v.items[v.items.length - 1];
            if (lname === "length") return v.items.length;
            if (lname === "is_empty") return v.items.length === 0;
            if (lname === "first_index") return 0;
            if (lname === "last_index") return v.items.length - 1;
          }
          if (typeof v === "string" && lname === "length") return v.length;
        }
        if (lname === "trim" && e.args.length) {
          // the (optional) 2nd arg is normally Ada.Strings.Left/Right/Both — we always
          // trim both ends, and deliberately never evaluate that arg (it's rarely declared
          // in student programs, and we don't need its value anyway).
          return String(this.evalExpr(e.args[0].expr, env)).trim();
        }
        if (STRING_FUNCTIONS[lname]) {
          const argv = e.args.map(a => this.evalExpr(a.expr, env));
          return STRING_FUNCTIONS[lname](...argv);
        }
        if (MATH_FUNCTIONS[lname]) {
          const argv = e.args.map(a => this.evalExpr(a.expr, env));
          return MATH_FUNCTIONS[lname](...argv);
        }
        if (TIME_FUNCTIONS[lname]) {
          const argv = e.args.map(a => this.evalExpr(a.expr, env));
          return TIME_FUNCTIONS[lname](...argv);
        }
        throw new AdaError(`"${e.name}" is undefined`, e.line, e.col);
      }
      case "bin": {
        if (e.op === "andthen") return this.evalExpr(e.left, env) === true && this.evalExpr(e.right, env) === true;
        if (e.op === "orelse") return this.evalExpr(e.left, env) === true || this.evalExpr(e.right, env) === true;
        const l = this.evalExpr(e.left, env);
        const r = this.evalExpr(e.right, env);
        if (["/", "mod", "rem"].includes(e.op) && r === 0) {
          throw new AdaError(`raised CONSTRAINT_ERROR : divide by zero`, e.line, e.col);
        }
        switch (e.op) {
          case "+": return l + r;
          case "-": return l - r;
          case "*": return l * r;
          case "/": return typeof l === "number" && Number.isInteger(l) && Number.isInteger(r) ? Math.trunc(l / r) : l / r;
          case "mod": return ((l % r) + r) % r;
          case "rem": return l % r;
          case "**": return Math.pow(l, r);
          case "&": return `${this.stringify(l)}${this.stringify(r)}`;
          case "=": return valuesEqual(l, r);
          case "/=": return !valuesEqual(l, r);
          case "<": return ordinalOf(l) < ordinalOf(r);
          case "<=": return ordinalOf(l) <= ordinalOf(r);
          case ">": return ordinalOf(l) > ordinalOf(r);
          case ">=": return ordinalOf(l) >= ordinalOf(r);
          case "and": return l && r;
          case "or": return l || r;
          case "xor": return !!l !== !!r;
          default: throw new AdaError(`unsupported operator "${e.op}"`);
        }
      }
      default:
        throw new AdaError(`unsupported expression: ${e.kind}`);
    }
  }
}

// Drives a statement/call generator to completion, forwarding each pause (Get/Get_Line,
// or a `delay`) to `onNeedInput` and feeding its (awaited) answer back in.
async function driveGenerator(gen, onNeedInput) {
  let sent;
  for (;;) {
    const { value, done } = gen.next(sent);
    if (done) return value;
    sent = await onNeedInput(value);
  }
}

// Drains a statement/call generator synchronously — used where Get/Get_Line can't
// pause (e.g. a function called from inside an expression).
function runGenSync(gen, line, col) {
  let res = gen.next();
  while (!res.done) {
    if (res.value && res.value.__inputRequest) {
      throw new AdaError(`Get/Get_Line can only be used as a standalone statement here`, line, col);
    }
    res = gen.next();
  }
  return res.value;
}

async function runAdaProgram(source, onOutput, onNeedInput) {
  const interp = new Interpreter(onOutput);
  return interp.run(source, onNeedInput);
}

// AdaStudio — main application logic: file/tab management, editor sync,
// terminal command handling, and the Ada mini-interpreter wiring.

const DEFAULT_FILE = {
  name: "main.adb",
  content: `with Ada.Text_IO; use Ada.Text_IO;

procedure Main is
   N : Integer := 5;
   Total : Integer := 0;
begin
   Put_Line("Witaj w AdaStudio!");
   for I in 1 .. N loop
      Total := Total + I;
      Put_Line("I = " & Integer'Image(I));
   end loop;
   Put_Line("Suma 1.." & Integer'Image(N) & " = " & Integer'Image(Total));
end Main;
`,
};

const SNIPPETS = [
  { label: "procedure szkielet", code: `with Ada.Text_IO; use Ada.Text_IO;\n\nprocedure Main is\nbegin\n   Put_Line("Hello, world!");\nend Main;\n` },
  { label: "zmienna Integer", code: `X : Integer := 0;\n` },
  { label: "if / elsif / else", code: `if X > 0 then\n   Put_Line("dodatnia");\nelsif X < 0 then\n   Put_Line("ujemna");\nelse\n   Put_Line("zero");\nend if;\n` },
  { label: "pętla for", code: `for I in 1 .. 10 loop\n   Put_Line(Integer'Image(I));\nend loop;\n` },
  { label: "pętla while", code: `while X < 10 loop\n   X := X + 1;\nend loop;\n` },
  { label: "Put_Line", code: `Put_Line("tekst");\n` },
  { label: "case", code: `case X is\n   when 1 =>\n      Put_Line("jeden");\n   when 2 | 3 =>\n      Put_Line("dwa albo trzy");\n   when others =>\n      Put_Line("inne");\nend case;\n` },
  { label: "funkcja", code: `function Kwadrat(N : Integer) return Integer is\nbegin\n   return N * N;\nend Kwadrat;\n` },
  { label: "procedura z parametrami", code: `procedure Zamien(A, B : in out Integer) is\n   Tmp : Integer;\nbegin\n   Tmp := A;\n   A := B;\n   B := Tmp;\nend Zamien;\n` },
  { label: "typ rekordowy (record)", code: `type Punkt is record\n   X : Integer;\n   Y : Integer;\nend record;\n\nP : Punkt := (X => 0, Y => 0);\n` },
  { label: "typ wyliczeniowy (enum)", code: `type Dzien is (Pon, Wto, Sro, Czw, Pia, Sob, Nie);\nD : Dzien := Pon;\n` },
  { label: "tablica", code: `type Tablica is array(1 .. 10) of Integer;\nA : Tablica := (others => 0);\n` },
  { label: "obsługa wyjątków", code: `begin\n   null;\nexception\n   when others =>\n      Put_Line("Wystapil blad");\nend;\n` },
];

const ADA_HELP = {
  put_line: "Put_Line(S : String) — wypisuje tekst i przechodzi do nowej linii. Pakiet: Ada.Text_IO.",
  put: "Put(S : String) — wypisuje tekst bez przejścia do nowej linii.",
  new_line: "New_Line — wypisuje pusty wiersz.",
  get: "Get(Zmienna) — czyta wartość ze standardowego wejścia (terminal) i przypisuje ją do zmiennej.",
  delay: "delay D; — czeka D sekund. delay until T; — czeka aż nadejdzie czas T (Ada.Real_Time.Time). Naprawdę czeka w czasie rzeczywistym.",
  clock: "Ada.Real_Time.Clock — funkcja bezparametrowa zwracająca bieżący czas (Time). Użycie: Zmienna := Clock;",
  vector: "Ada.Containers.Vectors: V : Vector; V.Append(X) (albo Append(V,X)); Element(V,I); First_Element/Last_Element(V); Length(V); Clear(V); for X of V loop.",
  unbounded_string: "Ada.Strings.Unbounded: To_Unbounded_String(S), To_String(U), Append(U, S), Length(U). Działa jak zwykły String.",
  to_upper: "Ada.Characters.Handling.To_Upper(S) — zamienia na wielkie litery (działa dla String i Character).",
  trim: "Ada.Strings.Fixed.Trim(S) — usuwa białe znaki z obu końców łańcucha.",
  get_line: "Get_Line(Zmienna : String) — czyta cały wiersz tekstu ze standardowego wejścia.",
  "integer'image": "Integer'Image(X) — zamienia liczbę całkowitą na String (ze spacją wiodącą dla liczb dodatnich).",
  "'round": "X'Round — zaokrągla Float do najbliższej liczby całkowitej (przy remisie: od zera). Integer(X) robi to samo.",
  round: "Integer(X) — konwersja Float→Integer zaokrągla do najbliższej wartości (przy remisie: od zera), zgodnie z Adą.",
  for: "for I in A .. B loop ... end loop; — pętla z licznikiem od A do B (użyj 'reverse' dla malejącej).",
  while: "while WARUNEK loop ... end loop; — pętla warunkowa.",
  if: "if WARUNEK then ... elsif ... else ... end if; — instrukcja warunkowa.",
  procedure: "procedure Nazwa is DEKLARACJE begin INSTRUKCJE end Nazwa; — definicja procedury.",
  type: "Wbudowane typy: Integer, Float, Boolean, Character, String, Natural, Positive.",
  mod: "mod / rem — dzielenie modulo (mod zawsze zgodne ze znakiem dzielnika, rem ze znakiem dzielnej).",
  "with": "with Ada.Text_IO; use Ada.Text_IO; — importuje pakiet wejścia/wyjścia.",
  record: "type T is record F1 : Typ1; F2 : Typ2; end record; — definicja rekordu (struktury). Dostęp: Zmienna.F1.",
  case: "case Wyr is when W1 => ...; when W2 | W3 => ...; when others => ...; end case; — instrukcja wyboru.",
  function: "function Nazwa(Param : Typ) return Typ is begin ... return Wartosc; end Nazwa; — funkcja zwracająca wartość.",
  array: "type T is array(A .. B) of Elem; — tablica indeksowana od A do B. Atrybuty: 'First, 'Last, 'Length.",
  exception: "begin ... exception when others => ...; end; — przechwytywanie wyjątków (np. CONSTRAINT_ERROR).",
  abs: "abs X — wartość bezwzględna.",
  "and then": "A and then B — koniunkcja z leniwym wartościowaniem (nie liczy B, jeśli A jest fałszem).",
  "or else": "A or else B — alternatywa z leniwym wartościowaniem (nie liczy B, jeśli A jest prawdą).",
  subtype: "subtype Nazwa is Typ [range A .. B]; — podtyp/alias istniejącego typu.",
};

// ---------- autocomplete data ----------
// ADA_KEYWORDS (a Set) comes from highlight.js, loaded before this file.
const ADA_KEYWORD_LIST = [...ADA_KEYWORDS];

const ADA_PACKAGES = [
  "Ada.Text_IO", "Ada.Text_IO.Unbounded_IO", "Ada.Integer_Text_IO", "Ada.Float_Text_IO",
  "Ada.Strings.Unbounded", "Ada.Strings.Fixed", "Ada.Strings.Maps",
  "Ada.Characters.Handling", "Ada.Numerics", "Ada.Numerics.Elementary_Functions",
  "Ada.Numerics.Discrete_Random", "Ada.Numerics.Float_Random", "Ada.Calendar",
  "Ada.Calendar.Formatting", "Ada.Command_Line", "Ada.Containers",
  "Ada.Containers.Vectors", "Ada.Containers.Doubly_Linked_Lists",
  "Ada.Containers.Hashed_Maps", "Ada.Containers.Ordered_Maps", "Ada.Containers.Ordered_Sets",
  "Ada.Exceptions", "Ada.Direct_IO", "Ada.Sequential_IO", "Ada.Unchecked_Conversion",
  "Ada.Unchecked_Deallocation", "Ada.Finalization", "Ada.Tags", "Ada.IO_Exceptions",
];

// Only attributes the mini-interpreter actually evaluates (see interpreter.js evalExpr "attr"/"attrcall").
const ADA_ATTRIBUTES = ["Image", "Value", "First", "Last", "Length", "Val", "Pos", "Round", "Truncation", "Succ", "Pred", "Min", "Max"];

// Only the subprograms execCall() actually knows how to run.
const ADA_BUILTINS = [
  { name: "Put_Line", insertText: 'Put_Line("");', cursorOffset: 'Put_Line("'.length },
  { name: "Put", insertText: 'Put("");', cursorOffset: 'Put("'.length },
  { name: "New_Line", insertText: "New_Line;" },
  { name: "Get", insertText: "Get();", cursorOffset: "Get(".length },
  { name: "Get_Line", insertText: "Get_Line();", cursorOffset: "Get_Line(".length },
];

const ADA_TYPE_LIST = [...ADA_TYPES];

function snippetByLabel(label) { return SNIPPETS.find(s => s.label === label); }
// Maps a typed prefix (an actual Ada keyword the user would type) to snippets worth
// offering at that point. "Put_Line" itself is handled by ADA_BUILTINS instead, so it
// isn't duplicated here.
const SNIPPET_ALIASES = {
  procedure: [snippetByLabel("procedure szkielet"), snippetByLabel("procedura z parametrami")],
  integer: [snippetByLabel("zmienna Integer")],
  if: [snippetByLabel("if / elsif / else")],
  for: [snippetByLabel("pętla for")],
  while: [snippetByLabel("pętla while")],
  case: [snippetByLabel("case")],
  function: [snippetByLabel("funkcja")],
  record: [snippetByLabel("typ rekordowy (record)")],
  type: [snippetByLabel("typ wyliczeniowy (enum)")],
  array: [snippetByLabel("tablica")],
  exception: [snippetByLabel("obsługa wyjątków")],
};

let files = [];
let activeId = null;
let nextId = 1;
let theme = "dark";
let history = [];
let historyIdx = -1;
let problems = []; // [{fileName, line, col, message}]
let autocompleteEnabled = true;
let hardcoreMode = false;

const el = (id) => document.getElementById(id);
const gutter = el("gutter");
const codeInput = el("codeInput");
const highlightLayer = el("highlightLayer").querySelector("code");
const highlightPre = el("highlightLayer");
const editorScroll = el("editorScroll");
const tabsEl = el("tabs");
const fileListEl = el("fileList");
const statusFile = el("statusFile");
const statusPos = el("statusPos");
const statusChars = el("statusChars");
const statusMsg = el("statusMsg");
const termBody = el("terminalBody");
const termInput = el("terminalInput");

const FILE_ICONS = { adb: "📘", ads: "📗", ada: "📄", txt: "📄" };
function iconFor(name) {
  const ext = name.split(".").pop().toLowerCase();
  return FILE_ICONS[ext] || "📄";
}

// ---------- toasts ----------
function toast(message, kind = "out") {
  const stack = el("toastStack");
  const t = document.createElement("div");
  t.className = "toast " + (kind === "err" ? "err" : kind === "ok" ? "ok" : "");
  t.textContent = message;
  stack.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ---------- modal dialog (replaces window.prompt) ----------
function showModal(title, defaultValue = "") {
  return new Promise((resolve) => {
    const overlay = el("modalOverlay");
    const input = el("modalInput");
    el("modalTitle").textContent = title;
    input.value = defaultValue;
    overlay.hidden = false;
    input.focus();
    input.select();

    const cleanup = (result) => {
      overlay.hidden = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      input.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const okBtn = el("modalOk");
    const cancelBtn = el("modalCancel");
    const onOk = () => cleanup(input.value.trim() || null);
    const onCancel = () => cleanup(null);
    const onKey = (e) => {
      if (e.key === "Enter") { e.preventDefault(); onOk(); }
      else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    input.addEventListener("keydown", onKey);
  });
}

// ---------- persistence ----------
function loadState() {
  try {
    const raw = localStorage.getItem("adastudio.files");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.files && parsed.files.length) {
        files = parsed.files;
        nextId = parsed.nextId || files.length + 1;
        activeId = parsed.activeId || files[0].id;
        return;
      }
    }
  } catch (e) { /* ignore corrupt state */ }
  const f = { id: nextId++, name: DEFAULT_FILE.name, content: DEFAULT_FILE.content, dirty: false };
  files = [f];
  activeId = f.id;
}

function saveState() {
  localStorage.setItem("adastudio.files", JSON.stringify({ files, nextId, activeId }));
}

function loadSettings() {
  hardcoreMode = localStorage.getItem("adastudio.hardcore") === "1";
  autocompleteEnabled = hardcoreMode ? false : localStorage.getItem("adastudio.autocomplete") !== "0";
}

// ---------- file helpers ----------
function getActive() { return files.find(f => f.id === activeId); }

function createFile(name, content = "") {
  const f = { id: nextId++, name, content, dirty: false };
  files.push(f);
  activeId = f.id;
  renderAll();
  saveState();
}

function closeFile(id) {
  const idx = files.findIndex(f => f.id === id);
  if (idx === -1) return;
  files.splice(idx, 1);
  if (!files.length) {
    const f = { id: nextId++, name: "main.adb", content: "", dirty: false };
    files.push(f);
  }
  if (activeId === id) activeId = files[Math.max(0, idx - 1)].id;
  renderAll();
  saveState();
}

function switchTo(id) {
  activeId = id;
  renderAll();
  saveState();
}

// ---------- editor rendering ----------
function syncHighlight() {
  const f = getActive();
  if (!f) return;
  highlightLayer.innerHTML = highlightAda(f.content) + "\n";
  syncGutter();
}

function syncGutter() {
  const f = getActive();
  const lines = f.content.split("\n").length;
  let out = "";
  for (let i = 1; i <= lines; i++) out += i + "\n";
  gutter.textContent = out;
}

function updateStatus() {
  const f = getActive();
  if (!f) return;
  statusFile.textContent = f.name + (f.dirty ? " ●" : "");
  const upto = codeInput.value.slice(0, codeInput.selectionStart);
  const lineNo = upto.split("\n").length;
  const colNo = upto.length - upto.lastIndexOf("\n");
  statusPos.textContent = `Wiersz ${lineNo}, Kol ${colNo}`;
  statusChars.textContent = `${f.content.length} znaków`;
  updateCurrentLineHighlight(lineNo);
}

function updateCurrentLineHighlight(lineNo) {
  const highlightEl = el("currentLineHighlight");
  if (!highlightEl) return;
  const lh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--code-lh")) || 21;
  highlightEl.style.top = `${(lineNo - 1) * lh + 12}px`;
  highlightEl.style.height = `${lh}px`;
  highlightEl.hidden = false;
}

async function renameFile(id) {
  const f = files.find(x => x.id === id);
  if (!f) return;
  const name = await showModal("Nowa nazwa pliku:", f.name);
  if (!name || name === f.name) return;
  if (files.some(x => x.id !== id && x.name === name)) { toast(`Plik "${name}" już istnieje`, "err"); return; }
  const oldName = f.name;
  f.name = name;
  clearProblemsFor(oldName);
  renderAll();
  saveState();
  toast(`Zmieniono nazwę: ${oldName} → ${name}`, "ok");
}

function renderTabs() {
  tabsEl.innerHTML = "";
  files.forEach(f => {
    const tab = document.createElement("div");
    tab.className = "tab" + (f.id === activeId ? " active" : "") + (f.dirty ? " dirty" : "");
    tab.title = "Dwuklik, aby zmienić nazwę";
    tab.innerHTML = `<span>${iconFor(f.name)}</span><span>${f.name}</span><span class="dot"></span>`;
    tab.addEventListener("click", () => switchTo(f.id));
    tab.addEventListener("dblclick", () => renameFile(f.id));
    tabsEl.appendChild(tab);
  });
}

function renderFileList() {
  fileListEl.innerHTML = "";
  files.forEach(f => {
    const item = document.createElement("div");
    item.className = "file-item" + (f.id === activeId ? " active" : "") + (f.dirty ? " dirty" : "");
    item.title = "Dwuklik, aby zmienić nazwę";
    item.innerHTML = `<span>${iconFor(f.name)}</span><span>${f.name}</span><span class="dot"></span><span class="rename-x" title="Zmień nazwę">✎</span><span class="close-x" title="Zamknij">✕</span>`;
    item.addEventListener("click", (e) => {
      if (e.target.classList.contains("close-x")) { closeFile(f.id); return; }
      if (e.target.classList.contains("rename-x")) { renameFile(f.id); return; }
      switchTo(f.id);
    });
    item.addEventListener("dblclick", (e) => {
      if (e.target.classList.contains("close-x")) return;
      renameFile(f.id);
    });
    fileListEl.appendChild(item);
  });
  const totalLines = files.reduce((sum, f) => sum + f.content.split("\n").length, 0);
  const statsEl = el("projectStats");
  if (statsEl) statsEl.textContent = `${files.length} ${files.length === 1 ? "plik" : "plików"} · ${totalLines} wierszy`;
}

function renderSnippets() {
  const box = el("snippetList");
  box.innerHTML = "";
  SNIPPETS.forEach(s => {
    const item = document.createElement("div");
    item.className = "snippet-item";
    item.textContent = s.label;
    item.title = "Kliknij, aby wstawić";
    item.addEventListener("click", () => insertAtCursor(s.code));
    box.appendChild(item);
  });
}

function renderAll() {
  const f = getActive();
  codeInput.value = f ? f.content : "";
  syncHighlight();
  renderTabs();
  renderFileList();
  updateStatus();
  acHide();
}

function insertAtCursor(text) {
  const start = codeInput.selectionStart;
  const end = codeInput.selectionEnd;
  const val = codeInput.value;
  codeInput.value = val.slice(0, start) + text + val.slice(end);
  codeInput.selectionStart = codeInput.selectionEnd = start + text.length;
  onCodeChanged();
  codeInput.focus();
}

function onCodeChanged() {
  const f = getActive();
  if (!f) return;
  f.content = codeInput.value;
  f.dirty = true;
  syncHighlight();
  renderTabs();
  renderFileList();
  updateStatus();
  saveState();
  updateAutocomplete();
}

// ---------- editor events ----------
codeInput.addEventListener("input", onCodeChanged);
codeInput.addEventListener("keyup", (e) => {
  updateStatus();
  if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)) acHide();
});
codeInput.addEventListener("click", () => { acHide(); updateStatus(); });
codeInput.addEventListener("blur", () => acHide());
codeInput.addEventListener("scroll", () => {
  highlightPre.scrollTop = codeInput.scrollTop;
  highlightPre.scrollLeft = codeInput.scrollLeft;
  gutter.scrollTop = codeInput.scrollTop;
  acHide();
});

// ---------- autocomplete ----------
let acState = null;

function acHide() {
  acState = null;
  const popup = el("autocompletePopup");
  popup.hidden = true;
  popup.innerHTML = "";
}

function getCharWidth() {
  const probe = document.createElement("span");
  const cs = getComputedStyle(codeInput);
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  probe.style.fontFamily = cs.fontFamily;
  probe.style.fontSize = cs.fontSize;
  probe.textContent = "M".repeat(40);
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 40;
  probe.remove();
  return w || 8;
}

function positionAcPopup(caretPos) {
  const val = codeInput.value;
  const lineStart = val.lastIndexOf("\n", caretPos - 1) + 1;
  const lineIdx = val.slice(0, lineStart).split("\n").length - 1;
  const col = caretPos - lineStart;
  const lh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--code-lh")) || 21;
  const charW = getCharWidth();
  const popup = el("autocompletePopup");
  popup.style.top = `${lineIdx * lh + 12 + lh - codeInput.scrollTop}px`;
  popup.style.left = `${16 + col * charW - codeInput.scrollLeft}px`;
}

function acRender() {
  const popup = el("autocompletePopup");
  popup.innerHTML = "";
  acState.items.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = "autocomplete-item" + (i === acState.sel ? " sel" : "");
    row.innerHTML = `<span>${it.label}</span><span class="kind">${it.kind}</span>`;
    row.addEventListener("mousedown", (e) => { e.preventDefault(); acState.sel = i; acAccept(); });
    popup.appendChild(row);
  });
  popup.hidden = false;
}

function acAccept() {
  if (!acState) return;
  const it = acState.items[acState.sel];
  const val = codeInput.value;
  codeInput.value = val.slice(0, acState.start) + it.insertText + val.slice(acState.end);
  const newPos = acState.start + (it.cursorOffset != null ? it.cursorOffset : it.insertText.length);
  acHide();
  codeInput.selectionStart = codeInput.selectionEnd = newPos;
  onCodeChanged();
  codeInput.focus();
}

// Identifiers already used elsewhere in the current file (variable/type/subprogram
// names) — so completion covers the user's own code, not just Ada's vocabulary.
function collectFileIdentifiers(excludeStart, excludeEnd) {
  const seen = new Map(); // lowercase -> original casing (first occurrence wins)
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m;
  while ((m = re.exec(codeInput.value))) {
    if (m.index >= excludeStart && m.index < excludeEnd) continue; // skip the word being typed
    const word = m[0];
    const lower = word.toLowerCase();
    if (word.length < 3 || ADA_KEYWORDS.has(lower) || seen.has(lower)) continue;
    seen.set(lower, word);
  }
  return seen;
}

function getCompletionContext() {
  const pos = codeInput.selectionStart;
  if (pos !== codeInput.selectionEnd) return null;
  const val = codeInput.value;
  const lineStart = val.lastIndexOf("\n", pos - 1) + 1;
  const lineUpToCaret = val.slice(lineStart, pos);
  let m;

  if ((m = lineUpToCaret.match(/(?:with|use)\s+([A-Za-z][\w.]*)?$/i))) {
    const prefix = m[1] || "";
    const items = ADA_PACKAGES
      .filter(p => p.toLowerCase().startsWith(prefix.toLowerCase()) && p.toLowerCase() !== prefix.toLowerCase())
      .map(p => ({ label: p, kind: "pakiet", insertText: p }));
    if (!items.length) return null;
    return { items: items.slice(0, 15), start: pos - prefix.length, end: pos };
  }

  if ((m = lineUpToCaret.match(/'([A-Za-z_]*)$/))) {
    const prefix = m[1];
    const items = ADA_ATTRIBUTES
      .filter(a => a.toLowerCase().startsWith(prefix.toLowerCase()))
      .map(a => ({ label: "'" + a, kind: "atrybut", insertText: a }));
    if (!items.length) return null;
    return { items, start: pos - prefix.length, end: pos };
  }

  if ((m = lineUpToCaret.match(/([A-Za-z_][A-Za-z0-9_]*)$/))) {
    const prefix = m[1];
    if (prefix.length < 2) return null;
    const lower = prefix.toLowerCase();
    const used = new Set();
    const items = [];
    // Builtins stay offered even once the name is fully typed (e.g. "Put"), since
    // accepting still adds real value: the parens/quotes/semicolon and caret placement.
    const add = (label, kind, insertText, cursorOffset, keepOnExactMatch) => {
      const key = label.toLowerCase();
      if ((key === lower && !keepOnExactMatch) || used.has(key)) return;
      used.add(key);
      items.push({ label, kind, insertText: insertText ?? label, cursorOffset });
    };

    ADA_BUILTINS.filter(b => b.name.toLowerCase().startsWith(lower))
      .forEach(b => add(b.name, "wbudowana procedura", b.insertText, b.cursorOffset, true));
    ADA_KEYWORD_LIST.filter(k => k.startsWith(lower))
      .forEach(k => add(k, "słowo kluczowe"));
    ADA_TYPE_LIST.filter(t => t.toLowerCase().startsWith(lower))
      .forEach(t => add(t, "typ"));
    Object.keys(SNIPPET_ALIASES).forEach(trigger => {
      if (!trigger.startsWith(lower)) return;
      SNIPPET_ALIASES[trigger].forEach(snippet => {
        if (snippet) add(snippet.label, "fragment", snippet.code);
      });
    });
    collectFileIdentifiers(pos - prefix.length, pos).forEach((original, key) => {
      if (key.startsWith(lower)) add(original, "z pliku");
    });

    if (!items.length) return null;
    return { items: items.slice(0, 15), start: pos - prefix.length, end: pos };
  }

  return null;
}

function updateAutocomplete() {
  if (!autocompleteEnabled) { acHide(); return; }
  const ctx = getCompletionContext();
  if (!ctx) { acHide(); return; }
  acState = { items: ctx.items, sel: 0, start: ctx.start, end: ctx.end };
  positionAcPopup(codeInput.selectionStart);
  acRender();
}

const AUTO_PAIRS = { "(": ")", '"': '"', "'": "'" };
codeInput.addEventListener("keydown", (e) => {
  if (acState && !e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.key === "ArrowDown") { e.preventDefault(); acState.sel = Math.min(acState.sel + 1, acState.items.length - 1); acRender(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); acState.sel = Math.max(acState.sel - 1, 0); acRender(); return; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); acAccept(); return; }
    if (e.key === "Escape") { e.preventDefault(); acHide(); return; }
  }
  if (e.key === ")" && codeInput.selectionStart === codeInput.selectionEnd && codeInput.value[codeInput.selectionStart] === ")") {
    // typing the closing paren of an already-auto-inserted pair steps over it instead of duplicating it
    e.preventDefault();
    codeInput.selectionStart = codeInput.selectionEnd = codeInput.selectionStart + 1;
    return;
  }
  if (AUTO_PAIRS[e.key] && codeInput.selectionStart === codeInput.selectionEnd) {
    const start = codeInput.selectionStart;
    const val = codeInput.value;
    const nextChar = val[start];
    // typing the closing char right before its own auto-inserted twin just steps over it
    if (e.key === AUTO_PAIRS[e.key] && nextChar === e.key) {
      e.preventDefault();
      codeInput.selectionStart = codeInput.selectionEnd = start + 1;
      return;
    }
    if (/[\s)\];,]|^$/.test(nextChar || "")) {
      e.preventDefault();
      const pair = AUTO_PAIRS[e.key];
      codeInput.value = val.slice(0, start) + e.key + pair + val.slice(start);
      codeInput.selectionStart = codeInput.selectionEnd = start + 1;
      onCodeChanged();
      return;
    }
  }
  if (e.key === "Tab") {
    e.preventDefault();
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;
    const val = codeInput.value;
    if (e.shiftKey) {
      const lineStart = val.lastIndexOf("\n", start - 1) + 1;
      if (val.slice(lineStart, lineStart + 3) === "   ") {
        codeInput.value = val.slice(0, lineStart) + val.slice(lineStart + 3);
        codeInput.selectionStart = Math.max(lineStart, start - 3);
        codeInput.selectionEnd = Math.max(lineStart, end - 3);
      }
    } else {
      codeInput.value = val.slice(0, start) + "   " + val.slice(end);
      codeInput.selectionStart = codeInput.selectionEnd = start + 3;
    }
    onCodeChanged();
  } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    // must come before the plain-Enter branch below, or Ctrl/Cmd+Enter would just insert a newline
    e.preventDefault();
    runCurrentFile();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const start = codeInput.selectionStart;
    const val = codeInput.value;
    const lineStart = val.lastIndexOf("\n", start - 1) + 1;
    const currentLine = val.slice(lineStart, start);
    const indentMatch = currentLine.match(/^\s*/);
    let indent = indentMatch ? indentMatch[0] : "";
    if (/\b(is|then|loop|declare|else|begin)\s*$/.test(currentLine.trim())) indent += "   ";
    const insertion = "\n" + indent;
    codeInput.value = val.slice(0, start) + insertion + val.slice(codeInput.selectionEnd);
    codeInput.selectionStart = codeInput.selectionEnd = start + insertion.length;
    onCodeChanged();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveCurrentFile();
  } else if ((e.ctrlKey || e.metaKey) && e.key === "/") {
    e.preventDefault();
    toggleComment();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    findInEditor();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
    e.preventDefault();
    duplicateLine();
  } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    moveLine(e.key === "ArrowUp" ? -1 : 1);
  }
});

function currentLineRange(pos) {
  const val = codeInput.value;
  const start = val.lastIndexOf("\n", pos - 1) + 1;
  let end = val.indexOf("\n", pos);
  if (end === -1) end = val.length;
  return { start, end };
}

function duplicateLine() {
  const pos = codeInput.selectionStart;
  const { start, end } = currentLineRange(pos);
  const col = pos - start;
  const val = codeInput.value;
  const line = val.slice(start, end);
  codeInput.value = val.slice(0, end) + "\n" + line + val.slice(end);
  codeInput.selectionStart = codeInput.selectionEnd = end + 1 + col;
  onCodeChanged();
}

function moveLine(dir) {
  const pos = codeInput.selectionStart;
  const val = codeInput.value;
  const { start, end } = currentLineRange(pos);
  const col = pos - start;
  if (dir === -1) {
    if (start === 0) return;
    const prevStart = val.lastIndexOf("\n", start - 2) + 1;
    const prevLine = val.slice(prevStart, start - 1);
    const line = val.slice(start, end);
    codeInput.value = val.slice(0, prevStart) + line + "\n" + prevLine + val.slice(end);
    codeInput.selectionStart = codeInput.selectionEnd = prevStart + col;
  } else {
    if (end === val.length) return;
    const nextEnd = val.indexOf("\n", end + 1);
    const nextLineEnd = nextEnd === -1 ? val.length : nextEnd;
    const nextLine = val.slice(end + 1, nextLineEnd);
    const line = val.slice(start, end);
    codeInput.value = val.slice(0, start) + nextLine + "\n" + line + val.slice(nextLineEnd);
    codeInput.selectionStart = codeInput.selectionEnd = start + nextLine.length + 1 + col;
  }
  onCodeChanged();
}

// Ctrl+Enter fallback (some browsers fire this before the block above on keydown consistently, kept for safety)
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && document.activeElement !== codeInput) {
    e.preventDefault();
    runCurrentFile();
  }
});

function toggleComment() {
  const start = codeInput.selectionStart;
  const end = codeInput.selectionEnd;
  const val = codeInput.value;
  const lineStart = val.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = val.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = val.length;
  const block = val.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const allCommented = lines.every(l => l.trim() === "" || l.trim().startsWith("--"));
  const newLines = lines.map(l => {
    if (allCommented) return l.replace(/^(\s*)--\s?/, "$1");
    return l.trim() === "" ? l : l.replace(/^(\s*)/, "$1-- ");
  });
  const newBlock = newLines.join("\n");
  codeInput.value = val.slice(0, lineStart) + newBlock + val.slice(lineEnd);
  onCodeChanged();
}

async function findInEditor() {
  const term = await showModal("Znajdź w bieżącym pliku:");
  if (!term) return;
  const idx = codeInput.value.indexOf(term);
  if (idx === -1) {
    toast(`Nie znaleziono: "${term}"`, "err");
    return;
  }
  codeInput.focus();
  codeInput.selectionStart = idx;
  codeInput.selectionEnd = idx + term.length;
  updateStatus();
}

// ---------- toolbar actions ----------
el("btnNew").addEventListener("click", async () => {
  const name = await showModal("Nazwa nowego pliku:", `file${nextId}.adb`);
  if (name) { createFile(name, ""); toast(`Utworzono ${name}`, "ok"); }
});
el("btnAddFile").addEventListener("click", () => el("btnNew").click());

el("btnOpen").addEventListener("click", () => el("fileInput").click());
el("fileInput").addEventListener("change", (e) => {
  [...e.target.files].forEach(file => {
    const reader = new FileReader();
    reader.onload = () => createFile(file.name, reader.result);
    reader.readAsText(file);
  });
  e.target.value = "";
});

function saveCurrentFile() {
  const f = getActive();
  if (!f) return;
  f.dirty = false;
  renderTabs();
  renderFileList();
  statusMsg.textContent = `Zapisano ${f.name}`;
  toast(`Zapisano ${f.name}`, "ok");
  saveState();
}
el("btnSave").addEventListener("click", saveCurrentFile);

el("btnDownload").addEventListener("click", () => {
  const f = getActive();
  if (!f) return;
  const blob = new Blob([f.content], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = f.name;
  a.click();
  URL.revokeObjectURL(a.href);
});

el("btnFormat").addEventListener("click", () => {
  const f = getActive();
  if (!f) return;
  f.content = formatAda(f.content);
  codeInput.value = f.content;
  syncHighlight();
  updateStatus();
  saveState();
  statusMsg.textContent = "Sformatowano";
  toast("Kod sformatowany", "ok");
});

function formatAda(source) {
  const lines = source.split("\n").map(l => l.trim());
  let depth = 0;
  const dedentStarters = /^(end|elsif|else|when)\b/i;
  const out = [];
  for (let raw of lines) {
    if (raw === "") { out.push(""); continue; }
    let d = depth;
    if (dedentStarters.test(raw)) d = Math.max(0, depth - 1);
    out.push("   ".repeat(d) + raw);
    const opens = /\b(is|then|loop|declare|record|begin)\s*$/i.test(raw) && !/\bend\b/i.test(raw);
    const closesImmediately = /^end\b/i.test(raw);
    if (opens) depth = d + 1;
    else if (closesImmediately) depth = Math.max(0, d);
    else depth = d;
  }
  return out.join("\n");
}

el("btnFind").addEventListener("click", findInEditor);

el("fontSizeSelect").addEventListener("change", (e) => {
  document.documentElement.style.setProperty("--code-size", e.target.value + "px");
  document.documentElement.style.setProperty("--code-lh", (parseFloat(e.target.value) * 1.55) + "px");
});

const THEMES = ["dark", "light", "monokai", "nord", "solarized", "dracula", "onedark", "gruvbox", "tokyonight", "catppuccin", "githublight"];
function applyTheme(name) {
  theme = THEMES.includes(name) ? name : "dark";
  document.body.classList.remove(...THEMES.map(t => t));
  if (theme !== "dark") document.body.classList.add(theme);
  localStorage.setItem("adastudio.theme", theme);
  el("themeSelect").value = theme;
}
el("themeSelect").addEventListener("change", (e) => applyTheme(e.target.value));

// ---------- settings ----------
function openSettings() {
  el("toggleAutocomplete").checked = autocompleteEnabled;
  el("toggleAutocomplete").disabled = hardcoreMode;
  el("toggleHardcore").checked = hardcoreMode;
  el("settingsOverlay").hidden = false;
}
function closeSettings() { el("settingsOverlay").hidden = true; }
el("btnSettings").addEventListener("click", openSettings);
el("settingsClose").addEventListener("click", closeSettings);
el("settingsOverlay").addEventListener("click", (e) => { if (e.target.id === "settingsOverlay") closeSettings(); });

el("toggleAutocomplete").addEventListener("change", (e) => {
  autocompleteEnabled = e.target.checked;
  localStorage.setItem("adastudio.autocomplete", autocompleteEnabled ? "1" : "0");
  if (!autocompleteEnabled) acHide();
});

el("toggleHardcore").addEventListener("change", (e) => {
  hardcoreMode = e.target.checked;
  if (hardcoreMode) { autocompleteEnabled = false; acHide(); }
  localStorage.setItem("adastudio.hardcore", hardcoreMode ? "1" : "0");
  localStorage.setItem("adastudio.autocomplete", autocompleteEnabled ? "1" : "0");
  el("toggleAutocomplete").checked = autocompleteEnabled;
  el("toggleAutocomplete").disabled = hardcoreMode;
  toast(hardcoreMode ? "Tryb hardcore włączony — podpowiedzi wyłączone" : "Tryb hardcore wyłączony", "ok");
});

// ---------- command palette ----------
function paletteActions() {
  return [
    { label: "Nowy plik", hint: "Ctrl+N", run: () => el("btnNew").click() },
    { label: "Zmień nazwę bieżącego pliku", hint: "", run: () => activeId != null && renameFile(activeId) },
    { label: "Otwórz plik z dysku", hint: "", run: () => el("btnOpen").click() },
    { label: "Zapisz bieżący plik", hint: "Ctrl+S", run: saveCurrentFile },
    { label: "Pobierz plik", hint: "", run: () => el("btnDownload").click() },
    { label: "Formatuj kod", hint: "", run: () => el("btnFormat").click() },
    { label: "Znajdź w pliku", hint: "Ctrl+F", run: findInEditor },
    { label: "Uruchom program", hint: "Ctrl+Enter", run: runCurrentFile },
    { label: "Wyczyść terminal", hint: "Ctrl+L", run: () => termBody.innerHTML = "" },
    { label: "Pokaż panel Problemów", hint: "", run: () => setTerminalTab("problems") },
    { label: "Motyw: Ciemny", hint: "", run: () => applyTheme("dark") },
    { label: "Motyw: Jasny", hint: "", run: () => applyTheme("light") },
    { label: "Motyw: Monokai", hint: "", run: () => applyTheme("monokai") },
    { label: "Motyw: Nord", hint: "", run: () => applyTheme("nord") },
    { label: "Motyw: Solarized", hint: "", run: () => applyTheme("solarized") },
    { label: "Motyw: Dracula", hint: "", run: () => applyTheme("dracula") },
    { label: "Motyw: One Dark", hint: "", run: () => applyTheme("onedark") },
    { label: "Motyw: Gruvbox", hint: "", run: () => applyTheme("gruvbox") },
    { label: "Motyw: Tokyo Night", hint: "", run: () => applyTheme("tokyonight") },
    { label: "Motyw: Catppuccin", hint: "", run: () => applyTheme("catppuccin") },
    { label: "Motyw: GitHub Light", hint: "", run: () => applyTheme("githublight") },
    { label: "Skomentuj / odkomentuj linię", hint: "Ctrl+/", run: toggleComment },
    { label: "Duplikuj wiersz", hint: "Ctrl+D", run: duplicateLine },
    { label: "Przesuń wiersz w górę", hint: "Alt+↑", run: () => moveLine(-1) },
    { label: "Przesuń wiersz w dół", hint: "Alt+↓", run: () => moveLine(1) },
    { label: "Ustawienia", hint: "", run: openSettings },
    { label: autocompleteEnabled ? "Wyłącz podpowiedzi" : "Włącz podpowiedzi", hint: "", run: () => el("toggleAutocomplete").click() },
  ];
}

function openPalette() {
  const overlay = el("paletteOverlay");
  const input = el("paletteInput");
  const list = el("paletteList");
  overlay.hidden = false;
  input.value = "";
  input.focus();
  let sel = 0;
  let items = [];

  function render() {
    const q = input.value.trim().toLowerCase();
    items = paletteActions().filter(a => a.label.toLowerCase().includes(q));
    list.innerHTML = "";
    items.forEach((a, i) => {
      const row = document.createElement("div");
      row.className = "palette-item" + (i === sel ? " sel" : "");
      row.innerHTML = `<span>${a.label}</span><span class="hint">${a.hint}</span>`;
      row.addEventListener("click", () => { close(); a.run(); });
      list.appendChild(row);
    });
  }
  function close() {
    overlay.hidden = true;
    input.removeEventListener("input", render);
    input.removeEventListener("keydown", onKey);
    overlay.removeEventListener("click", onOverlayClick);
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === "Enter") { e.preventDefault(); if (items[sel]) { close(); items[sel].run(); } }
  }
  function onOverlayClick(e) { if (e.target === overlay) close(); }
  input.addEventListener("input", () => { sel = 0; render(); });
  input.addEventListener("keydown", onKey);
  overlay.addEventListener("click", onOverlayClick);
  render();
}
el("btnPalette").addEventListener("click", openPalette);
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openPalette();
  }
});

// ---------- resizer ----------
(function setupResizer() {
  const resizer = el("resizer");
  const panel = el("terminalPanel");
  let dragging = false;
  resizer.addEventListener("mousedown", () => { dragging = true; document.body.style.cursor = "row-resize"; });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = document.getElementById("app").getBoundingClientRect();
    const newHeight = rect.bottom - e.clientY;
    panel.style.height = Math.max(90, Math.min(newHeight, rect.height * 0.7)) + "px";
  });
  window.addEventListener("mouseup", () => { dragging = false; document.body.style.cursor = ""; });
})();

// ---------- terminal ----------
// A small but realistic Unix-ish shell: real GNU/GNAT-style command names,
// flags and output formatting (ls -la columns, cat -n, gnatmake's real
// gcc -> gnatbind -> gnatlink pipeline, compiler messages shaped like
// "file:line:col: error: ...", proper exit codes). Not a real OS — the
// "filesystem" is just the open files array — but the transcript reads
// like a genuine terminal session instead of toy pseudo-commands.

const CWD = "/home/user/adastudio";
const USER = "user";
const HOSTNAME = "adastudio";
const compiledBinaries = new Set();

let redirectCapture = null; // when set, logTerm writes into this buffer instead of the DOM
function logTerm(text, cls = "out") {
  if (redirectCapture) { if (cls === "out") redirectCapture.push(text); return; }
  const line = document.createElement("div");
  line.className = "term-line " + cls;
  line.textContent = text;
  termBody.appendChild(line);
  termBody.scrollTop = termBody.scrollHeight;
}

function bootTerminal() {
  logTerm(`AdaStudio terminal — GNAT Community 13.2.0 simulation`, "info");
  logTerm(`Wpisz 'help' po listę poleceń, albo 'gnatmake main.adb && ./main' jak w prawdziwym GNAT.`, "info");
}

function fmtSize(n) { return String(n).padStart(6, " "); }
function fmtDate(d) {
  const months = ["sty","lut","mar","kwi","maj","cze","lip","sie","wrz","paź","lis","gru"];
  const dt = new Date(d || Date.now());
  return `${months[dt.getMonth()]} ${String(dt.getDate()).padStart(2, " ")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}

function baseName(name) { return name.replace(/\.(adb|ads|ada)$/i, ""); }

function compilerErrorLine(fileName, err) {
  if (err.line != null) return `${fileName}:${err.line}:${err.col ?? 1}: error: ${err.message}`;
  return `${fileName}: error: ${err.message}`;
}

// A program that reads input can't be safely auto-run with a canned dummy answer to
// "check for errors" — its own loop condition may depend on what's typed (e.g.
// `while opcja /= 3 loop ... Get(opcja);`), so a constant dummy reply can loop forever.
// For such programs the pre-run check only lexes/parses (catches syntax errors);
// runtime errors surface the first time the program is actually, interactively run.
function readsInput(source) { return /\b(get|get_line)\s*\(/i.test(source); }
function parseCheck(source) { new Parser(new Lexer(source).tokens).parseProgram(); }

// Stdin/delay handling for a program that isn't actually being watched (a plain
// compile-check, or `gprbuild`ing every file) — Get/Get_Line get an instant dummy
// answer and `delay` doesn't actually wait, so background checks never hang or
// take real wall-clock time for a terminal that isn't even shown.
function dummyStdin(req) {
  if (req && req.__delayRequest) return Promise.resolve();
  return Promise.resolve("0");
}

// Stdin/delay handling for a program the user is actually running: Get/Get_Line
// pause on the terminal's own input row (its Enter handler resolves
// `pendingInputResolve`) exactly like a real terminal would block a program's stdin
// read; `delay`/`delay until` waits for real wall-clock time via setTimeout, without
// freezing the page (the interpreter is merely suspended, not the browser).
let pendingInputResolve = null;
function interactiveStdin(req) {
  if (req && req.__delayRequest) return new Promise((resolve) => setTimeout(resolve, req.ms));
  setTerminalTab("terminal");
  termInput.focus();
  return new Promise((resolve) => { pendingInputResolve = resolve; });
}

async function runCurrentFile() {
  const f = getActive();
  if (!f) return;
  try { await gnatmake(f.name, true); } catch { /* error already logged to terminal + problems panel */ }
}
el("btnRun").addEventListener("click", runCurrentFile);

async function gnatmake(target, autoRun) {
  const f = files.find(x => x.name === target);
  if (!f) {
    logTerm(`gnatmake: "${target}" not found, use -P<project> if this is a multi-unit project`, "err");
    return;
  }
  const exe = baseName(f.name);
  logTerm(`gcc -c -gnatQ ${f.name}`, "info");
  clearProblemsFor(f.name);
  try {
    // silent check pass first — full run (Get/Get_Line answered instantly) for ordinary
    // programs, parse-only for ones that read input (see readsInput() above)
    if (readsInput(f.content)) parseCheck(f.content);
    else await runAdaProgram(f.content, () => {}, dummyStdin);
    logTerm(`gnatbind -x ${exe}.ali`, "info");
    logTerm(`gnatlink ${exe}.ali`, "info");
    compiledBinaries.add(exe);
    statusMsg.textContent = "Kompilacja zakończona sukcesem";
    toast(`${f.name}: kompilacja OK`, "ok");
    if (autoRun) {
      logTerm(`./${exe}`, "cmd");
      await runAdaProgram(f.content, (line) => logTerm(line, "out"), interactiveStdin);
      logTerm(`+ exited with code 0`, "info");
    }
  } catch (err) {
    logTerm(compilerErrorLine(f.name, err), "err");
    logTerm(`gnatmake: "${f.name}" compilation error`, "err");
    statusMsg.textContent = "Błąd kompilacji";
    addProblem(f.name, err);
    toast(`${f.name}: błąd kompilacji`, "err");
    if (autoRun) throw err;
  }
}

async function runBinary(exe) {
  if (!compiledBinaries.has(exe)) {
    logTerm(`zsh: no such file or directory: ./${exe}`, "err");
    return;
  }
  const f = files.find(x => baseName(x.name) === exe);
  if (!f) { logTerm(`zsh: no such file or directory: ./${exe}`, "err"); return; }
  try {
    await runAdaProgram(f.content, (line) => logTerm(line, "out"), interactiveStdin);
    logTerm(`+ exited with code 0`, "info");
  } catch (err) {
    logTerm(`raised ${err.message.startsWith("raised") ? err.message.slice(7) : err.message}`, "err");
    logTerm(`+ exited with code 1`, "err");
  }
}

// ---------- problems panel ----------
function addProblem(fileName, err) {
  problems.push({ fileName, line: err.line ?? null, col: err.col ?? null, message: err.message });
  renderProblems();
}
function clearProblemsFor(fileName) {
  problems = problems.filter(p => p.fileName !== fileName);
  renderProblems();
}
function renderProblems() {
  const body = el("problemsBody");
  const count = el("problemsCount");
  body.innerHTML = "";
  if (!problems.length) {
    body.innerHTML = `<div class="problems-empty" id="problemsEmpty">Brak błędów kompilacji — uruchom program (▶), aby sprawdzić.</div>`;
    count.hidden = true;
  } else {
    count.hidden = false;
    count.textContent = String(problems.length);
    problems.forEach(p => {
      const item = document.createElement("div");
      item.className = "problem-item";
      const loc = p.line != null ? `${p.fileName}:${p.line}:${p.col}` : p.fileName;
      item.innerHTML = `<span class="loc">${loc}</span><span class="msg">${p.message}</span>`;
      item.addEventListener("click", () => jumpToProblem(p));
      body.appendChild(item);
    });
  }
}
function jumpToProblem(p) {
  const f = files.find(x => x.name === p.fileName);
  if (!f) return;
  switchTo(f.id);
  if (p.line != null) {
    const lines = codeInput.value.split("\n");
    let offset = 0;
    for (let i = 0; i < p.line - 1 && i < lines.length; i++) offset += lines[i].length + 1;
    offset += Math.max(0, (p.col || 1) - 1);
    codeInput.focus();
    codeInput.selectionStart = codeInput.selectionEnd = offset;
    updateStatus();
  }
  setTerminalTab("terminal");
}

function setTerminalTab(tabName) {
  const isTerminal = tabName === "terminal";
  el("terminalBody").hidden = !isTerminal;
  el("problemsBody").hidden = isTerminal;
  el("terminalInputRow").hidden = !isTerminal;
  el("tabTerminal").classList.toggle("active", isTerminal);
  el("tabProblems").classList.toggle("active", !isTerminal);
  if (isTerminal) termInput.focus();
}
el("tabTerminal").addEventListener("click", () => setTerminalTab("terminal"));
el("tabProblems").addEventListener("click", () => setTerminalTab("problems"));

function lsLong() {
  logTerm(`total ${files.length * 4}`, "out");
  files.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(f => {
    const perm = "-rw-r--r--";
    logTerm(`${perm}  1 ${USER}  staff  ${fmtSize(f.content.length)}  ${fmtDate()} ${f.name}${f.dirty ? "" : ""}`, "out");
  });
}

function catFile(args) {
  let numbered = false;
  const names = [];
  args.forEach(a => a === "-n" ? (numbered = true) : names.push(a));
  if (!names.length) { logTerm("użycie: cat [-n] <plik...>", "err"); return; }
  names.forEach(name => {
    const f = files.find(x => x.name === name);
    if (!f) { logTerm(`cat: ${name}: No such file or directory`, "err"); return; }
    const lines = f.content.split("\n");
    lines.forEach((l, i) => logTerm(numbered ? `${String(i + 1).padStart(6, " ")}\t${l}` : l, "out"));
  });
}

function grepFile(pattern, name) {
  const f = files.find(x => x.name === name);
  if (!f) { logTerm(`grep: ${name}: No such file or directory`, "err"); return; }
  let re;
  try { re = new RegExp(pattern); } catch { logTerm(`grep: nieprawidłowe wyrażenie: ${pattern}`, "err"); return; }
  const lines = f.content.split("\n");
  let hit = false;
  lines.forEach((l, i) => { if (re.test(l)) { hit = true; logTerm(`${name}:${i + 1}:${l}`, "out"); } });
  if (!hit) statusMsg.textContent = `grep: brak dopasowań dla "${pattern}"`;
}

function wcFile(name) {
  const f = files.find(x => x.name === name);
  if (!f) { logTerm(`wc: ${name}: No such file or directory`, "err"); return; }
  const lines = f.content.split("\n").length;
  const words = f.content.trim().split(/\s+/).filter(Boolean).length;
  logTerm(`${String(lines).padStart(7)} ${String(words).padStart(7)} ${String(f.content.length).padStart(7)} ${name}`, "out");
}

function headTail(name, count, fromEnd) {
  const f = files.find(x => x.name === name);
  if (!f) { logTerm(`${fromEnd ? "tail" : "head"}: ${name}: No such file or directory`, "err"); return; }
  const lines = f.content.split("\n");
  const slice = fromEnd ? lines.slice(-count) : lines.slice(0, count);
  slice.forEach(l => logTerm(l, "out"));
}

const MAN_PAGES = {
  gnatmake: "GNATMAKE(1)\n\n    gnatmake [opcje] plik.adb\n\n    Kompiluje, wiąże (bind) i linkuje program Ada w jednym kroku.\n    Typowe opcje: -O2 (optymalizacja), -g (debug), -gnatwa (wszystkie ostrzeżenia).",
  gnat: "GNAT(1)\n\n    gnat COMMAND [args]\n\n    Sterownik narzędzi GNAT: gnat make, gnat compile, gnat pretty,\n    gnat metric, gnat list, gnat find.",
  ls: "LS(1)\n\n    ls [-la]\n\n    Wypisuje pliki bieżącego katalogu projektu.",
  cat: "CAT(1)\n\n    cat [-n] plik...\n\n    Wypisuje zawartość plików. -n numeruje wiersze.",
};

async function handleCommand(raw) {
  const cmd = raw.trim();
  if (!cmd) return;
  logTerm(cmd, "cmd");
  history.push(cmd);
  historyIdx = history.length;

  // very small shell tokenizer with support for `&&` and `> file` redirection
  const segments = cmd.split(/\s*&&\s*/);
  for (const segment of segments) {
    let allParts = (segment.trim().match(/(?:[^\s"]+|"[^"]*")+/g) || []).map(p => p.replace(/^"|"$/g, ""));
    let redirectFile = null;
    const gtIdx = allParts.indexOf(">");
    if (gtIdx !== -1) { redirectFile = allParts[gtIdx + 1]; allParts = allParts.slice(0, gtIdx); }

    const parts = allParts;
    const head = parts[0] || "";
    const rest = parts.slice(1);
    const arg = rest.join(" ");
    const lhead = head.toLowerCase();

    if (redirectFile) redirectCapture = [];

    switch (lhead) {
      case "help":
        logTerm("Polecenia powłoki:", "info");
        [
          "ls [-la]                     — lista plików projektu",
          "cat [-n] <plik>               — wyświetla zawartość pliku",
          "head/tail [-N] <plik>         — pierwsze/ostatnie N wierszy (domyślnie 10)",
          "grep <wzorzec> <plik>         — szuka dopasowań wyrażenia regularnego",
          "wc <plik>                     — liczba wierszy/słów/znaków",
          "diff <a> <b>                  — porównuje dwa pliki",
          "ps                            — lista 'procesów' (skompilowanych programów)",
          "echo \"tekst\" > plik.adb       — przekierowuje wynik do pliku",
          "touch <plik>                  — tworzy pusty plik",
          "rm <plik>                     — usuwa plik",
          "mv <a> <b> / cp <a> <b>       — zmienia nazwę / kopiuje plik",
          "",
          "gnatmake <plik.adb>           — kompiluje program (gcc → gnatbind → gnatlink)",
          "./<program>                   — uruchamia skompilowany plik binarny",
          "gnatmake <plik> && ./<prog>   — kompiluje i od razu uruchamia",
          "run | rebuild                 — kompiluje i uruchamia aktualnie otwarty plik",
          "gnat --version                — wersja kompilatora",
          "gprbuild                      — buduje cały projekt (wszystkie pliki .adb)",
          "",
          "ada-doc <słowo>               — ściąga składniowa Ady (np. ada-doc for)",
          "man <polecenie>               — strona podręcznika",
          "history                       — historia poleceń",
          "echo [-n] <tekst>             — wypisuje tekst",
          "whoami / date / pwd / uname   — informacje systemowe",
          "clear                         — czyści terminal",
        ].forEach(l => logTerm(l ? "  " + l : "", "out"));
        break;

      case "clear":
        termBody.innerHTML = "";
        break;

      case "ls":
        if (rest.includes("-la") || rest.includes("-l") || rest.includes("-al")) lsLong();
        else files.forEach(f => logTerm(f.name, "out"));
        break;

      case "cat":
        if (!rest.length) { logTerm("użycie: cat [-n] <plik>", "err"); break; }
        catFile(rest);
        break;

      case "head":
      case "tail": {
        let n = 10, target = rest[0];
        if (rest[0] && rest[0].startsWith("-")) { n = parseInt(rest[0].slice(1), 10) || 10; target = rest[1]; }
        if (!target) { logTerm(`użycie: ${lhead} [-N] <plik>`, "err"); break; }
        headTail(target, n, lhead === "tail");
        break;
      }

      case "grep":
        if (rest.length < 2) { logTerm("użycie: grep <wzorzec> <plik>", "err"); break; }
        grepFile(rest[0], rest[1]);
        break;

      case "wc":
        if (!rest[0]) { logTerm("użycie: wc <plik>", "err"); break; }
        wcFile(rest[0]);
        break;

      case "diff": {
        if (rest.length < 2) { logTerm("użycie: diff <plik_a> <plik_b>", "err"); break; }
        const a = files.find(x => x.name === rest[0]);
        const b = files.find(x => x.name === rest[1]);
        if (!a || !b) { logTerm(`diff: ${!a ? rest[0] : rest[1]}: No such file or directory`, "err"); break; }
        const la = a.content.split("\n"), lb = b.content.split("\n");
        const max = Math.max(la.length, lb.length);
        let same = true;
        for (let i = 0; i < max; i++) {
          if (la[i] !== lb[i]) {
            same = false;
            if (la[i] !== undefined) logTerm(`< ${la[i]}`, "err");
            if (lb[i] !== undefined) logTerm(`> ${lb[i]}`, "ok");
          }
        }
        if (same) logTerm(`Pliki ${rest[0]} i ${rest[1]} są identyczne.`, "out");
        break;
      }

      case "ps":
        logTerm("  PID TTY          TIME CMD", "out");
        Array.from(compiledBinaries).forEach((exe, i) => logTerm(`${String(1000 + i).padStart(5)} ttys000    00:00:0${i} ./${exe}`, "out"));
        logTerm(`${String(999).padStart(5)} ttys000    00:00:01 -zsh`, "out");
        break;

      case "touch":
        if (!rest[0]) { logTerm("użycie: touch <plik>", "err"); break; }
        if (!files.find(x => x.name === rest[0])) createFile(rest[0], "");
        break;

      case "rm":
        if (!rest[0]) { logTerm("użycie: rm <plik>", "err"); break; }
        {
          const f = files.find(x => x.name === rest[0]);
          if (!f) { logTerm(`rm: ${rest[0]}: No such file or directory`, "err"); break; }
          closeFile(f.id);
        }
        break;

      case "mv":
      case "cp": {
        if (rest.length < 2) { logTerm(`użycie: ${lhead} <źródło> <cel>`, "err"); break; }
        const src = files.find(x => x.name === rest[0]);
        if (!src) { logTerm(`${lhead}: ${rest[0]}: No such file or directory`, "err"); break; }
        if (lhead === "mv") { src.name = rest[1]; renderAll(); saveState(); }
        else createFile(rest[1], src.content);
        break;
      }

      case "run":
      case "rebuild":
        try { await runCurrentFile(); } catch { /* error already logged */ }
        break;

      case "gnatmake":
      case "gnat": {
        if (lhead === "gnat" && rest[0] && rest[0] !== "make") {
          if (rest[0] === "--version" || rest[0] === "version") {
            logTerm("GNAT Community 13.2.0 (20240301)", "out");
            logTerm("Copyright 1996-2024, Free Software Foundation, Inc.", "out");
            break;
          }
          logTerm(`gnat: unknown command "${rest[0]}"`, "err");
          break;
        }
        const args = lhead === "gnat" ? rest.slice(1) : rest;
        const target = args.find(a => !a.startsWith("-")) || getActive()?.name;
        if (!target) { logTerm("gnatmake: file name missing", "err"); break; }
        try { await gnatmake(target, false); } catch { /* error already logged */ }
        break;
      }

      case "gprbuild":
        logTerm("gprbuild: building all units in project", "info");
        for (const f of files.filter(f => /\.(adb)$/i.test(f.name))) {
          try { await gnatmake(f.name, false); } catch { /* continue */ }
        }
        logTerm("Build complete.", "ok");
        break;

      case "which":
        if (["gnat", "gnatmake", "gnatbind", "gnatlink", "gprbuild"].includes((rest[0] || "").toLowerCase())) {
          logTerm(`/usr/local/gnat/bin/${rest[0].toLowerCase()}`, "out");
        } else {
          logTerm(`${rest[0]} not found`, "err");
        }
        break;

      case "man":
        if (!rest[0]) { logTerm("Co to za polecenie? Spróbuj: man gnatmake", "err"); break; }
        if (MAN_PAGES[rest[0].toLowerCase()]) {
          MAN_PAGES[rest[0].toLowerCase()].split("\n").forEach(l => logTerm(l, "out"));
        } else {
          logTerm(`No manual entry for ${rest[0]}`, "err");
        }
        break;

      case "ada-doc": {
        const key = arg.toLowerCase();
        if (ADA_HELP[key]) logTerm(ADA_HELP[key], "info");
        else logTerm(`Brak wpisu dla '${arg}'. Spróbuj: ${Object.keys(ADA_HELP).join(", ")}`, "err");
        break;
      }

      case "history":
        history.forEach((h, i) => logTerm(`${String(i + 1).padStart(4)}  ${h}`, "out"));
        break;

      case "echo": {
        const noNewline = rest[0] === "-n";
        logTerm((noNewline ? rest.slice(1) : rest).join(" "), "out");
        break;
      }

      case "whoami":
        logTerm(USER, "out");
        break;
      case "date":
        logTerm(new Date().toString(), "out");
        break;
      case "pwd":
        logTerm(CWD, "out");
        break;
      case "uname":
        logTerm(rest.includes("-a") ? `AdaStudioOS ${HOSTNAME} 1.0 x86_64` : "AdaStudioOS", "out");
        break;
      case "exit":
      case "logout":
        logTerm("logout", "info");
        break;

      default:
        if (lhead.startsWith("./")) {
          await runBinary(lhead.slice(2));
        } else if (lhead === "new") {
          if (!arg) { logTerm("użycie: new <nazwa_pliku>", "err"); break; }
          createFile(arg, "");
        } else if (lhead === "open") {
          const f = files.find(x => x.name === arg);
          if (!f) { logTerm(`open: ${arg}: No such file or directory`, "err"); break; }
          switchTo(f.id);
        } else {
          logTerm(`zsh: command not found: ${head}`, "err");
        }
    }

    if (redirectFile) {
      const content = redirectCapture.join("\n") + (redirectCapture.length ? "\n" : "");
      redirectCapture = null;
      const existing = files.find(x => x.name === redirectFile);
      if (existing) { existing.content = content; existing.dirty = true; renderAll(); saveState(); }
      else createFile(redirectFile, content);
      logTerm(`(zapisano do ${redirectFile})`, "info");
    }
  }
}

termInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const val = termInput.value;
    termInput.value = "";
    if (pendingInputResolve) {
      logTerm(val, "out"); // echo what the running program just read as stdin
      const resolve = pendingInputResolve;
      pendingInputResolve = null;
      resolve(val);
      return;
    }
    handleCommand(val);
  } else if (pendingInputResolve) {
    // while a program is blocked on Get/Get_Line, the input row is its stdin —
    // shell history/tab-completion don't apply
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (historyIdx > 0) { historyIdx--; termInput.value = history[historyIdx] || ""; }
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (historyIdx < history.length - 1) { historyIdx++; termInput.value = history[historyIdx] || ""; }
    else { historyIdx = history.length; termInput.value = ""; }
  } else if (e.key === "Tab") {
    e.preventDefault();
    const partial = termInput.value.split(/\s+/).pop();
    const match = files.map(f => f.name).find(n => n.startsWith(partial));
    if (match) termInput.value = termInput.value.slice(0, -partial.length) + match;
  } else if (e.ctrlKey && e.key.toLowerCase() === "l") {
    e.preventDefault();
    termBody.innerHTML = "";
  }
});

el("btnTermClear").addEventListener("click", () => termBody.innerHTML = "");
el("btnTermHelp").addEventListener("click", () => handleCommand("help"));

// ---------- init ----------
loadState();
loadSettings();
applyTheme(localStorage.getItem("adastudio.theme") || "dark");
document.documentElement.style.setProperty("--code-size", "13.5px");
document.documentElement.style.setProperty("--code-lh", "21px");
renderAll();
renderSnippets();
renderProblems();
bootTerminal();
