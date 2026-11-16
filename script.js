// 色の名前は画面に出さず、読み上げ用にだけ使う(見た目は style.css の .c0〜.c9)
const COLORS = ["青", "赤", "緑", "黄", "桃", "白", "橙", "紫", "水", "茶"];
const MAX_TURNS = 10;
const CPU_DELAY = 800; // CPUが次の予想を出すまでの時間(ミリ秒)

const $ = (id) => document.getElementById(id);
const slotsSelect = $("slots");
const limitSelect = $("limit");
const modeSelect = $("mode");

let slots, colorCount, answer, guess, log, over;
let limitSec, remaining, endAt, timerId = null;
let secret, cpuLog, turn;            // 対戦モード用
let mode, phase, candidates, cpuTimer; // phase: "set"=自分の答えを決める / "run"=CPUが予想中 / "play"=対戦中

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeBall(index, tag = "span") {
  const b = document.createElement(tag);
  b.className = "ball c" + index;
  if (tag === "button") {
    b.type = "button";
    b.setAttribute("aria-label", COLORS[index]);
  }
  return b;
}

function makeSlot() {
  const s = document.createElement("span");
  s.className = "slot";
  return s;
}

// HIT=色も位置も一致 / BLOW=色だけ一致(同じ色を重ねた予想でも数え過ぎない)
function judge(ans, g) {
  const hit = g.filter((c, i) => c === ans[i]).length;
  let common = 0;
  for (let c = 0; c < COLORS.length; c++) {
    common += Math.min(ans.filter((x) => x === c).length, g.filter((x) => x === c).length);
  }
  return { hit, blow: common - hit };
}

function newGame() {
  mode = modeSelect.value;
  const cpu = mode === "cpu";
  const multi = mode !== "player"; // CPUが予想するモード(CPU・対戦)
  // CPUは候補を全部数え上げるので、ボールは8個まで
  [...slotsSelect.options].forEach((o) => { o.disabled = multi && Number(o.value) > 8; });
  if (multi && Number(slotsSelect.value) > 8) slotsSelect.value = "8";
  limitSelect.disabled = multi;
  clearTimeout(cpuTimer);
  phase = "set";

  slots = Number(slotsSelect.value);
  colorCount = Math.max(6, slots);
  const size = slots <= 6 ? 42 : slots <= 8 ? 36 : 30;
  document.documentElement.style.setProperty("--ball", size + "px");

  answer = cpu ? [] : shuffle([...Array(colorCount).keys()]).slice(0, slots);
  guess = [];
  log = [];
  cpuLog = [];
  secret = [];
  turn = "player";
  over = false;

  stopTimer();
  limitSec = multi ? 0 : Number(limitSelect.value) * 60;
  remaining = limitSec;
  $("timer").hidden = !limitSec;
  showTimer();

  $("message").textContent = "";
  $("restart").hidden = true;
  render();
}

