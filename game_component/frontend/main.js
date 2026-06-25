// === 최소 Streamlit 컴포넌트 브리지 (빌드 단계 없음) ===
const Streamlit = {
  _cb: null,
  ready() { this._post("streamlit:componentReady", { apiVersion: 1 }); },
  height(h) { this._post("streamlit:setFrameHeight", { height: h ?? document.body.scrollHeight }); },
  value(v) { this._post("streamlit:setComponentValue", { value: v, dataType: "json" }); },
  onRender(cb) { this._cb = cb; },
  _post(type, data) { window.parent.postMessage(Object.assign({ isStreamlitMessage: true, type }, data), "*"); },
};
window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "streamlit:render") {
    if (Streamlit._cb) Streamlit._cb(e.data.args || {});
    Streamlit.height();
  }
});

// === 기본 설정 (config 미전달 시 폴백) ===
const DEFAULT_CFG = {
  lives: 3,
  directions: ["left", "center", "right"],
  commitTimeoutMs: 5000,
  window: { initMs: 800, minMs: 250, maxMs: 1200, factor: 1.5, lookback: 3 },
  precue: { minMs: 300, maxMs: 1200 },
  minValidReactionMs: 100,
  timeout: { perLife: 2, disconnectConsecLives: 2 },
  botProfiles: {
    easy: { mean: 650, std: 120, wrong_rate: 0.25 },
    normal: { mean: 450, std: 90, wrong_rate: 0.12 },
    hard: { mean: 300, std: 60, wrong_rate: 0.04 },
  },
};

const DIRS = ["left", "center", "right"];
const KEY_TO_DIR = {
  ArrowLeft: "left", ArrowDown: "center", ArrowRight: "right",
  a: "left", s: "center", d: "right", A: "left", S: "center", D: "right",
};

// === DOM ===
const $ = (id) => document.getElementById(id);
const els = {
  game: $("game"), status: $("status"), banner: $("banner"),
  exchangeNo: $("exchange-no"), windowLabel: $("window-label"),
  heartsOpp: $("hearts-opp"), heartsPlayer: $("hearts-player"), whoPlayer: $("who-player"),
  layerOpp: $("layer-opp"), oppLabel: $("opp-label"),
  layerHand: $("layer-hand"), handLabel: $("hand-label"),
  lanes: Array.from(document.querySelectorAll(".lane")),
  timerTrack: $("timer-track"), timerFill: $("timer-fill"),
  overlay: $("overlay"), overlayTitle: $("overlay-title"), overlaySub: $("overlay-sub"),
  againBtn: $("again-btn"),
};

// === 상태 ===
let CFG = DEFAULT_CFG;
let BOT = DEFAULT_CFG.botProfiles.normal;
let started = false;
let timers = { commit: null, precue: null, win: null, pace: null };
let S = null; // 게임 상태

function freshState() {
  return {
    phase: "idle",
    attacker: Math.random() < 0.5 ? "player" : "opp", // 홀짝 선공
    exchangeNo: 1,
    lives: { player: CFG.lives, opp: CFG.lives },
    pendingTimeout: { player: 0 },
    consecTimeoutLife: { player: 0, opp: 0 },
    reactions: { player: [], opp: [] },
    window: { player: CFG.window.initMs, opp: CFG.window.initMs },
    curDir: null, cueStartTs: 0, cueReady: false,
    over: false, voided: false, winner: null,
  };
}

// === 유틸 ===
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const otherDir = (d) => { const r = DIRS.filter((x) => x !== d); return r[randInt(0, r.length - 1)]; };
const other = (who) => (who === "player" ? "opp" : "player");

function gaussian(mean, std) { // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function nextWindow(reactions) {
  const w = CFG.window;
  if (!reactions.length) return w.initMs;
  const recent = reactions.slice(-w.lookback);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  return clamp(avg * w.factor, w.minMs, w.maxMs);
}

