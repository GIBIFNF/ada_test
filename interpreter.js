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

  parseStatement() {
    if (this.atKeyword("if")) return this.parseIf();
    if (this.atKeyword("for")) return this.parseFor();
    if (this.atKeyword("while")) return this.parseWhile();
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
        args.push(this.parseExpr());
        while (this.atOp(",")) { this.next(); args.push(this.parseExpr()); }
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
      this.expectOp(";");
      return { kind: "null" };
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
            args.push(this.parseExpr());
            while (this.atOp(",")) { this.next(); args.push(this.parseExpr()); }
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
    if (t.type === "number") { this.next(); return { kind: "lit", value: parseFloat(t.value), isFloat: t.value.includes(".") }; }
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
          args.push(this.parseExpr());
          while (this.atOp(",")) { this.next(); args.push(this.parseExpr()); }
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

class Interpreter {
  constructor(onOutput) {
    this.onOutput = onOutput || (() => {});
    this.line = "";
    this.stepCount = 0;
  }

  run(source) {
    const tokens = new Lexer(source).tokens;
    const program = new Parser(tokens).parseProgram();
    const rootEnv = new Env(null);
    this.declareBlock(program.decls, rootEnv);
    try {
      this.execStatements(program.body, rootEnv);
    } catch (err) {
      if (err instanceof AdaError && program.handlers && this.tryHandle(err, program.handlers, rootEnv)) {
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
    if (t === "string") return "";
    if (t === "character") return " ";
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

  execStatements(stmts, env) {
    for (const s of stmts) this.execStatement(s, env);
  }

  tryHandle(err, handlers, env) {
    const excName = (err.message.match(/raised\s+(\S+)/i)?.[1] || "").replace(/[:.]$/, "").toUpperCase();
    for (const h of handlers) {
      if (h.names.includes("others") || h.names.some(n => n.toUpperCase() === excName)) {
        this.execStatements(h.body, env);
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
        const idx = this.evalExpr(seg.args[0], env);
        if (idx < value.low || idx > value.high) throw new AdaError(`raised CONSTRAINT_ERROR : index check failed`, line, col);
        return value.items[idx - value.low];
      }
      if (typeof value === "string") {
        const idx = this.evalExpr(seg.args[0], env);
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

  execStatement(s, env) {
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
          const idx = this.evalExpr(last.args[0], env);
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
        this.execCall(s.name, s.args, env, s.line, s.col);
        return;
      case "if": {
        for (const b of s.branches) {
          if (this.evalExpr(b.cond, env) === true) { this.execStatements(b.body, env); return; }
        }
        if (s.elseStmts) this.execStatements(s.elseStmts, env);
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
          if (hit) { this.execStatements(w.body, env); return; }
        }
        if (othersBranch) { this.execStatements(othersBranch.body, env); return; }
        throw new AdaError(`raised CONSTRAINT_ERROR : case selector out of range`, s.line, s.col);
      }
      case "declare": {
        const childEnv = new Env(env);
        this.declareBlock(s.decls, childEnv);
        try {
          this.execStatements(s.body, childEnv);
        } catch (err) {
          if (err instanceof AdaError && s.handlers && this.tryHandle(err, s.handlers, childEnv)) return;
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
        if (s.reverse) {
          for (let i = to; i >= from; i--) { entry.value = i; this.execStatements(s.body, env); }
        } else {
          for (let i = from; i <= to; i++) { entry.value = i; this.execStatements(s.body, env); }
        }
        if (prevEntry) env.vars.set(s.varName.toLowerCase(), prevEntry); else env.vars.delete(s.varName.toLowerCase());
        return;
      }
      case "while": {
        while (this.evalExpr(s.cond, env) === true) {
          this.execStatements(s.body, env);
          this.bump();
        }
        return;
      }
      case "return":
        throw new ReturnSignal(s.expr != null ? this.evalExpr(s.expr, env) : undefined);
      case "raise": {
        const detail = s.msg ? ` : ${s.msg}` : "";
        throw new AdaError(`raised ${s.excName.toUpperCase()}${detail}`, s.line, s.col);
      }
      case "exit":
        return; // best-effort: real Ada `exit` breaks the innermost loop; not needed for straight-line student programs
      default:
        throw new AdaError(`unsupported statement: ${s.kind}`);
    }
  }

  execCall(name, args, env, line, col) {
    const lname = name.toLowerCase();
    if (lname === "put_line") {
      this.flushLine();
      this.onOutput(this.stringify(this.evalExpr(args[0], env)));
      return;
    }
    if (lname === "put") {
      this.line += this.stringify(this.evalExpr(args[0], env));
      return;
    }
    if (lname === "new_line") {
      this.flushLine();
      this.onOutput("");
      return;
    }
    const sub = env.getSub(name);
    if (sub) { this.callSub(sub, args, env); return; }
    throw new AdaError(`"${name}" is undefined`, line, col);
  }

  callSub(sub, argExprs, callerEnv) {
    if (argExprs.length !== sub.params.length) {
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
      this.execStatements(sub.body, newEnv);
    } catch (err) {
      if (err instanceof ReturnSignal) {
        result = err.value; returned = true;
      } else if (err instanceof AdaError && sub.handlers) {
        try {
          if (!this.tryHandle(err, sub.handlers, newEnv)) throw err;
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
        if (!entry) throw new AdaError(`"${e.name}" is undefined`, e.line, e.col);
        return entry.value;
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
        return v;
      }
      case "attrcall": {
        const argv = e.args.map(a => this.evalExpr(a, env));
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
            const idx = this.evalExpr(e.args[0], env);
            if (idx < entry.value.low || idx > entry.value.high) {
              throw new AdaError(`raised CONSTRAINT_ERROR : index check failed`, e.line, e.col);
            }
            return entry.value.items[idx - entry.value.low];
          }
          if (typeof entry.value === "string") {
            const idx = this.evalExpr(e.args[0], env);
            if (idx < 1 || idx > entry.value.length) {
              throw new AdaError(`raised CONSTRAINT_ERROR : index check failed`, e.line, e.col);
            }
            return entry.value[idx - 1];
          }
        }
        const sub = env.getSub(e.name);
        if (sub) {
          if (sub.kind !== "function") throw new AdaError(`"${e.name}" is not a function`, e.line, e.col);
          return this.callSub(sub, e.args, env);
        }
        if (["integer", "float", "natural", "positive"].includes(lname)) {
          return e.args.length ? this.evalExpr(e.args[0], env) : 0;
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

function runAdaProgram(source, onOutput) {
  const interp = new Interpreter(onOutput);
  return interp.run(source);
}
