// 色の名前は画面に出さず、読み上げ用にだけ使う(見た目は style.css の .c0〜.c9)
const COLORS = ["青", "赤", "緑", "黄", "桃", "白", "橙", "紫", "水", "茶"];
const MAX_TURNS = 10;
const CPU_DELAY = 800; // CPUが次の予想を出すまでの時間(ミリ秒)

const $ = (id) => document.getElementById(id);
const slotsSelect = $("slots");
const limitSelect = $("limit");
const modeSelect = $("mode");

let slots, colorCount, answer, guess, sel, log, over; // sel=いま選んでいる穴の番号
let limitSec, remaining, endAt, timerId = null;
let secret, cpuLog, turn;            // 対戦モード用
let mode, phase, candidates, cpuTimer; // mode: "player"=自分が当てる / "versus"=交互に対戦。phase(対戦): "set"=自分の答えを決める / "play"=対戦中

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
  const multi = mode !== "player"; // CPUと対戦するモード
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

  answer = shuffle([...Array(colorCount).keys()]).slice(0, slots);
  guess = emptyGuess(); sel = 0;
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
      } else if (i === o.activeCol) {
        holes.append(holeBtn(k, o.draft[k], o.editable));
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
      if (o.answerMode === "input") holes.append(holeBtn(k, o.draft[k], o.editable));
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

// ===== 予想の入力(穴を選んで、その場所だけ入れ替えられる) =====
function emptyGuess() { return Array(slots).fill(null); }

function nextEmpty(from) {
  for (let d = 1; d <= slots; d++) {
    const k = (from + d) % slots;
    if (guess[k] === null) return k;
  }
  return -1;
}

// 色をえらんだ時: 選んでいる穴に入れて、次の空き穴へ進む(全部埋まっていれば、その穴のまま)
function placeColor(i) {
  const k = sel >= 0 && sel < slots ? sel : guess.indexOf(null);
  if (k < 0) return;
  guess[k] = i;
  const next = nextEmpty(k);
  sel = next >= 0 ? next : k;
  startTimer();
  render();
}

// 穴(ボール or 空き)。1回クリックで選ぶ / 選んでいるボールをもう1回クリックで外す
function holeBtn(k, c, editable) {
  let b;
  if (c === null) {
    b = document.createElement("button");
    b.type = "button";
    b.className = "slot";
    b.setAttribute("aria-label", "空きの穴");
  } else {
    b = makeBall(c, "button");
  }
  if (editable && k === sel) b.classList.add("sel");
  b.disabled = !editable;
  b.title = c === null ? "ここに入れる" : k === sel ? "もう一度クリックで外す" : "クリックで場所を選ぶ";
  b.onclick = () => {
    if (c !== null && k === sel) guess[k] = null;
    else sel = k;
    render();
  };
  return b;
}

function removeSelected() {
  if (sel >= 0 && guess[sel] !== null) { guess[sel] = null; render(); }
}

function render() {
  const cpuTurn = mode === "versus" && phase === "play" && turn === "cpu";
  const lock = over || cpuTurn;
  const setting = mode === "versus" && phase === "set"; // 自分の答えを決める場面

  $("cpuWrap").hidden = mode !== "versus";

  let title, o;
  if (mode === "player") {
    title = over ? `${log.length}回で終了` : `あなたの予想(${log.length + 1} / ${MAX_TURNS} 回目)`;
    o = { rows: log, ans: answer, answerMode: over ? "show" : "cover", activeCol: over ? -1 : log.length, draft: guess };
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
  $("playTitle").textContent = setting ? "あなたの答えを並べてください(同じ色は使えません)" : "色をえらんで、ボールを並べよう(穴をクリックすると、その場所だけ変えられます)";
  const pal = $("palette");
  pal.replaceChildren();
  for (let i = 0; i < colorCount; i++) {
    const b = makeBall(i, "button");
    // 答えを決める時は同じ色を使えない(いま選んでいる穴の色と同じなら、入れ替えはOK)
    b.disabled = lock || (setting && guess.includes(i) && guess[sel] !== i);
    b.onclick = () => placeColor(i);
    pal.append(b);
  }
  $("submit").disabled = lock || guess.includes(null);
  $("clear").disabled = lock || guess.every((c) => c === null);
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
  guess = emptyGuess(); sel = 0;
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

// CPUの1手: 今までの結果と矛盾しない候補の中から、ランダムに1つ予想する
function cpuStep() {
  const g = candidates[Math.floor(Math.random() * candidates.length)];
  const r = judge(secret, g);
  cpuLog.push({ guess: g, hit: r.hit, blow: r.blow });

  if (r.hit === slots) {
    over = true;
    $("message").textContent = `CPUの勝ちです(CPUは${cpuLog.length}回で当てました)`;
    $("restart").hidden = false;
  } else {
    candidates = candidates.filter((c) => {
      const x = judge(c, g);
      return x.hit === r.hit && x.blow === r.blow;
    });
    turn = "player";
    $("message").textContent = "あなたの番です";
  }
  render();
}

// 対戦モード: 自分の答えが決まったので開始(自分が先攻)
function startVersus() {
  secret = [...guess];
  guess = emptyGuess(); sel = 0;
  phase = "play";
  turn = "player";
  candidates = permutations(colorCount, slots);
  $("message").textContent = "あなたの番です";
  render();
}

// ===== 決定 =====
function submit() {
  if (mode === "versus" && phase === "set") { startVersus(); return; }
  const { hit, blow } = judge(answer, guess);
  log.push({ guess: [...guess], hit, blow });
  guess = emptyGuess(); sel = 0;

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
$("clear").onclick = () => { guess = emptyGuess(); sel = 0; render(); };
$("restart").onclick = newGame;
slotsSelect.onchange = newGame;
limitSelect.onchange = newGame;
modeSelect.onchange = newGame;

// ===== オープニング と ルール説明 =====
// 「次回から説明を表示しない」は、このブラウザの localStorage に覚えておく
const SKIP_KEY = "hb_skip_rules";
const intro = $("intro");
const ruleSteps = document.querySelectorAll(".rule-step");
let introStage = "closed"; // "title"=オープニング / "rules"=ルール説明 / "menu"=メニュー / "tips"=コツ / "closed"
const STAGES = { title: "introTitle", rules: "introRules", menu: "introMenu", tips: "introTips" };

// ===== コツ(ここに1行足すと、メニューの「コツ」に増えます。番号は tips01 から自動でつきます) =====
const TIPS = [
  "４色の把握→配置を当てる　という順番で基本攻略したい",
  "４色の把握は４手以内に絶対出来る！！",
  "序盤の予想は２色だけにするとやりやすい",
  "２色で予想する時は３＋１にするとやりやすい？？\n例)赤赤赤青で予想して２Hitなら、青の位置が確定する",
  "０Hitは逆にチャンス！\n全ての位置が違うので、配置を当てるときの消去法で役立つ",
];
TIPS.forEach((text, i) => {
  const li = document.createElement("li");
  const no = document.createElement("b");
  no.className = "tip-no";
  no.textContent = "tips" + String(i + 1).padStart(2, "0");
  const p = document.createElement("p");
  p.textContent = text; // 改行(\n)はそのまま表示される
  li.append(no, p);
  $("tipsList").append(li);
});
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
  if (introStage === "rules" && stage !== "rules") saveSkip($("ruleSkip").checked); // ルールから出る時も「表示しない」を保存
  introStage = stage;
  clearTimeout(introTimer);
  for (const [name, id] of Object.entries(STAGES)) $(id).hidden = name !== stage;
  if (stage === "title") {
    const t = $("introTitle");
    t.classList.remove("play");
    void t.offsetWidth; // アニメーションを最初からやり直す
    t.classList.add("play");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    introTimer = setTimeout(afterTitle, reduce ? 1200 : 3700);
  } else if (stage === "rules") {
    $("ruleSkip").checked = skipSaved();
    showRule(0);
    $("ruleNext").focus();
  } else {
    $(STAGES[stage]).querySelector("button[data-go], .rule-close").focus();
  }
  intro.scrollTop = 0;
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
document.querySelectorAll(".rule-close").forEach((b) => { b.onclick = closeIntro; });
document.querySelectorAll("[data-go]").forEach((b) => { b.onclick = () => showStage(b.dataset.go); });
$("rulePrev").onclick = () => showRule(Number(intro.dataset.step) - 1);
$("ruleNext").onclick = nextRule;
$("menuBtn").onclick = () => openIntro("menu");
document.addEventListener("keydown", (e) => {
  // ゲーム中: Delete / Backspace で、選んでいるボールを外す
  if (introStage === "closed") {
    const t = e.target.tagName;
    const locked = over || (mode === "versus" && phase === "play" && turn === "cpu");
    if ((e.key === "Delete" || e.key === "Backspace") && t !== "SELECT" && t !== "INPUT" && !locked) removeSelected();
    return;
  }
  if (e.key === "Escape") closeIntro();
  else if (introStage === "rules" && e.key === "ArrowRight") nextRule();
  else if (introStage === "rules" && e.key === "ArrowLeft" && Number(intro.dataset.step) > 0) showRule(Number(intro.dataset.step) - 1);
});

newGame();
openIntro("title");