function clearTimers() {
  Object.values(timers).forEach((t) => t && clearTimeout(t));
  timers = { commit: null, precue: null, win: null, pace: null };
}

// === 렌더 ===
function hearts(n) { return "❤".repeat(n) + "🖤".repeat(Math.max(0, CFG.lives - n)); }

function renderHUD() {
  els.heartsOpp.textContent = hearts(S.lives.opp);
  els.heartsPlayer.textContent = hearts(S.lives.player);
  els.exchangeNo.textContent = `교환 ${S.exchangeNo}`;
  const w = S.attacker === "opp" ? S.window.player : S.window.opp; // 이번 방어자의 window
  els.windowLabel.textContent = `허용 ${Math.round(w)}ms`;
}

function setOpp(state) { // 'idle' | 'attack-left/center/right' | 'hit' | 'win'
  els.layerOpp.className = "sprite " + (state === "idle" ? "" : state);
  const map = { idle: "대기", "attack-left": "좌 공격!", "attack-center": "중 공격!", "attack-right": "우 공격!", hit: "피격", win: "승리" };
  els.oppLabel.textContent = map[state] || "대기";
}
function setHand(state) { // 'idle' | 'attack' | 'block-left/center/right'
  els.layerHand.className = "sprite " + (state === "idle" ? "" : state);
  const map = { idle: "대기", attack: "공격", "block-left": "좌 막기", "block-center": "중 막기", "block-right": "우 막기" };
  els.handLabel.textContent = map[state] || "대기";
}
function setLanes(cls, dir) { // cls: ''|'cue'|'ok'|'bad'
  els.lanes.forEach((l) => {
    l.classList.remove("cue", "ok", "bad");
    if (cls && (dir == null || l.dataset.dir === dir)) l.classList.add(cls);
  });
}
function banner(text, kind) {
  els.banner.className = kind || "";
  els.banner.textContent = text;
  els.banner.classList.remove("hidden");
}
function hideBanner() { els.banner.classList.add("hidden"); }
function setStatus(t) { els.status.textContent = t; }

function startTimerBar(ms) {
  els.timerTrack.classList.add("on");
  els.timerFill.style.transition = "none";
  els.timerFill.style.transform = "scaleX(1)";
  // 다음 프레임에 애니메이션 시작
  requestAnimationFrame(() => requestAnimationFrame(() => {
    els.timerFill.style.transition = `transform ${ms}ms linear`;
    els.timerFill.style.transform = "scaleX(0)";
  }));
}
function stopTimerBar() {
  const cs = getComputedStyle(els.timerFill).transform;
  els.timerFill.style.transition = "none";
  els.timerFill.style.transform = cs;
  els.timerTrack.classList.remove("on");
}

// === 게임 흐름 ===
function startMatch() {
  clearTimers();
  S = freshState();
  els.overlay.classList.add("hidden");
  setOpp("idle"); setHand("idle"); setLanes(""); hideBanner();
  renderHUD();
  banner("결투 시작", "warn");
  timers.pace = setTimeout(() => { hideBanner(); scheduleExchange(); }, 800);
}

function scheduleExchange() {
  if (S.over) return;
  S.defender = other(S.attacker);
  S.curDir = null;
  setOpp("idle"); setHand("idle"); setLanes(""); hideBanner();
  renderHUD();

  if (S.attacker === "player") promptPlayerAttack();
  else botAttack();
}

// --- 내가 공격 ---
function promptPlayerAttack() {
  S.phase = "attackerCommit";
  setStatus("⚔ 공격! 방향키(← ↓ →)를 누르세요");
  banner("공격하라", "warn");
  els.game.focus();
  timers.commit = setTimeout(() => handleTimeout("player"), CFG.commitTimeoutMs);
}
function playerCommitted(dir) {
  clearTimeout(timers.commit);
  S.phase = "resolve";
  S.curDir = dir;
  hideBanner();
  setHand("attack");
  setStatus("상대가 막는 중…");
  timers.pace = setTimeout(() => resolveBotDefense(dir), 350);
}