// 1枚の盤を描く。1ターン=1本の縦の列(上に ヒット/ブロー の穴、下にボールの穴)+右端に「答え」の列
function drawBoard(el, o) {
  el.replaceChildren();
  el.style.setProperty("--n", slots);
  el.style.setProperty("--kc", Math.ceil(slots / 2));
  const ncols = mode === "player" ? MAX_TURNS : Math.max(MAX_TURNS, o.rows.length + (over ? 0 : 1));

  const cols = document.createElement("div");
  cols.className = "cols";
  for (let i = 0; i < ncols; i++) {
    const r = o.rows[i];
    const col = document.createElement("div");
    col.className = "col" + (i === o.activeCol ? " active" : "");
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = i + 1;
    const keys = document.createElement("div");
    keys.className = "keys";
    const holes = document.createElement("div");
    holes.className = "holes";
    for (let k = 0; k < slots; k++) {
      const key = document.createElement("span");
      key.className = "key" + (r ? (k < r.hit ? " hit" : k < r.hit + r.blow ? " blow" : "") : "");
      keys.append(key);
      if (r) {
        holes.append(makeBall(r.guess[k]));
      } else if (i === o.activeCol && k < o.draft.length) {
        holes.append(removable(o.draft[k], k, o.editable));
      } else {
        holes.append(makeSlot());
      }
    }
    col.append(num, keys, holes);
    cols.append(col);
  }

  const a = document.createElement("div");
  a.className = "col answer";
  const num = document.createElement("div");
  num.className = "num";
  num.textContent = "答え";
  const keys = document.createElement("div");
  keys.className = "keys blank";
  for (let k = 0; k < slots; k++) keys.append(Object.assign(document.createElement("span"), { className: "key" }));
  const holes = document.createElement("div");
  holes.className = "holes";
  if (o.answerMode === "cover") {
    holes.classList.add("cover");
    holes.textContent = "?";
  } else {
    for (let k = 0; k < slots; k++) {
      if (o.answerMode === "input" && k < o.draft.length) holes.append(removable(o.draft[k], k, o.editable));
      else if (o.answerMode === "show" && o.ans[k] !== undefined) holes.append(makeBall(o.ans[k]));
      else holes.append(makeSlot());
    }
  }
  a.append(num, keys, holes);
  el.append(cols, a);

  // 光っている列(なければ最後の列)が見える位置へ
  if (o.answerMode === "input") {
    el.scrollLeft = el.scrollWidth;
  } else {
    const act = el.querySelector(".col.active") || el.querySelector(".cols .col:nth-child(" + Math.max(1, o.rows.length) + ")");
    if (act) {
      const left = act.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
      el.scrollLeft = left - el.clientWidth / 2 + act.offsetWidth / 2;
    }
  }
}

// 入れたボール(クリックで外せる)
function removable(index, k, editable) {
  const b = makeBall(index, "button");
  b.title = "クリックで外す";
  b.disabled = !editable;
  b.onclick = () => { guess.splice(k, 1); render(); };
  return b;
}

function render() {
  const cpuTurn = mode === "versus" && phase === "play" && turn === "cpu";
  const lock = over || cpuTurn;
  const setting = (mode === "cpu" || mode === "versus") && phase === "set"; // 自分の答えを決める場面

  $("cpuWrap").hidden = mode !== "versus";
  $("play").hidden = mode === "cpu" && phase === "run";

  let title, o;
  if (mode === "player") {
    title = over ? `${log.length}回で終了` : `あなたの予想(${log.length + 1} / ${MAX_TURNS} 回目)`;
    o = { rows: log, ans: answer, answerMode: over ? "show" : "cover", activeCol: over ? -1 : log.length, draft: guess };
  } else if (mode === "cpu") {
    title = phase === "set" ? "CPUの予想(あなたの答えが決まると始まります)" : `CPUの予想(${log.length}回目まで)`;
    o = { rows: log, ans: answer, answerMode: setting ? "input" : "show", activeCol: phase === "run" && !over ? log.length : -1, draft: setting ? guess : [] };
  } else {
    const mine = phase === "play" && turn === "player" && !over;
    title = `あなたの盤:CPUの答えを当てる(${log.length}回目まで)`;
    o = { rows: log, ans: answer, answerMode: over ? "show" : "cover", activeCol: mine ? log.length : -1, draft: mine ? guess : [] };
  }
  $("mainTitle").textContent = title;
  drawBoard($("mainBoard"), { ...o, editable: !lock });

  if (mode === "versus") {
    drawBoard($("cpuBoard"), {
      rows: cpuLog, ans: secret, answerMode: setting ? "input" : "show",
      activeCol: cpuTurn ? cpuLog.length : -1, draft: setting ? guess : [], editable: !lock,
    });
  }

  // 色えらび
  $("playTitle").textContent = setting ? "あなたの答えを並べてください(同じ色は使えません)" : "色をえらんで、ボールを並べよう";
  const pal = $("palette");
  pal.replaceChildren();
  for (let i = 0; i < colorCount; i++) {
    const b = makeBall(i, "button");
    b.disabled = lock || guess.length >= slots || (setting && guess.includes(i));
    b.onclick = () => { guess.push(i); startTimer(); render(); };
    pal.append(b);
  }
  $("submit").disabled = lock || guess.length !== slots;
  $("clear").disabled = lock || guess.length === 0;
}

