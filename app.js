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
  "integer'image": "Integer'Image(X) — zamienia liczbę całkowitą na String (ze spacją wiodącą dla liczb dodatnich).",
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
const ADA_ATTRIBUTES = ["Image", "Value", "First", "Last", "Length", "Val", "Pos"];

// Only the subprograms execCall() in interpreter.js actually knows how to run.
const ADA_BUILTINS = [
  { name: "Put_Line", insertText: 'Put_Line("");', cursorOffset: 'Put_Line("'.length },
  { name: "Put", insertText: 'Put("");', cursorOffset: 'Put("'.length },
  { name: "New_Line", insertText: "New_Line;" },
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

function runCurrentFile() {
  const f = getActive();
  if (!f) return;
  try { gnatmake(f.name, true); } catch { /* error already logged to terminal + problems panel */ }
}
el("btnRun").addEventListener("click", runCurrentFile);

function gnatmake(target, autoRun) {
  const f = files.find(x => x.name === target);
  if (!f) {
    logTerm(`gnatmake: "${target}" not found, use -P<project> if this is a multi-unit project`, "err");
    return;
  }
  const exe = baseName(f.name);
  logTerm(`gcc -c -gnatQ ${f.name}`, "info");
  clearProblemsFor(f.name);
  try {
    const output = [];
    runAdaProgram(f.content, (line) => output.push(line));
    logTerm(`gnatbind -x ${exe}.ali`, "info");
    logTerm(`gnatlink ${exe}.ali`, "info");
    compiledBinaries.add(exe);
    statusMsg.textContent = "Kompilacja zakończona sukcesem";
    toast(`${f.name}: kompilacja OK`, "ok");
    if (autoRun) {
      logTerm(`./${exe}`, "cmd");
      output.forEach(line => logTerm(line, "out"));
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

function runBinary(exe) {
  if (!compiledBinaries.has(exe)) {
    logTerm(`zsh: no such file or directory: ./${exe}`, "err");
    return;
  }
  const f = files.find(x => baseName(x.name) === exe);
  if (!f) { logTerm(`zsh: no such file or directory: ./${exe}`, "err"); return; }
  try {
    const output = [];
    runAdaProgram(f.content, (line) => output.push(line));
    output.forEach(line => logTerm(line, "out"));
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

function handleCommand(raw) {
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
        try { runCurrentFile(); } catch { /* error already logged */ }
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
        try { gnatmake(target, false); } catch { /* error already logged */ }
        break;
      }

      case "gprbuild":
        logTerm("gprbuild: building all units in project", "info");
        files.filter(f => /\.(adb)$/i.test(f.name)).forEach(f => {
          try { gnatmake(f.name, false); } catch { /* continue */ }
        });
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
          runBinary(lhead.slice(2));
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
    handleCommand(val);
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