// --- 봇이 공격 ---
function botAttack() {
  S.curDir = DIRS[randInt(0, DIRS.length - 1)];
  beginPlayerDefense(S.curDir);
}

// --- 내가 방어 ---
function beginPlayerDefense(dir) {
  S.phase = "precue";
  setOpp("idle"); setHand("idle"); setLanes("");
  setStatus("상대의 공격을 막아라! (예측 입력 금지)");
  const delay = randInt(CFG.precue.minMs, CFG.precue.maxMs);
  timers.precue = setTimeout(() => showCue(dir), delay);
}
function showCue(dir) {
  S.phase = "cue";
  S.cueReady = false; // 큐 페인트 전 입력은 '너무 빨랐음'으로 처리
  setOpp("attack-" + dir);
  setLanes("cue", dir);
  banner("막아!", "bad");
  const w = S.window.player;
  // 큐 페인트 직후를 측정 기준점으로
  requestAnimationFrame(() => requestAnimationFrame(() => {
    S.cueStartTs = performance.now();
    S.cueReady = true;
    startTimerBar(w);
    timers.win = setTimeout(() => onDefenseTooSlow(), w);
  }));
}
function onDefenseTooSlow() {
  if (S.phase !== "cue") return;
  stopTimerBar();
  banner("너무 느림", "bad");
  resolveDefense("player", false, null);
}
function onPlayerDefenseKey(dir) {
  if (!S.cueReady) return tooEarly(); // 큐 페인트 전(스톨 타임스탬프) 입력 차단
  const reaction = performance.now() - S.cueStartTs;
  if (reaction < CFG.minValidReactionMs) return tooEarly();
  clearTimeout(timers.win);
  stopTimerBar();
  hideBanner();
  S.reactions.player.push(reaction); // 램프용(정오답 무관)
  const success = dir === S.curDir && reaction <= S.window.player;
  setHand("block-" + dir);
  setStatus(`${Math.round(reaction)}ms — ${success ? "막음!" : (dir === S.curDir ? "느림" : "빗맞음")}`);
  resolveDefense("player", success, reaction);
}
function tooEarly() {
  clearTimeout(timers.win);
  stopTimerBar();
  setLanes("");
  setOpp("idle");
  banner("너무 빨랐음 · 다시", "warn");
  S.phase = "resolve";
  timers.pace = setTimeout(() => { hideBanner(); beginPlayerDefense(S.curDir); }, 700); // 무벌점 재시도(새 랜덤지연)
}

// --- 봇이 방어 (내 공격에 대해) ---
function resolveBotDefense(attackDir) {
  const reaction = Math.max(CFG.minValidReactionMs, gaussian(BOT.mean, BOT.std));
  const wrong = Math.random() < BOT.wrong_rate;
  S.reactions.opp.push(reaction);
  const success = !wrong && reaction <= S.window.opp;
  setOpp(success ? "idle" : "hit");
  setLanes(success ? "ok" : "bad", success ? null : attackDir);
  setStatus(`상대 반응 ${Math.round(reaction)}ms — ${success ? "막음" : (wrong ? "빗맞음" : "느림")}`);
  resolveDefense("opp", success, reaction);
}

// --- 방어 판정 후 처리 ---
function resolveDefense(defender, success, reaction) {
  S.phase = "resolve";
  if (success) {
    if (defender === "player") { setLanes("ok", null); banner("막음!", "good"); }
    timers.pace = setTimeout(nextAfterResolve, 650);
  } else {
    loseLife(defender, "defense");
    if (defender === "player") banner("실패!", "bad");
    renderHUD();
    if (!S.over) timers.pace = setTimeout(nextAfterResolve, 750);
  }
}