// ===== 制限時間 =====
function showTimer() {
  const m = String(Math.floor(remaining / 60)).padStart(2, "0");
  const s = String(remaining % 60).padStart(2, "0");
  const t = $("timer");
  t.textContent = `残り ${m}:${s}` + (timerId || over ? "" : "(最初のボールを置くとスタート)");
  t.classList.toggle("warn", limitSec > 0 && remaining <= 10);
}

function startTimer() {
  if (!limitSec || timerId) return;
  endAt = Date.now() + remaining * 1000;
  timerId = setInterval(() => {
    remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    showTimer();
    if (remaining === 0) timeUp();
  }, 250);
  showTimer();
}

function stopTimer() {
  clearInterval(timerId);
  timerId = null;
}

function timeUp() {
  stopTimer();
  over = true;
  guess = [];
  $("message").textContent = "時間切れです。正解は右の「答え」でした";
  $("restart").hidden = false;
  render();
}

// ===== CPUモード =====
// n色からk個を重ならないように並べた全パターン
function permutations(n, k) {
  const out = [], used = Array(n).fill(false), cur = [];
  (function go() {
    if (cur.length === k) { out.push([...cur]); return; }
    for (let c = 0; c < n; c++) {
      if (used[c]) continue;
      used[c] = true; cur.push(c);
      go();
      cur.pop(); used[c] = false;
    }
  })();
  return out;
}

function startCpu() {
  answer = [...guess];
  guess = [];
  phase = "run";
  candidates = permutations(colorCount, slots);
  render();
  cpuTimer = setTimeout(cpuStep, CPU_DELAY);
}

// 今までの結果と矛盾しない候補の中から、ランダムに1つ予想する
function cpuStep() {
  const vs = mode === "versus";
  const target = vs ? secret : answer;
  const hist = vs ? cpuLog : log;
  const g = candidates[Math.floor(Math.random() * candidates.length)];
  const r = judge(target, g);
  hist.push({ guess: g, hit: r.hit, blow: r.blow });

  if (r.hit === slots) {
    over = true;
    $("message").textContent = vs
      ? `CPUの勝ちです(CPUは${hist.length}回で当てました)`
      : `CPUは${hist.length}回で当てました`;
    $("restart").hidden = false;
  } else {
    candidates = candidates.filter((c) => {
      const x = judge(c, g);
      return x.hit === r.hit && x.blow === r.blow;
    });
    if (vs) {
      turn = "player";
      $("message").textContent = "あなたの番です";
    } else {
      cpuTimer = setTimeout(cpuStep, CPU_DELAY);
    }
  }
  render();
}

// 対戦モード: 自分の答えが決まったので開始(自分が先攻)
function startVersus() {
  secret = [...guess];
  guess = [];
  phase = "play";
  turn = "player";
  candidates = permutations(colorCount, slots);
  $("message").textContent = "あなたの番です";
  render();
}

// ===== 決定 =====
function submit() {
  if (mode === "cpu") { startCpu(); return; }
  if (mode === "versus" && phase === "set") { startVersus(); return; }
  const { hit, blow } = judge(answer, guess);
  log.push({ guess: [...guess], hit, blow });
  guess = [];

  if (hit === slots) {
    over = true;
    $("message").textContent = mode === "versus"
      ? `あなたの勝ちです(${log.length}回で当てました)`
      : `正解です。${log.length}回でクリアしました`;
  } else if (mode === "versus") {
    turn = "cpu";
    $("message").textContent = "CPUが考え中…";
    cpuTimer = setTimeout(cpuStep, CPU_DELAY);
  } else if (log.length >= MAX_TURNS) {
    over = true;
    $("message").textContent = "ゲームオーバーです。正解は右の「答え」でした";
  }
  if (over) stopTimer();
  $("restart").hidden = !over;
  render();
}

