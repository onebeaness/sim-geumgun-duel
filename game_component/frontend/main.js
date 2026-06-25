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
  commitTimeoutMs: 3000,
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
  ArrowLeft: "left", ArrowRight: "right",
  ArrowUp: "center", ArrowDown: "center", // 중앙은 상단/하단 아무거나
  a: "left", d: "right", w: "center", s: "center",
  A: "left", D: "right", W: "center", S: "center",
};

// === DOM ===
const $ = (id) => document.getElementById(id);
const els = {
  game: $("game"), status: $("status"), banner: $("banner"),
  exchangeNo: $("exchange-no"), windowLabel: $("window-label"), turnInd: $("turn-indicator"),
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
    turnLog: [],
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
  const myAtk = S.attacker === "player";
  els.turnInd.textContent = myAtk ? "⚔️ 내 공격 턴" : "🛡️ 내 방어 턴";
  els.turnInd.className = myAtk ? "atk" : "def";
}

const IMG = {
  bg: "img/bg/bg_arena.jpg",
  opp: {
    idle: "img/opponent/opp_idle.png",
    "attack-left": "img/opponent/opp_attack_left.png",
    "attack-center": "img/opponent/opp_attack_center.png",
    "attack-right": "img/opponent/opp_attack_right.png",
    hit: "img/opponent/opp_idle.png", // 피격 전용 컷 없음 → 대기 + .hit 필터
    win: "img/opponent/opp_idle.png",
  },
  hand: { // 공격/막기 공용(방향별 1장)
    left: "img/hand/hand_left.png",
    center: "img/hand/hand_center.png",
    right: "img/hand/hand_right.png",
  },
};
function setOpp(state) { // 'idle' | 'attack-left/center/right' | 'hit' | 'win'
  els.layerOpp.style.backgroundImage = `url('${IMG.opp[state] || IMG.opp.idle}')`;
  const cls = state === "hit" ? "hit" : state === "win" ? "win"
    : state.startsWith("attack") ? "attacking" : "";
  els.layerOpp.className = "sprite " + cls;
}
function setHand(state) { // 'idle' | 'attack-left/center/right' | 'block-left/center/right'
  const dir = state === "idle" ? "center" : state.split("-")[1];
  els.layerHand.style.backgroundImage = `url('${IMG.hand[dir] || IMG.hand.center}')`;
}
function preloadImages() {
  [IMG.bg, ...Object.values(IMG.opp), ...Object.values(IMG.hand)].forEach((s) => {
    const i = new Image(); i.src = s;
  });
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
  const sec = Math.round(CFG.commitTimeoutMs / 1000);
  setStatus(
    `⚔ 당신의 공격 턴! 좌(←/A) · 중(↑↓/W S) · 우(→/D) 중 한 방향으로 베세요 — ` +
    `상대가 그 방향을 막으려 합니다. ${sec}초 안에 미선택 시 시간초과.`
  );
  banner("공격하라!", "warn");
  els.game.focus();
  timers.commit = setTimeout(() => handleTimeout("player"), CFG.commitTimeoutMs);
}
function playerCommitted(dir) {
  clearTimeout(timers.commit);
  S.phase = "resolve";
  S.curDir = dir;
  hideBanner();
  setHand("attack-" + dir);
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
  S.turnLog.push({
    turn_no: S.exchangeNo, attacker: S.attacker, defender,
    direction: S.curDir,
    reaction_ms: reaction != null ? Math.round(reaction) : null,
    defended: success,
    window_ms: Math.round(defender === "player" ? S.window.player : S.window.opp),
    cause: success ? null : "defense",
  });
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
  S.turnLog.push({
    turn_no: S.exchangeNo, attacker: who, defender: other(who),
    direction: null, reaction_ms: null, defended: false, window_ms: null, cause: "timeout",
  });
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
    turns: S.turnLog,
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

// ====================== PvP (Supabase Realtime) ======================
let MODE = "solo";
let sb = null;
let P = {};
const $m = (id) => document.getElementById(id);
function matchOverlay(show, status, sub) {
  const o = $m("match-overlay");
  if (show) { $m("match-status").textContent = status || ""; $m("match-sub").textContent = sub || ""; o.classList.remove("hidden"); }
  else o.classList.add("hidden");
  Streamlit.height();
}

function initPvP(args) {
  MODE = "pvp";
  const c = args.config || {};
  CFG = Object.assign({}, DEFAULT_CFG, c);
  if (!CFG.window) CFG.window = DEFAULT_CFG.window;
  // 매칭/프레즌스용 '접속 고유 ID' — 같은 player_uuid(같은 기기 2탭)라도 충돌 안 나게
  P = { myId: (c.playerId || "p") + "-" + Math.random().toString(36).slice(2, 7),
        nick: c.nickname || "익명", room: c.roomCode || null,
        url: c.supabaseUrl, key: c.anonKey, started: false };
  els.whoPlayer.textContent = "나 (" + P.nick + ")";
  setOpp("idle"); setHand("idle"); setLanes("");
  if (!window.supabase || !P.url || !P.key) { matchOverlay(true, "온라인 설정 필요", "supabase 연결 정보가 없습니다"); return; }
  sb = window.supabase.createClient(P.url, P.key, { realtime: { params: { eventsPerSecond: 20 } } });
  if (P.room) joinDuel("room:" + P.room);
  else findMatch();
}

function findMatch() {
  matchOverlay(true, "상대를 찾는 중…", "대기열 입장 중");
  const mm = sb.channel("mm", { config: { presence: { key: P.myId } } });
  P.mm = mm;
  mm.on("presence", { event: "sync" }, () => {
    if (P.started) return;
    const ids = Object.keys(mm.presenceState()).sort();
    matchOverlay(true, "상대를 찾는 중…", `대기열 ${ids.length}명`);
    if (ids.length >= 2) {
      const pair = ids.slice(0, 2);
      if (pair.includes(P.myId)) {
        // 조기 untrack 금지 — 양쪽 모두 짝을 보기 전에 빠지면 매칭 실패.
        // mm 정리는 startNetMatch(듀얼 시작 확정 후)에서.
        P.started = true;
        joinDuel("m:" + pair.join("__"));
      }
    }
  });
  mm.subscribe(async (st) => { if (st === "SUBSCRIBED") await mm.track({ nick: P.nick, t: Date.now() }); });
}

function joinDuel(roomId) {
  matchOverlay(true, "상대와 연결 중…", P.room ? "방: " + P.room : "");
  const ch = sb.channel("duel:" + roomId, { config: { presence: { key: P.myId }, broadcast: { self: false } } });
  P.ch = ch;
  ch.on("presence", { event: "sync" }, () => {
    const ps = ch.presenceState();
    const ids = Object.keys(ps);
    if (ids.length >= 2 && !P.matchOn) {
      P.matchOn = true;
      const sorted = [...ids].sort();
      P.p1 = sorted[0]; P.p2 = sorted[1];
      P.oppId = sorted.find((x) => x !== P.myId);
      P.oppNick = (ps[P.oppId] && ps[P.oppId][0] && ps[P.oppId][0].nick) || "상대";
      startNetMatch();
    }
  });
  ch.on("presence", { event: "leave" }, () => { if (P.matchOn && S && !S.over) netVoid("상대 이탈"); });
  ch.on("broadcast", { event: "sig" }, ({ payload }) => onSig(payload));
  ch.subscribe(async (st) => { if (st === "SUBSCRIBED") await ch.track({ nick: P.nick }); });
}
function send(payload) { if (P.ch) P.ch.send({ type: "broadcast", event: "sig", payload }); }

function startNetMatch() {
  if (P.mm) { try { P.mm.untrack(); sb.removeChannel(P.mm); } catch (e) {} P.mm = null; } // 이제 안전하게 대기열 정리
  matchOverlay(false);
  S = freshState();
  S.over = false;
  S.pendingTimeout = { player: 0, opp: 0 };
  document.querySelector("#hud .side .who").textContent = "상대 (" + P.oppNick + ")";
  renderHUD();
  banner("결투 시작", "warn");
  timers.pace = setTimeout(() => { hideBanner(); netScheduleTurn(1); }, 800);
}

function attackerIdForTurn(t) { return (t % 2 === 1) ? P.p1 : P.p2; } // 홀수턴 p1 공격
function netScheduleTurn(t) {
  if (S.over) return;
  S.exchangeNo = t;
  S.attacker = (attackerIdForTurn(t) === P.myId) ? "player" : "opp";
  S.defender = (S.attacker === "player") ? "opp" : "player";
  S.curDir = null; S.cueReady = false; S.turnResolved = false;
  setOpp("idle"); setHand("idle"); setLanes(""); hideBanner(); renderHUD();
  if (S.attacker === "player") netPromptAttack(t);
  else { S.phase = "awaitAtk"; setStatus("상대의 공격을 기다리는 중…"); }
}
function netPromptAttack(t) {
  S.phase = "attackerCommit";
  const sec = Math.round(CFG.commitTimeoutMs / 1000);
  setStatus(`⚔ 공격 턴! 좌(←/A)·중(↑↓/W S)·우(→/D) 중 하나로 베세요. ${sec}초.`);
  banner("공격하라!", "warn"); els.game.focus();
  timers.commit = setTimeout(() => { send({ ev: "timeout", t }); netApplyTimeout(P.myId, t); }, CFG.commitTimeoutMs);
}
function netCommit(dir) {
  if (S.phase !== "attackerCommit") return; // 연타/중복 입력 무시
  S.phase = "await";                         // 즉시 잠금
  clearTimeout(timers.commit);
  S.curDir = dir;
  setHand("attack-" + dir); hideBanner(); setStatus("상대가 막는 중…");
  send({ ev: "attack", t: S.exchangeNo, dir });
}
function onSig(p) {
  if (!S || S.over) return;
  // 각 분기를 기대 phase 로 가드 → 중복/순서꼬임 broadcast 무시
  if (p.ev === "attack" && p.t === S.exchangeNo && S.defender === "player" && S.phase === "awaitAtk") netBeginDefense(p.dir);
  else if (p.ev === "result" && p.t === S.exchangeNo && S.attacker === "player" && S.phase === "await" && !S.turnResolved) netApplyResultFromOpp(p.t, p.hit, p.reaction);
  else if (p.ev === "timeout" && p.t === S.exchangeNo && !S.turnResolved) netApplyTimeout(attackerIdForTurn(p.t), p.t);
}
function netBeginDefense(dir) {
  S.curDir = dir; S.phase = "precue";
  setOpp("idle"); setHand("idle"); setLanes(""); setStatus("막아라!");
  timers.precue = setTimeout(() => netShowCue(dir), randInt(CFG.precue.minMs, CFG.precue.maxMs));
}
function netShowCue(dir) {
  S.phase = "cue"; S.cueReady = false;
  setOpp("attack-" + dir); setLanes("cue", dir); banner("막아!", "bad");
  const w = S.window.player;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    S.cueStartTs = performance.now(); S.cueReady = true;
    startTimerBar(w);
    timers.win = setTimeout(() => { if (S.phase === "cue") { stopTimerBar(); banner("너무 느림", "bad"); netResolveMyDefense(null, false, null); } }, w);
  }));
}
function netTooEarly() {
  if (S.phase === "resolve") return; // 이미 처리됨(연타 무시)
  S.phase = "resolve";
  clearTimeout(timers.win); clearTimeout(timers.precue); stopTimerBar();
  setLanes(""); setOpp("idle"); banner("너무 빨랐음 · 다시", "warn");
  timers.pace = setTimeout(() => { hideBanner(); netBeginDefense(S.curDir); }, 700);
}
function netDefenseKey(dir) {
  if (S.phase !== "cue") return; // 연타/중복 입력 무시
  if (!S.cueReady) return netTooEarly();
  const reaction = performance.now() - S.cueStartTs;
  if (reaction < CFG.minValidReactionMs) return netTooEarly();
  clearTimeout(timers.win); stopTimerBar(); hideBanner();
  S.reactions.player.push(reaction);
  const hit = dir === S.curDir && reaction <= S.window.player;
  setHand("block-" + dir);
  setStatus(`${Math.round(reaction)}ms — ${hit ? "막음!" : (dir === S.curDir ? "느림" : "빗맞음")}`);
  netResolveMyDefense(dir, hit, reaction);
}
function netResolveMyDefense(dir, hit, reaction) {
  S.phase = "resolve"; // 시간초과 경로 포함 잠금
  send({ ev: "result", t: S.exchangeNo, hit, reaction: reaction != null ? Math.round(reaction) : null });
  pushTurn("player", hit, reaction);
  netApplyOutcome(S.exchangeNo, hit, "player");
}
function netApplyResultFromOpp(t, hit, reaction) {
  if (hit) banner("상대가 막음", "warn"); else { setOpp("hit"); banner("명중!", "good"); }
  if (reaction != null) S.reactions.opp.push(reaction);
  pushTurn("opp", hit, reaction);
  netApplyOutcome(t, hit, "opp");
}
function netApplyOutcome(t, hit, defenderRole) {
  if (S.turnResolved) return; // 한 턴 1회만 처리(중복 broadcast/연타 방지)
  S.turnResolved = true;
  if (!hit) netLoseLife(defenderRole, "defense");
  renderHUD();
  if (!S.over) timers.pace = setTimeout(() => netScheduleTurn(t + 1), 750);
}
function netApplyTimeout(attId, t) {
  if (S.turnResolved) return;
  S.turnResolved = true;
  clearTimeout(timers.commit);
  const role = (attId === P.myId) ? "player" : "opp";
  S.pendingTimeout[role] = (S.pendingTimeout[role] || 0) + 1;
  banner("시간 초과", "warn");
  if (S.pendingTimeout[role] >= CFG.timeout.perLife) { S.pendingTimeout[role] = 0; netLoseLife(role, "timeout"); }
  renderHUD();
  if (!S.over) timers.pace = setTimeout(() => netScheduleTurn(t + 1), 800);
}
function netLoseLife(role, cause) {
  S.lives[role] = Math.max(0, S.lives[role] - 1);
  if (cause === "timeout") {
    S.consecTimeoutLife[role] += 1;
    if (S.consecTimeoutLife[role] >= CFG.timeout.disconnectConsecLives) return netVoid("연결 끊김");
  } else S.consecTimeoutLife[role] = 0;
  if (S.lives[role] <= 0) netEnd(role === "player" ? "opp" : "player");
}
function pushTurn(defRole, hit, reaction) {
  S.turnLog.push({ turn_no: S.exchangeNo, attacker: S.attacker, defender: defRole, direction: S.curDir,
    reaction_ms: reaction != null ? Math.round(reaction) : null, defended: hit,
    window_ms: Math.round(S.window[defRole] || 0), cause: hit ? null : "defense" });
  S.window[defRole] = nextWindow(S.reactions[defRole]);
}
function netEnd(winnerRole) {
  S.over = true; clearTimers();
  const win = winnerRole === "player";
  setOpp(win ? "hit" : "win");
  els.againBtn.style.display = ""; els.againBtn.textContent = "재대결";
  showOverlay(win ? "win" : "lose", win ? "승리" : "패배", win ? `${P.oppNick} 격파!` : `${P.oppNick}에게 패배`);
  Streamlit.value({ event: "matchEnd", ts: Date.now(), mode: "pvp", winner: winnerRole, voided: false, oppNick: P.oppNick, ...statsPayload() });
  cleanupPvP();
}
function netVoid(reason) {
  S.over = true; clearTimers();
  els.againBtn.style.display = ""; els.againBtn.textContent = "재대결";
  showOverlay("void", "기록 미반영", reason + " — 전적·레이팅에 반영되지 않습니다.");
  Streamlit.value({ event: "matchVoid", ts: Date.now(), mode: "pvp", reason });
  cleanupPvP();
}
function cleanupPvP() { try { if (P.ch) sb.removeChannel(P.ch); } catch (e) {} }
function pvpRematch() {
  clearTimers();
  els.overlay.classList.add("hidden");
  els.againBtn.textContent = "다시 결투";
  S = null;
  P.started = false; P.matchOn = false;
  try { if (P.ch) sb.removeChannel(P.ch); } catch (e) {}
  P.ch = null;
  setOpp("idle"); setHand("idle"); setLanes(""); hideBanner();
  if (P.room) joinDuel("room:" + P.room); else findMatch();
}

// === 입력 라우팅 ===
els.game.addEventListener("click", () => els.game.focus());
els.game.addEventListener("keydown", (ev) => {
  const dir = KEY_TO_DIR[ev.key];
  if (!dir) return;
  ev.preventDefault();
  if (S == null || S.over) return;
  if (MODE === "pvp") {
    if (S.phase === "attackerCommit") netCommit(dir);
    else if (S.phase === "precue") netTooEarly();
    else if (S.phase === "cue") netDefenseKey(dir);
    return;
  }
  if (S.phase === "attackerCommit") playerCommitted(dir);
  else if (S.phase === "precue") tooEarly();
  else if (S.phase === "cue") onPlayerDefenseKey(dir);
});
els.againBtn.addEventListener("click", () => { if (MODE === "pvp") pvpRematch(); else startMatch(); });

// === 렌더 진입점 ===
Streamlit.onRender((args) => {
  if (!started) {
    started = true;
    preloadImages();
    if (args.mode === "pvp") { initPvP(args); return; }
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