// --- 타임아웃 처리 ---
function handleTimeout(who) {
  clearTimeout(timers.commit);
  S.pendingTimeout[who] = (S.pendingTimeout[who] || 0) + 1;
  setHand("idle");
  banner("시간 초과", "warn");
  setStatus(`공격 시간 초과 (${S.pendingTimeout[who]}/${CFG.timeout.perLife})`);
  if (S.pendingTimeout[who] >= CFG.timeout.perLife) {
    S.pendingTimeout[who] = 0;
    loseLife(who, "timeout");
    renderHUD();
  }
  if (!S.over) timers.pace = setTimeout(nextAfterResolve, 800);
}

function loseLife(who, cause) {
  S.lives[who] = Math.max(0, S.lives[who] - 1);
  if (cause === "timeout") {
    S.consecTimeoutLife[who] += 1;
    if (S.consecTimeoutLife[who] >= CFG.timeout.disconnectConsecLives) return voidMatch("연결 끊김");
  } else {
    S.consecTimeoutLife[who] = 0;
  }
  if (S.lives[who] <= 0) endMatch(other(who));
}

// --- 다음 교환 ---
function nextAfterResolve() {
  if (S.over) return;
  // 램프: 이번 방어자의 반응으로 window 갱신
  S.window[S.defender] = nextWindow(S.reactions[S.defender]);
  S.exchangeNo += 1;
  S.attacker = other(S.attacker); // 역할 교대
  scheduleExchange();
}

// === 종료 ===
function statsPayload() {
  const pr = S.reactions.player;
  return {
    livesPlayer: S.lives.player, livesOpp: S.lives.opp,
    exchanges: S.exchangeNo,
    reactionsPlayer: pr.map((x) => Math.round(x)),
    avgReaction: pr.length ? Math.round(pr.reduce((a, b) => a + b, 0) / pr.length) : null,
    bestReaction: pr.length ? Math.round(Math.min(...pr)) : null,
  };
}
function endMatch(winner) {
  S.over = true; S.winner = winner;
  S.phase = "matchOver";
  clearTimers();
  const win = winner === "player";
  setOpp(win ? "hit" : "win");
  showOverlay(win ? "win" : "lose", win ? "승리" : "패배",
    win ? "상대를 쓰러뜨렸다." : "당신이 쓰러졌다.");
  Streamlit.value({ event: "matchEnd", ts: Date.now(), winner, voided: false, ...statsPayload() });
}
function voidMatch(reason) {
  S.over = true; S.voided = true;
  S.phase = "matchOver";
  clearTimers();
  showOverlay("void", "기록 미반영", `${reason} — 이 매치는 전적·레이팅에 반영되지 않습니다.`);
  Streamlit.value({ event: "matchVoid", ts: Date.now(), reason, ...statsPayload() });
}
function showOverlay(kind, title, sub) {
  els.overlayTitle.className = kind;
  els.overlayTitle.textContent = title;
  els.overlaySub.textContent = sub;
  els.overlay.classList.remove("hidden");
  Streamlit.height();
}

// === 입력 라우팅 ===
els.game.addEventListener("click", () => els.game.focus());
els.game.addEventListener("keydown", (ev) => {
  const dir = KEY_TO_DIR[ev.key];
  if (!dir) return;
  ev.preventDefault();
  if (S == null || S.over) return;
  if (S.phase === "attackerCommit") playerCommitted(dir);
  else if (S.phase === "precue") tooEarly();
  else if (S.phase === "cue") onPlayerDefenseKey(dir);
});
els.againBtn.addEventListener("click", () => startMatch());

// === 렌더 진입점 ===
Streamlit.onRender((args) => {
  if (!started) {
    started = true;
    CFG = Object.assign({}, DEFAULT_CFG, args.config || {});
    if (!CFG.window) CFG.window = DEFAULT_CFG.window;
    const profiles = CFG.botProfiles || DEFAULT_CFG.botProfiles;
    BOT = profiles[args.difficulty] || profiles.normal || DEFAULT_CFG.botProfiles.normal;
    els.whoPlayer.textContent = "나";
    startMatch();
  }
});
Streamlit.ready();
Streamlit.height();