$("submit").onclick = submit;
$("clear").onclick = () => { guess = []; render(); };
$("restart").onclick = newGame;
slotsSelect.onchange = newGame;
limitSelect.onchange = newGame;
modeSelect.onchange = newGame;

// ===== オープニング と ルール説明 =====
// 「次回から説明を表示しない」は、このブラウザの localStorage に覚えておく
const SKIP_KEY = "hb_skip_rules";
const intro = $("intro");
const ruleSteps = document.querySelectorAll(".rule-step");
let introStage = "closed"; // "title"=オープニング / "rules"=ルール説明 / "closed"
let introTimer = null, hideTimer = null;

function skipSaved() { try { return localStorage.getItem(SKIP_KEY) === "1"; } catch (e) { return false; } }
function saveSkip(on) { try { on ? localStorage.setItem(SKIP_KEY, "1") : localStorage.removeItem(SKIP_KEY); } catch (e) {} }

function openIntro(stage) {
  clearTimeout(hideTimer);
  intro.hidden = false;
  intro.classList.remove("out");
  document.body.classList.add("intro-open");
  document.querySelector(".page").inert = true; // 裏のゲームは触れないように
  showStage(stage);
  intro.focus();
}

function showStage(stage) {
  introStage = stage;
  clearTimeout(introTimer);
  $("introTitle").hidden = stage !== "title";
  $("introRules").hidden = stage !== "rules";
  if (stage === "title") {
    const t = $("introTitle");
    t.classList.remove("play");
    void t.offsetWidth; // アニメーションを最初からやり直す
    t.classList.add("play");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    introTimer = setTimeout(afterTitle, reduce ? 1200 : 3700);
  } else {
    $("ruleSkip").checked = skipSaved();
    showRule(0);
    $("ruleNext").focus();
  }
}

function afterTitle() {
  if (introStage !== "title") return;
  if (skipSaved()) closeIntro(); else showStage("rules");
}

function showRule(i) {
  ruleSteps.forEach((el, k) => { el.hidden = k !== i; });
  document.querySelectorAll(".dot").forEach((d, k) => d.classList.toggle("on", k === i));
  $("rulePrev").hidden = i === 0;
  $("ruleNext").textContent = i === ruleSteps.length - 1 ? "はじめる" : "次へ";
  intro.dataset.step = i;
}

function nextRule() {
  const i = Number(intro.dataset.step);
  if (i >= ruleSteps.length - 1) closeIntro(); else showRule(i + 1);
}

function closeIntro() {
  if (introStage === "closed") return;
  clearTimeout(introTimer);
  if (introStage === "rules") saveSkip($("ruleSkip").checked);
  introStage = "closed";
  intro.classList.add("out");
  document.body.classList.remove("intro-open");
  document.querySelector(".page").inert = false;
  hideTimer = setTimeout(() => { intro.hidden = true; }, 400);
}

$("introTitle").onclick = afterTitle;
$("ruleClose").onclick = closeIntro;
$("rulePrev").onclick = () => showRule(Number(intro.dataset.step) - 1);
$("ruleNext").onclick = nextRule;
$("helpBtn").onclick = () => openIntro("rules");
document.addEventListener("keydown", (e) => {
  if (introStage === "closed") return;
  if (e.key === "Escape") closeIntro();
  else if (introStage === "rules" && e.key === "ArrowRight") nextRule();
  else if (introStage === "rules" && e.key === "ArrowLeft" && Number(intro.dataset.step) > 0) showRule(Number(intro.dataset.step) - 1);
});

newGame();
openIntro("title");
