import { RULES, BONUS_NAMES } from "./rules.mjs";
import { loadState, saveState, newSession, addEvent, removeEventAt, moveEventBy, moveEventTo, endRound, currentRoundScores, totalScores } from "./state.mjs";
import { computeFan, computeScore, replayPairwise, netPayments, eventPairwise, settlementPairwise } from "./engine.mjs";

let state = loadState();
let actionMode = null;         // null | "bu" | "zhi" | "an" | "dian" | "hu"
let actionPlayer = null;       // 选定的动作主角 (0..3)，杠=杠者，胡=胡者
let gangDianFrom = null;       // 点杠第二步：被点者
let huSel = defaultHuSel();
let showMorePatterns = false;
let txClosedSet = new Set();   // 被手动折叠的玩家 index（默认全展开）
let settlingMode = false;      // 点"下一局"后如果有未胡家，进入流局结算
let settleSel = [null, null, null, null];  // 每家结算状态 {status, maxFan}
let diceRoll = null;           // 换三张摇骰子结果：点数合计 (2..12)
let historyMode = false;       // 切换历史视图
let reorderMode = false;       // 事件顺序编辑视图
let helpMode = false;          // 玩法指引浮层
let undoStack = [];            // 最近 10 个 state 快照，供撤销使用
const UNDO_LIMIT = 10;

// 按钮防抖
const debounceTs = {};
function debounced(key, fn, ms = 500) {
  const now = Date.now();
  if (debounceTs[key] && now - debounceTs[key] < ms) return;
  debounceTs[key] = now;
  fn();
}

function pushUndo(label) {
  undoStack.push({ state: JSON.parse(JSON.stringify(state)), label });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}
function popUndo() {
  return undoStack.pop();
}

function defaultHuSel() {
  return { zimo: false, from: null, pattern: "pinghu", gen: 0, bonuses: [] };
}

function $(sel) { return document.querySelector(sel); }
function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
}

// Toast 简短反馈
let toastTimer = null;
function toast(msg, type = "success") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `show toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ""; }, 1800);
}

function resetAction() {
  actionMode = null;
  actionPlayer = null;
  gangDianFrom = null;
  huSel = defaultHuSel();
  showMorePatterns = false;
}

function renderRoute() {
  if (state) {
    hide("#wizard");
    show("#main");
    renderMain();
  } else {
    show("#wizard");
    hide("#main");
  }
}

// ---------- 向导 ----------
// 底分快捷按钮
document.querySelectorAll(".base-presets button").forEach(btn => {
  btn.addEventListener("click", () => {
    $("#wbase").value = btn.dataset.base;
    document.querySelectorAll(".base-presets button").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
  });
});
// 初始高亮 "1"
document.querySelector('.base-presets button[data-base="1"]')?.classList.add("selected");

$("#wizard-start").addEventListener("click", () => {
  const names = [0, 1, 2, 3].map(i => $("#p" + i).value.trim() || `玩家${i+1}`);
  const ruleSel = document.querySelector('input[name="wrule"]:checked');
  const rule = ruleSel ? ruleSel.value : "bloodbattle";
  const baseRaw = parseFloat($("#wbase").value);
  const baseScore = Number.isFinite(baseRaw) && baseRaw > 0 ? baseRaw : 1;
  state = newSession({ players: names, rule, baseScore });
  saveState(state);
  resetAction();
  renderRoute();
});

// ---------- 主屏渲染 ----------
function renderMain() {
  const rule = RULES[state.rule];
  const undoBtn = undoStack.length > 0
    ? `<button class="info-icon-btn" data-xact="undo" title="撤销"><span>↶</span><span class="label">撤销</span></button>`
    : "";
  $("#info-bar").innerHTML =
    `<div class="info-hero">
       <img class="info-panda" src="panda-head.png" alt="panda">
       <img class="info-tile" src="tile-zhong.png" alt="tile">
     </div>
     <div class="info-text">
       <div class="info-title">第 ${state.rounds.length + 1} 局</div>
       <div class="info-sub">${rule.name} · 底分 ${state.baseScore}</div>
     </div>
     <div class="info-actions">` +
    undoBtn +
    `<button class="info-icon-btn ${historyMode ? 'active' : ''}" data-xact="history-toggle"><span>📜</span><span class="label">历史</span></button>` +
    `<button class="info-icon-btn ${reorderMode ? 'active' : ''}" data-xact="reorder-toggle"><span>⏱</span><span class="label">顺序</span></button>` +
    `<button class="info-icon-btn ${helpMode ? 'active' : ''}" data-xact="help-toggle"><span>❓</span><span class="label">帮助</span></button>` +
    `</div>`;
  if (helpMode) {
    $("#dice-area").innerHTML = "";
    $("#action-panel").innerHTML = "";
    $("#player-list").innerHTML = renderHelp();
    return;
  }
  if (reorderMode) {
    $("#dice-area").innerHTML = "";
    $("#action-panel").innerHTML = "";
    $("#player-list").innerHTML = renderReorderView();
    return;
  }
  if (historyMode) {
    $("#dice-area").innerHTML = "";
    $("#action-panel").innerHTML = "";
    $("#player-list").innerHTML = renderHistory();
    return;
  }
  $("#dice-area").innerHTML = renderDiceTool();
  $("#action-panel").innerHTML = settlingMode ? renderSettlementPanel() : renderActionPanel();
  const scores = currentRoundScores(state);
  const hasEvents = state.currentRound.events.length > 0;
  const emptyHint = (!hasEvents && !settlingMode)
    ? `<div class="empty-hint">↑ 点击上面按钮记录杠 / 胡</div>`
    : "";
  $("#player-list").innerHTML = emptyHint + state.players
    .map((name, i) => renderPlayerCard(i, name, scores[i]))
    .join("");
  // 下一局无事件时禁用
  const endBtn = $("#btn-end-round");
  if (endBtn) endBtn.disabled = !hasEvents;
  const resetBtn = $("#btn-reset-round");
  if (resetBtn) resetBtn.disabled = !hasEvents;
}

// 历史页单条事件描述（含当时的玩家名、番数、分数）
function describeHistoryEvent(ev) {
  const p = state.players;
  const rule = RULES[state.rule];
  if (ev.type === "mahu") {
    const penalty = rule.penalty * state.baseScore;
    return `<b>${p[ev.player]}</b> ⚠️ 麻胡 赔 3 家各 ${penalty}元`;
  }
  if (ev.type === "gang") {
    const types = { bu: "补杠", dian: "点杠", an: "暗杠", zhi: "直杠" };
    const unit = rule.gangPoint[ev.gangType] * state.baseScore;
    if (ev.gangType === "dian") return `<b>${p[ev.player]}</b> ${types[ev.gangType]} (${p[ev.from]}点) 收 ${unit}元`;
    return `<b>${p[ev.player]}</b> ${types[ev.gangType]} 每家 ${unit}元`;
  }
  if (ev.type === "hu") {
    const patName = rule.patterns.find(x => x.id === ev.pattern)?.name ?? ev.pattern;
    const way = ev.zimo ? "自摸" : `点炮(${p[ev.from]})`;
    const gen = ev.gen > 0 ? `带${ev.gen}根` : "";
    const bonuses = ev.bonuses?.map(b => BONUS_NAMES[b]).join("+") ?? "";
    const bonusStr = bonuses ? `+${bonuses}` : "";
    const fan = computeFan(rule, ev);
    const score = computeScore(rule, ev, state.baseScore);
    return `<b>${p[ev.player]}</b> 胡 ${patName}${gen} ${way}${bonusStr} → ${fan}番 ${score}元`;
  }
  if (ev.type === "settlement") {
    const kinds = { huazhu: "花猪", tingpai: "已听", weiting: "未听", xianggong: "相公" };
    const parts = ev.result.map(r => {
      const fan = r.kind === "tingpai" ? `${r.maxFan}番` : "";
      return `${p[r.player]}${kinds[r.kind]}${fan}`;
    }).join(" · ");
    return `流局结算：${parts}`;
  }
  return JSON.stringify(ev);
}

// ---------- 玩法指引 ----------
function renderHelp() {
  return `<div class="help-view">
    <h3>四川麻将玩法指引</h3>

    <div class="help-block">
      <h4>🀫 开局</h4>
      <p>• 每人发 13 张牌，<b>东家多 1 张共 14 张</b></p>
      <p>• 换三张：先交换 3 张同门牌给指定方向</p>
      <p>• 定缺：每家宣一门（万/条/筒）为缺门</p>
    </div>

    <div class="help-block">
      <h4>🀄 摸牌 / 打牌顺序</h4>
      <p>• 麻将是<b>逆时针</b>（下家=你右手边那位）</p>
      <p>• 东家先打一张（不摸），下家接着摸打</p>
      <p>• 顺序：<b>东 → 南 → 西 → 北 → 东</b>（风向也是逆时针）</p>
      <p>• 每人轮到：<b>先摸 1 张 → 出 1 张</b>（手上始终 13 张）</p>
      <p>• app 里的玩家 1/2/3/4 按<b>逆时针座次</b>排（1下家=2, 2下家=3...）</p>
    </div>

    <div class="help-block">
      <h4>⚡ 打断顺序的操作</h4>
      <p>• <b>碰</b>：别人打的牌你手上有一对 → 接走变刻子，由你出下一张</p>
      <p>• <b>杠</b>：</p>
      <p class="help-sub">- 直杠（明杠）：别人打的牌你手上已有三张相同</p>
      <p class="help-sub">- 补杠：你碰过的刻子 + 摸到第 4 张相同</p>
      <p class="help-sub">- 暗杠：你自己摸齐 4 张相同</p>
      <p class="help-sub">- 点杠（川麻特有）：别人打的牌你手上已有三张相同 = 直杠另一叫法</p>
      <p>• 杠之后要<b>再摸一张</b>（从牌墙尾摸），再出一张</p>
      <p>• <b>胡</b>：</p>
      <p class="help-sub">- 点炮胡：别人打的牌能让你胡</p>
      <p class="help-sub">- 自摸：自己摸到能让你胡的牌</p>
    </div>

    <div class="help-block">
      <h4>🩸 血战到底特有</h4>
      <p>• 一局打到 <b>3 家胡</b> 或 <b>流局</b> 结束（第 4 家不能独胡）</p>
      <p>• <b>已胡的人继续打牌</b>（不能再胡，但可以杠）</p>
      <p>• 结束后未胡的查听/查叫赔番，花猪赔 16/32 分</p>
      <p>• <b>先胡不给</b>：已胡玩家不付之后别人的杠钱和自摸分（但被点炮还要付）</p>
    </div>

    <div class="help-block">
      <h4>📝 本 app 怎么用</h4>
      <p>1. 向导填玩家名 / 规则 / 底分 → 开始</p>
      <p>2. 换三张可先摇骰子看换牌方向</p>
      <p>3. 实际打牌（app 不模拟摸打），有杠/胡就按顶部按钮记录</p>
      <p>4. 录入顺序错了可以点 <b>⏱</b> 调整</p>
      <p>5. 一局结束点 <b>下一局</b>，有未胡的进结算面板</p>
      <p>6. 累计分数看 <b>📜 历史</b></p>
    </div>

    <div class="help-block">
      <h4>🎲 摇骰子规则（换三张换牌方向）</h4>
      <p>• 2、6、10 → 下家换</p>
      <p>• 3、7、11 → 对家换</p>
      <p>• 4、8、12 → 上家换</p>
      <p>• 5、9 → 自己（要重摇）</p>
    </div>
  </div>`;
}

// ---------- 事件顺序编辑 ----------
function renderReorderView() {
  const events = state.currentRound.events;
  if (events.length === 0) {
    return `<div class="history-empty">本局还没有事件</div>`;
  }
  const p = state.players;
  const rows = events.map((ev, idx) => {
    let desc = "";
    if (ev.type === "gang") {
      const types = { bu: "补杠", dian: "点杠", an: "暗杠", zhi: "直杠" };
      desc = `<b>${p[ev.player]}</b> ${types[ev.gangType]}${ev.from !== null && ev.from !== undefined ? `（${p[ev.from]}点）` : ""}`;
    } else if (ev.type === "hu") {
      const rule = RULES[state.rule];
      const patName = rule.patterns.find(x => x.id === ev.pattern)?.name ?? ev.pattern;
      const way = ev.zimo ? "自摸" : `点炮（${p[ev.from]}）`;
      desc = `<b>${p[ev.player]}</b> 胡 ${patName}${ev.gen>0?`带${ev.gen}根`:""} ${way}`;
    } else if (ev.type === "settlement") {
      desc = `流局结算（${ev.result.length} 人参与）`;
    } else if (ev.type === "mahu") {
      desc = `<b>${p[ev.player]}</b> ⚠️ 麻胡 赔 3 家`;
    }
    const upDis = idx === 0 ? "disabled" : "";
    const downDis = idx === events.length - 1 ? "disabled" : "";
    return `<div class="reorder-row" data-idx="${idx}">
      <span class="reorder-handle" data-drag="${idx}">⋮⋮</span>
      <span class="reorder-idx">${idx + 1}.</span>
      <span class="reorder-desc">${desc}</span>
      <button data-xact="move-up" data-idx="${idx}" ${upDis}>↑</button>
      <button data-xact="move-down" data-idx="${idx}" ${downDis}>↓</button>
      <button data-xact="remove-event" data-idx="${idx}" class="reorder-del">✕</button>
    </div>`;
  }).join("");
  return `<div class="reorder-view">
    <div class="reorder-hint">按实际发生顺序调整。<b>拖 ⋮⋮</b> 或点 <b>↑↓</b> 移动，✕ 删除。</div>
    ${rows}
  </div>`;
}

// ---------- 历史视图 ----------
function renderHistory() {
  if (state.rounds.length === 0 && state.currentRound.events.length === 0) {
    return `<div class="history-empty">还没有任何局记录</div>`;
  }
  const totals = totalScores(state);
  const scoreStr = (s) => (s > 0 ? "+" : "") + s;
  const scoreCls = (s) => s > 0 ? "pos" : s < 0 ? "neg" : "";
  const totalsRow = state.players.map((n, i) =>
    `<span class="hist-player">${escapeHtml(n)} <b class="${scoreCls(totals[i])}">${scoreStr(totals[i])}</b></span>`
  ).join("");

  const roundsHtml = state.rounds.map((r, idx) => {
    const row = state.players.map((n, i) => {
      const s = r.scoreDelta[i];
      return `<span class="hist-player">${escapeHtml(n)} <b class="${scoreCls(s)}">${scoreStr(s)}</b></span>`;
    }).join("");
    const eventsHtml = r.events.map((ev, evIdx) =>
      `<div class="hist-event"><span class="hist-evidx">${evIdx+1}.</span> ${describeHistoryEvent(ev)}</div>`
    ).join("") || `<div class="hist-event hist-empty">（无事件记录）</div>`;
    return `<details class="hist-round">
      <summary class="hist-summary">
        <div class="hist-round-label">第 ${idx + 1} 局 · ${r.events.length} 条事件 <span class="hist-toggle-hint">▾</span></div>
        <div class="hist-row">${row}</div>
      </summary>
      <div class="hist-events">${eventsHtml}</div>
    </details>`;
  }).join("");

  let currentBlock = "";
  if (state.currentRound.events.length > 0) {
    const delta = currentRoundScores(state);
    const row = state.players.map((n, i) =>
      `<span class="hist-player">${escapeHtml(n)} <b class="${scoreCls(delta[i])}">${scoreStr(delta[i])}</b></span>`
    ).join("");
    currentBlock = `<div class="hist-round hist-current">
      <div class="hist-round-label">第 ${state.rounds.length + 1} 局（进行中） · ${state.currentRound.events.length} 条事件</div>
      <div class="hist-row">${row}</div>
    </div>`;
  }

  return `<div class="history-view">
    <div class="hist-total">
      <div class="hist-total-label">累计（全部）</div>
      <div class="hist-row">${totalsRow}</div>
    </div>
    ${roundsHtml}
    ${currentBlock}
  </div>`;
}

// ---------- 摇骰子工具 ----------
const DICE_DIR = {
  2:"next",  3:"across", 4:"prev",  5:"self",
  6:"next",  7:"across", 8:"prev",  9:"self",
  10:"next", 11:"across", 12:"prev"
};
const DIR_LABEL = { next: "下家换牌", across: "对家换牌", prev: "上家换牌", self: "⚠️ 摇到自己，请重摇" };

// 换三张换牌方向选点数
function renderDiceTool() {
  if (state.rule !== "huansanzhang") return "";
  const sumButtons = Array.from({length: 11}, (_, i) => {
    const s = i + 2;
    const sel = diceRoll === s ? "selected" : "";
    const dirCls = (DICE_DIR[s] === "self") ? "dice-self" : "";
    return `<button data-xact="dice-sum" data-s="${s}" class="${sel} ${dirCls}">${s}</button>`;
  }).join("");
  let direction = "";
  if (diceRoll !== null) {
    const dir = DICE_DIR[diceRoll] || "self";
    const p = state.players;
    let arrows = "";
    if (dir === "next")   arrows = `${p[0]} → ${p[1]} → ${p[2]} → ${p[3]} → ${p[0]}`;
    if (dir === "prev")   arrows = `${p[0]} → ${p[3]} → ${p[2]} → ${p[1]} → ${p[0]}`;
    if (dir === "across") arrows = `${p[0]} ↔ ${p[2]}　·　${p[1]} ↔ ${p[3]}`;
    if (dir === "self")   arrows = "实际重摇骰子后再选新的合计";
    const labelCls = dir === "self" ? "dice-direction dice-direction-warn" : "dice-direction";
    direction = `<div class="${labelCls}"><b>${diceRoll}</b> → <b>${DIR_LABEL[dir]}</b></div>
      <div class="dice-arrows">${arrows}</div>`;
  }
  return `<div class="dice-tool dice-tool-shown">
    <div class="dice-label">换三张摇骰子换牌 — 点击骰子合计：</div>
    <div class="dice-sum-row">${sumButtons}</div>
    ${direction}
  </div>`;
}

function huSetFromEvents(events) {
  const s = new Set();
  for (const ev of events) if (ev.type === "hu") s.add(ev.player);
  return s;
}

// 番数到常见牌型示例
const FAN_HINTS = {
  bloodbattle: {
    0: "平胡",
    1: "平胡带1根 / 大对子",
    2: "清一色 / 七对 / 金钩钓",
    3: "清大对 / 龙七对 / 将对",
    4: "清七对 / 清龙七对 / 天地胡"
  },
  huansanzhang: {
    0: "平胡",
    1: "平胡带1根 / 大对子",
    2: "清一色 / 七对 / 金钩钓",
    3: "清大对 / 龙七对 / 将对",
    4: "双龙七对 / 清七对 / 幺九带根",
    5: "清龙七对 / 天地胡"
  }
};

// ---------- 流局结算面板 ----------
function renderSettlementPanel() {
  const rule = RULES[state.rule];
  const huSet = huSetFromEvents(state.currentRound.events);
  const rows = [];
  for (let i = 0; i < 4; i++) {
    if (huSet.has(i)) {
      rows.push(`<div class="settle-row settle-row-hu">
        <span class="settle-name">${escapeHtml(state.players[i])}</span>
        <span class="settle-hu-tag">已胡 ✓</span>
      </div>`);
      continue;
    }
    const sel = settleSel[i] || { status: null, maxFan: 0 };
    const btnCls = (k) => sel.status === k ? "selected" : "";
    const hints = FAN_HINTS[state.rule] || {};
    const hasLoser = settleSel.some(s => s?.status === "weiting" || s?.status === "xianggong");
    let fanRow = "";
    if (sel.status === "tingpai" && hasLoser) {
      fanRow = `<div class="settle-fan-label">听的最大牌型：</div>
        <div class="settle-fan-grid">${
        Array.from({length: rule.capFan + 1}, (_, g) =>
          `<button data-xact="settle-fan" data-sp="${i}" data-fan="${g}" class="${sel.maxFan === g ? 'selected' : ''}">
            <div class="fan-num">${g}番</div>
            <div class="fan-hint">${hints[g] || ""}</div>
          </button>`
        ).join("")
      }</div>`;
    }
    rows.push(`<div class="settle-row">
      <span class="settle-name">${escapeHtml(state.players[i])}</span>
      <div class="settle-status-row">
        <button data-xact="settle-pick" data-sp="${i}" data-kind="huazhu" class="${btnCls('huazhu')}">花猪</button>
        <button data-xact="settle-pick" data-sp="${i}" data-kind="tingpai" class="${btnCls('tingpai')}">已听</button>
        <button data-xact="settle-pick" data-sp="${i}" data-kind="weiting" class="${btnCls('weiting')}">未听</button>
        <button data-xact="settle-pick" data-sp="${i}" data-kind="xianggong" class="${btnCls('xianggong')}">相公</button>
      </div>
      ${fanRow}
    </div>`);
  }

  // 所有未胡玩家必须选好状态（听 还需有 fan）
  const allDone = state.players.every((_, i) => {
    if (huSet.has(i)) return true;
    const s = settleSel[i];
    if (!s || !s.status) return false;
    return true;
  });

  // 结算预览
  let preview = "";
  if (allDone) {
    const result = [];
    for (let i = 0; i < 4; i++) {
      if (huSet.has(i)) continue;
      const s = settleSel[i];
      const entry = { player: i, kind: s.status };
      if (s.status === "tingpai") entry.maxFan = s.maxFan || 0;
      result.push(entry);
    }
    const pairs = settlementPairwise(rule, state.baseScore, { result });
    if (pairs.length === 0) {
      preview = `<div class="settle-preview settle-preview-empty">本局结算无付款（全部听相同番数或全部未听）<br><b>可以直接进下一局 ✓</b></div>`;
    } else {
      // 按付款方分组 → 每人一行
      const perPlayer = state.players.map(() => ({ recv: [], pay: [] }));
      for (const p of pairs) {
        perPlayer[p.to].recv.push({ idx: p.from, amt: p.amount, kind: p.kind });
        perPlayer[p.from].pay.push({ idx: p.to, amt: p.amount, kind: p.kind });
      }
      const lines = state.players.map((n, i) => {
        const parts = [];
        if (perPlayer[i].recv.length) {
          parts.push(`<span class="sp-recv">收 ${perPlayer[i].recv.map(r => `${escapeHtml(state.players[r.idx])} ${r.amt}(${r.kind})`).join("、")}</span>`);
        }
        if (perPlayer[i].pay.length) {
          parts.push(`<span class="sp-pay">付 ${perPlayer[i].pay.map(r => `${escapeHtml(state.players[r.idx])} ${r.amt}(${r.kind})`).join("、")}</span>`);
        }
        if (parts.length === 0) return "";
        return `<div class="sp-row"><b>${escapeHtml(n)}：</b> ${parts.join("　")}</div>`;
      }).filter(Boolean).join("");
      preview = `<div class="settle-preview"><div class="settle-preview-label">结算预览</div>${lines}</div>`;
    }
  }

  return `<div class="picker-panel">
    <div class="picker-title">流局结算</div>
    <div class="settle-sub">默认全部已听 0番，有花猪 / 未听 / 相公再改。<br>有未听或相公时才需要选"听的最大牌型"。</div>
    ${rows.join("")}
    ${preview}
    <div class="picker-buttons">
      <button data-xact="settle-cancel">取消</button>
      <button data-xact="settle-confirm" class="primary" ${allDone ? "" : "disabled"}>结算并进下一局</button>
    </div>
  </div>`;
}

// ---------- 顶部动作面板 ----------
function renderActionPanel() {
  const btn = (act, label, extra = "") => {
    const on = actionMode === act ? "active" : "";
    return `<button data-gact="${act}" class="${on} ${extra}">${label}</button>`;
  };
  const bar = `<div class="global-actions">
    ${btn("bu",   "补杠")}
    ${btn("dian", "点杠")}
    ${btn("zhi",  "直杠")}
    ${btn("an",   "暗杠")}
    ${btn("hu",   "胡", "hu-btn")}
  </div>`;

  let body = "";
  if (actionMode === "bu" || actionMode === "zhi" || actionMode === "an") {
    body = renderPlayerPicker(`${shortLabel(actionMode)}：谁？`, null, "gang-player");
  } else if (actionMode === "dian") {
    body = renderDianCombined();
  } else if (actionMode === "hu") {
    if (actionPlayer === null) {
      body = renderHuPickerWithMahu();
    } else {
      body = renderHuForm(actionPlayer);
    }
  }
  return bar + body;
}

function renderDianCombined() {
  const gangBtns = state.players.map((n, i) => {
    const sel = actionPlayer === i ? "selected" : "";
    const disabled = gangDianFrom === i ? "disabled" : "";
    return `<button data-xact="dian-gang-pick" data-pi="${i}" class="${sel}" ${disabled}>${escapeHtml(n)}</button>`;
  }).join("");
  const fromBtns = state.players.map((n, i) => {
    const sel = gangDianFrom === i ? "selected" : "";
    const disabled = actionPlayer === i ? "disabled" : "";
    return `<button data-xact="dian-from-pick" data-pi="${i}" class="${sel}" ${disabled}>${escapeHtml(n)}</button>`;
  }).join("");
  const canConfirm = actionPlayer !== null && gangDianFrom !== null && actionPlayer !== gangDianFrom;
  return `<div class="picker-panel">
    <div class="picker-title">点杠</div>
    <div class="picker-sublabel">谁接的（杠上那人）</div>
    <div class="picker-row">${gangBtns}</div>
    <div class="picker-sublabel">谁点的（放牌那人）</div>
    <div class="picker-row">${fromBtns}</div>
    <div class="picker-buttons">
      <button data-xact="cancel">取消</button>
      <button data-xact="dian-confirm" class="primary" ${canConfirm ? "" : "disabled"}>确认</button>
    </div>
  </div>`;
}

function renderHuPickerWithMahu() {
  const rule = RULES[state.rule];
  const penalty = rule.penalty * state.baseScore;
  const huBtns = state.players.map((n, i) =>
    `<button data-xact="pick" data-role="hu-player" data-pi="${i}">${escapeHtml(n)}</button>`
  ).join("");
  const mahuBtns = state.players.map((n, i) =>
    `<button data-xact="pick" data-role="mahu-player" data-pi="${i}">${escapeHtml(n)}</button>`
  ).join("");
  return `<div class="picker-panel">
    <div class="picker-title">谁胡了？</div>
    <div class="picker-row">${huBtns}</div>
    <div class="picker-subsection">⚠️ 或声胡失败（麻胡，赔 3 家每人 ${penalty} 元）</div>
    <div class="picker-row mahu-row">${mahuBtns}</div>
    <div class="picker-buttons">
      <button data-xact="cancel">取消</button>
    </div>
  </div>`;
}

function shortLabel(act) {
  return { bu: "补杠", zhi: "直杠", an: "暗杠", dian: "点杠", hu: "胡" }[act] || act;
}

function renderPlayerPicker(title, excludeIdx, role) {
  const buttons = state.players.map((n, i) => {
    if (excludeIdx !== null && i === excludeIdx) return "";
    const sel = (role === "dian-from" && gangDianFrom === i) ? "selected" : "";
    return `<button data-xact="pick" data-role="${role}" data-pi="${i}" class="${sel}">${escapeHtml(n)}</button>`;
  }).join("");
  return `<div class="picker-panel">
    <div class="picker-title">${title}</div>
    <div class="picker-row">${buttons}</div>
    <div class="picker-buttons">
      <button data-xact="cancel">取消</button>
    </div>
  </div>`;
}

// ---------- 胡表单（含牌型/根/加番） ----------
function renderHuForm(i) {
  const rule = RULES[state.rule];
  const patMeta = rule.patterns.find(p => p.id === huSel.pattern);
  const maxGen = patMeta?.maxGen ?? 0;
  const noBonus = !!patMeta?.noBonus;
  const zimoOnly = !!patMeta?.zimoOnly;

  const others = state.players
    .map((n, idx) => ({ n, idx }))
    .filter(x => x.idx !== i);
  const fromButtons = others.map(o => {
    const sel = huSel.from === o.idx ? "selected" : "";
    return `<button data-xact="hu-from" data-fi="${o.idx}" class="${sel}">${escapeHtml(o.n)}</button>`;
  }).join("");

  // 牌型网格：常用置顶，其余折叠
  const common = rule.patterns.filter(p => p.common);
  const rest = rule.patterns.filter(p => !p.common);
  const patternLabel = (p) => {
    const sel = huSel.pattern === p.id ? "selected" : "";
    return `<label class="${sel}"><input type="radio" name="hpattern" value="${p.id}" ${sel?"checked":""}>${p.name}</label>`;
  };
  const commonGrid = `<div class="pattern-grid">${common.map(patternLabel).join("")}</div>`;
  const selectedInRest = rest.some(p => p.id === huSel.pattern);
  const effectiveRestGrid = (showMorePatterns || selectedInRest)
    ? `<div class="pattern-grid">${rest.map(patternLabel).join("")}</div>`
    : "";
  const effectiveMoreBtn = selectedInRest
    ? ""
    : `<button type="button" class="more-toggle" data-xact="toggle-more">${showMorePatterns ? "收起 ▴" : "更多牌型 ▾"}</button>`;

  const hints = {
    jingoudiao: "手上 4 副刻子已锁定，最后单钓一张配将",
    qingjingoudiao: "清一色 + 金钩钓",
    tianhu: "仅庄家：开局 14 张直接胡",
    dihu: "闲家：第一圈内胡牌",
    qiduai: "7 对不同对子",
    longqiduai: "7 对中含一个 4 张相同（暗杠形式）"
  };
  const hint = hints[huSel.pattern] ? `<div class="pattern-hint">${hints[huSel.pattern]}</div>` : "";

  const genOpts = [];
  for (let g = 0; g <= maxGen; g++) {
    const chk = g === huSel.gen ? "checked" : "";
    genOpts.push(`<label class="pill-option"><input type="radio" name="hgen" value="${g}" ${chk}> ${g} 根</label>`);
  }

  const bonusInputs = ["gangshang", "qianggang", "haidi"].map(k => {
    const chk = huSel.bonuses.includes(k) ? "checked" : "";
    const dis = noBonus ? "disabled" : "";
    return `<label class="pill-option pill-check ${dis ? 'disabled' : ''}"><input type="checkbox" data-bonus="${k}" value="${k}" ${chk} ${dis}> ${BONUS_NAMES[k]}</label>`;
  }).join("");

  const zimoChk = huSel.zimo === true ? "checked" : "";
  const dianpaoChk = huSel.zimo === false ? "checked" : "";
  const dianpaoDis = zimoOnly ? "disabled" : "";
  const fromSection = huSel.zimo === false
    ? `<label>点炮者</label><div class="player-row">${fromButtons}</div>`
    : "";
  const genSection = maxGen > 0
    ? `<label>根数</label><div class="pill-row">${genOpts.join("")}</div>`
    : "";
  const preview = computePreview(i);
  const canConfirm = isHuValid(i);

  return `<div class="picker-panel">
    <div class="picker-title">${state.players[i]} 胡</div>
    <label>方式</label>
    <div class="pill-row">
      <label class="pill-option"><input type="radio" name="hway" value="zimo" ${zimoChk}> 自摸</label>
      <label class="pill-option ${dianpaoDis ? 'disabled' : ''}"><input type="radio" name="hway" value="dianpao" ${dianpaoChk} ${dianpaoDis}> 点炮</label>
    </div>
    ${fromSection}
    <label>牌型</label>
    ${commonGrid}
    ${effectiveRestGrid}
    ${effectiveMoreBtn}
    ${hint}
    ${genSection}
    <label>加番</label>
    <div class="pill-row">${bonusInputs}</div>
    <div class="preview">${preview}</div>
    <div class="picker-buttons">
      <button data-xact="cancel">取消</button>
      <button data-xact="hu-confirm" class="primary" ${canConfirm ? "" : "disabled"}>确认</button>
    </div>
  </div>`;
}

function isHuValid(i) {
  if (huSel.zimo === null || huSel.pattern === null) return false;
  if (!huSel.zimo && (huSel.from === null || huSel.from === i)) return false;
  return true;
}

function computePreview(i) {
  if (!isHuValid(i)) return "—";
  const rule = RULES[state.rule];
  const hu = { pattern: huSel.pattern, gen: huSel.gen, zimo: huSel.zimo, bonuses: huSel.bonuses };
  const fan = computeFan(rule, hu);
  const score = computeScore(rule, hu, state.baseScore);
  const wayStr = huSel.zimo ? "自摸" : `点炮(${state.players[huSel.from]})`;
  const patName = rule.patterns.find(p => p.id === huSel.pattern).name;
  const genStr = huSel.gen > 0 ? `带${huSel.gen}根` : "";
  const bonusStr = huSel.bonuses.length
    ? "+" + huSel.bonuses.map(b => BONUS_NAMES[b]).join("+")
    : "";
  return `${state.players[i]} ${wayStr} ${patName}${genStr}${bonusStr} → ${fan}番 = ${score}元`;
}

// ---------- 玩家卡片（纯展示，无按钮） ----------
function renderPlayerCard(i, name, score) {
  const cls = score > 0 ? "pos" : score < 0 ? "neg" : "";
  const scoreStr = (score > 0 ? "+" : "") + score;
  const txnsHtml = renderCardTransactions(i);
  const eventsHtml = renderCardEvents(i);
  return `<div class="player-card">
    <div class="card-top">
      <div class="pname-wrap">
        <span class="player-badge">${i + 1}</span>
        <span class="pname" data-pname="${i}">${escapeHtml(name)}</span>
      </div>
      <span class="pscore ${cls}">${scoreStr}</span>
    </div>
    ${txnsHtml}
    ${eventsHtml}
  </div>`;
}

function eventShortLabel(ev) {
  if (ev.type === "hu") return ev.zimo ? "自摸" : "点炮";
  if (ev.type === "settlement") return "结算";
  if (ev.type === "mahu") return "麻胡";
  const map = { bu: "补杠", dian: "点杠", an: "暗杠", zhi: "直杠" };
  return map[ev.gangType] || "杠";
}

function renderCardTransactions(i) {
  const rule = RULES[state.rule];
  const events = state.currentRound.events;
  const perOpp = [[], [], [], []];
  const huSet = new Set();
  const lastGang = new Map();
  for (const ev of events) {
    const pairs = eventPairwise(rule, state.baseScore, ev, huSet, lastGang);
    const baseLabel = eventShortLabel(ev);
    // 点炮胡 + gangshang 时有 2 笔 pair：第 1 笔胡分，第 2 笔转雨
    // 自摸胡本身就有 3 笔（每家一份）都是"自摸"不是转雨
    // 结算 pair 自带 kind（花猪/查听）
    pairs.forEach((p, idx) => {
      let label;
      if (p.kind) label = p.kind;
      else if (ev.type === "hu" && ev.from !== null && idx > 0) label = "转雨";
      else label = baseLabel;
      if (p.from === i)      perOpp[p.to].push({ dir: "pay", amt: p.amount, src: label });
      else if (p.to === i)   perOpp[p.from].push({ dir: "recv", amt: p.amount, src: label });
    });
    if (ev.type === "hu") {
      huSet.add(ev.player);
    } else if (ev.type === "gang") {
      const income = pairs.reduce((a, p) => p.to === ev.player ? a + p.amount : a, 0);
      lastGang.set(ev.player, { amount: income });
    }
  }
  const activePairs = [];
  for (let j = 0; j < 4; j++) {
    if (j === i) continue;
    if (perOpp[j].length === 0) continue;
    const net = perOpp[j].reduce((a, t) => a + (t.dir === "recv" ? t.amt : -t.amt), 0);
    activePairs.push({ j, txns: perOpp[j], net });
  }
  if (activePairs.length === 0) return "";

  const summaryParts = activePairs.map(p => {
    if (p.net === 0) {
      return `<span class="txsum-zero"><span class="txsum-name">${escapeHtml(state.players[p.j])}</span> <b>0</b></span>`;
    }
    const cls = p.net > 0 ? "txsum-pos" : "txsum-neg";
    const str = p.net > 0 ? `+${p.net}` : `${p.net}`;
    return `<span class="${cls}"><span class="txsum-name">${escapeHtml(state.players[p.j])}</span> <b>${str}</b></span>`;
  }).join(`<span class="txsum-sep">·</span>`);

  const detailRows = activePairs.map(p => {
    const netCls = p.net > 0 ? "tx-net-pos" : p.net < 0 ? "tx-net-neg" : "tx-net-zero";
    const netStr = p.net > 0 ? `+${p.net}` : `${p.net}`;
    const txnStrs = p.txns.map(t => {
      const cls = t.dir === "recv" ? "tx-recv" : "tx-pay";
      const word = t.dir === "recv" ? "收" : "付";
      return `<span class="${cls}">${word} ${t.amt}</span><span class="tx-src">(${t.src})</span>`;
    }).join(`<span class="tx-sep">·</span>`);
    return `<div class="tx-row">
      <span class="tx-opp">${escapeHtml(state.players[p.j])}</span>
      <span class="tx-body">${txnStrs}</span>
      <span class="tx-net ${netCls}">= ${netStr}</span>
    </div>`;
  }).join("");

  const openAttr = txClosedSet.has(i) ? "" : "open";
  return `<details class="card-txns" data-txi="${i}" ${openAttr}>
    <summary class="tx-summary">${summaryParts}</summary>
    <div class="tx-detail">${detailRows}</div>
  </details>`;
}

function renderCardEvents(i) {
  const events = state.currentRound.events;
  const rule = RULES[state.rule];
  const rows = [];
  const huSet = new Set();
  const lastGang = new Map();
  events.forEach((ev, idx) => {
    // 维护 huSet/lastGang 以便正确描述某些事件
    if (ev.player === i) {
      const cls = ev.type === "hu" ? "hu" : "gang";
      const main = describeEvent(ev);
      const breakdown = eventBreakdown(ev, lastGang);
      const bd = breakdown ? `<div class="event-breakdown">${breakdown}</div>` : "";
      rows.push(
        `<div class="event-row ${cls}"><div class="event-text"><div>${main}</div>${bd}</div><button class="undo" data-undo="${idx}">✕</button></div>`
      );
    }
    // 更新累计状态
    if (ev.type === "hu") huSet.add(ev.player);
    else if (ev.type === "gang") {
      const pairs = eventPairwise(rule, state.baseScore, ev, huSet);
      const income = pairs.reduce((a, p) => p.to === ev.player ? a + p.amount : a, 0);
      lastGang.set(ev.player, { amount: income });
    }
  });
  if (rows.length === 0) return "";
  rows.reverse();
  return `<div class="card-events">${rows.join("")}</div>`;
}

function describeEvent(ev) {
  const p = state.players;
  const rule = RULES[state.rule];
  if (ev.type === "mahu") {
    const penalty = rule.penalty * state.baseScore;
    return `⚠️ 麻胡 → 赔 3 家每人 ${penalty} 元`;
  }
  if (ev.type === "gang") {
    const types = { bu: "补杠", dian: "点杠", an: "暗杠", zhi: "直杠" };
    const unit = rule.gangPoint[ev.gangType] * state.baseScore;
    if (ev.gangType === "dian") return `${types[ev.gangType]}（${p[ev.from]}点）→ 收 ${unit} 元`;
    return `${types[ev.gangType]} → 每家 ${unit} 元`;
  }
  if (ev.type === "hu") {
    const patName = rule.patterns.find(x => x.id === ev.pattern)?.name ?? ev.pattern;
    const way = ev.zimo ? "自摸" : `点炮（${p[ev.from]}）`;
    const gen = ev.gen > 0 ? `带${ev.gen}根` : "";
    const bonuses = ev.bonuses.map(b => BONUS_NAMES[b]).join("+");
    const bonusStr = bonuses ? `+${bonuses}` : "";
    const fan = computeFan(rule, ev);
    const score = computeScore(rule, ev, state.baseScore);
    return `胡 ${patName}${gen} ${way}${bonusStr} → <b>${fan}番 ${score}元</b>`;
  }
  return JSON.stringify(ev);
}

// 番数分解 + 转雨金额（胡事件专用）
function eventBreakdown(ev, lastGang) {
  if (ev.type !== "hu") return "";
  const rule = RULES[state.rule];
  const pat = rule.patterns.find(p => p.id === ev.pattern);
  const fanTable = rule.patternFan[ev.pattern];
  const baseFan = fanTable[ev.gen] ?? fanTable[fanTable.length - 1];
  const parts = [`${pat.name}${ev.gen > 0 ? `带${ev.gen}根` : ""} ${baseFan}番`];
  if (ev.zimo) parts.push("自摸 +1");
  if (!pat.noBonus) {
    ev.bonuses.forEach(b => parts.push(`${BONUS_NAMES[b]} +1`));
  }
  const rawFan = baseFan + (ev.zimo ? 1 : 0) + (pat.noBonus ? 0 : ev.bonuses.length);
  let tail = "";
  if (rawFan > rule.capFan) tail = `（${rawFan}番封顶 ${rule.capFan}番）`;
  // 转雨说明
  if (ev.from !== null && ev.bonuses?.includes("gangshang")) {
    const prev = lastGang.get(ev.from);
    if (prev && prev.amount > 0) {
      tail += `　· 转雨 ${prev.amount}元（${state.players[ev.from]}→${state.players[ev.player]}）`;
    }
  }
  return parts.join(" · ") + tail;
}

// ---------- 事件代理 ----------
$("#main").addEventListener("click", (e) => {
  const gBtn = e.target.closest("button[data-gact]");
  if (gBtn) {
    handleGlobalActionButton(gBtn.dataset.gact);
    return;
  }
  const xBtn = e.target.closest("button[data-xact]");
  if (xBtn) {
    handleExpansionButton(xBtn.dataset.xact, xBtn);
    return;
  }
  const pn = e.target.closest("[data-pname]");
  if (pn) {
    const i = Number(pn.dataset.pname);
    const newName = prompt("改名：", state.players[i]);
    if (newName && newName.trim()) {
      state = { ...state, players: state.players.map((p, j) => j === i ? newName.trim() : p) };
      saveState(state);
      renderMain();
    }
    return;
  }
  const u = e.target.closest("button[data-undo]");
  if (u) {
    state = removeEventAt(state, Number(u.dataset.undo));
    saveState(state);
    resetAction();
    renderMain();
    return;
  }
});

function handleGlobalActionButton(act) {
  // 再点同一按钮 = 取消
  if (actionMode === act) {
    resetAction();
    renderMain();
    return;
  }
  resetAction();
  actionMode = act;
  renderMain();
}

function handleExpansionButton(xact, btn) {
  if (xact === "cancel") {
    resetAction();
    renderMain();
    return;
  }
  if (xact === "pick") {
    const role = btn.dataset.role;
    const pi = Number(btn.dataset.pi);
    if (role === "gang-player") {
      // 补/直/暗杠：选完玩家即记录
      const labels = { bu: "补杠", zhi: "直杠", an: "暗杠" };
      state = addEvent(state, { type: "gang", player: pi, gangType: actionMode, from: null });
      saveState(state);
      toast(`${state.players[pi]} ${labels[actionMode]}`);
      resetAction();
      renderMain();
      return;
    }
    if (role === "hu-player") {
      actionPlayer = pi;
      // 自动识别根数：本局已录的、此人做过的杠数量
      const ganged = state.currentRound.events.filter(
        ev => ev.type === "gang" && ev.player === pi
      ).length;
      const patMeta = RULES[state.rule].patterns.find(p => p.id === huSel.pattern);
      const maxGen = patMeta?.maxGen ?? 0;
      huSel.gen = Math.min(ganged, maxGen);
      renderMain();
      return;
    }
    if (role === "mahu-player") {
      if (!confirm(`${state.players[pi]} 麻胡，将赔 3 家共 ${RULES[state.rule].penalty * state.baseScore * 3} 元。确认？`)) return;
      state = addEvent(state, { type: "mahu", player: pi });
      saveState(state);
      toast(`${state.players[pi]} 麻胡`, "warn");
      resetAction();
      renderMain();
      return;
    }
  }
  if (xact === "dian-gang-pick") {
    actionPlayer = Number(btn.dataset.pi);
    if (gangDianFrom === actionPlayer) gangDianFrom = null;
    renderMain();
    return;
  }
  if (xact === "dian-from-pick") {
    gangDianFrom = Number(btn.dataset.pi);
    if (actionPlayer === gangDianFrom) actionPlayer = null;
    renderMain();
    return;
  }
  if (xact === "dian-confirm") {
    if (actionPlayer === null || gangDianFrom === null || actionPlayer === gangDianFrom) return;
    state = addEvent(state, { type: "gang", player: actionPlayer, gangType: "dian", from: gangDianFrom });
    saveState(state);
    toast(`${state.players[actionPlayer]} 点杠（${state.players[gangDianFrom]}点）`);
    resetAction();
    renderMain();
    return;
  }
  if (xact === "hu-from") {
    huSel.from = Number(btn.dataset.fi);
    renderMain();
    return;
  }
  if (xact === "hu-confirm") {
    if (!isHuValid(actionPlayer)) return;
    const playerIdx = actionPlayer;
    const way = huSel.zimo ? "自摸" : "点炮";
    state = addEvent(state, {
      type: "hu",
      player: actionPlayer,
      from: huSel.zimo ? null : huSel.from,
      zimo: huSel.zimo,
      pattern: huSel.pattern,
      gen: huSel.gen,
      bonuses: [...huSel.bonuses]
    });
    saveState(state);
    toast(`${state.players[playerIdx]} 胡 ${way}`);
    resetAction();
    renderMain();
    // 3 胡自动提示结算（血战到底 3 家胡即终局）
    const huSet = huSetFromEvents(state.currentRound.events);
    if (huSet.size === 3) {
      setTimeout(() => {
        if (confirm("已 3 家胡，开始流局结算？\n（取消则继续录入，可以补录后面的杠）")) {
          settleSel = state.players.map(() => ({ status: "tingpai", maxFan: 0 }));
          settlingMode = true;
          resetAction();
          renderMain();
        }
      }, 300);
    }
    return;
  }
  if (xact === "toggle-more") {
    showMorePatterns = !showMorePatterns;
    renderMain();
    return;
  }
  if (xact === "settle-pick") {
    const sp = Number(btn.dataset.sp);
    const kind = btn.dataset.kind;
    settleSel[sp] = { status: kind, maxFan: settleSel[sp]?.maxFan ?? 0 };
    renderMain();
    return;
  }
  if (xact === "settle-fan") {
    const sp = Number(btn.dataset.sp);
    const fan = Number(btn.dataset.fan);
    if (settleSel[sp]) settleSel[sp].maxFan = fan;
    renderMain();
    return;
  }
  if (xact === "settle-cancel") {
    settlingMode = false;
    settleSel = [null, null, null, null];
    renderMain();
    return;
  }
  if (xact === "dice-sum") {
    diceRoll = Number(btn.dataset.s);
    renderMain();
    return;
  }
  if (xact === "history-toggle") {
    historyMode = !historyMode;
    if (historyMode) reorderMode = false;
    renderMain();
    return;
  }
  if (xact === "reorder-toggle") {
    reorderMode = !reorderMode;
    if (reorderMode) { historyMode = false; helpMode = false; }
    renderMain();
    return;
  }
  if (xact === "help-toggle") {
    helpMode = !helpMode;
    if (helpMode) { historyMode = false; reorderMode = false; }
    renderMain();
    return;
  }
  if (xact === "remove-event") {
    pushUndo("删除事件");
    state = removeEventAt(state, Number(btn.dataset.idx));
    saveState(state);
    renderMain();
    return;
  }
  if (xact === "move-up") {
    pushUndo("上移事件");
    state = moveEventBy(state, Number(btn.dataset.idx), -1);
    saveState(state);
    renderMain();
    return;
  }
  if (xact === "move-down") {
    pushUndo("下移事件");
    state = moveEventBy(state, Number(btn.dataset.idx), 1);
    saveState(state);
    renderMain();
    return;
  }
  if (xact === "undo") {
    const entry = popUndo();
    if (entry) {
      state = entry.state;
      saveState(state);
      resetAction();
      renderMain();
    }
    return;
  }
  if (xact === "settle-confirm") {
    debounced("settle-confirm", () => {
      const huSet = huSetFromEvents(state.currentRound.events);
      const result = [];
      for (let i = 0; i < 4; i++) {
        if (huSet.has(i)) continue;
        const s = settleSel[i];
        if (!s || !s.status) return;
        const entry = { player: i, kind: s.status };
        if (s.status === "tingpai") entry.maxFan = s.maxFan || 0;
        result.push(entry);
      }
      pushUndo("流局结算");
      state = addEvent(state, { type: "settlement", result });
      state = endRound(state);
      saveState(state);
      settlingMode = false;
      settleSel = [null, null, null, null];
      diceRoll = null;
      resetAction();
      renderMain();
    });
    return;
  }
}

// 顺序页拖拽（pointer events，同时支持鼠标和触摸）
let dragState = null;

function clearDragVisuals() {
  document.querySelectorAll(".reorder-row").forEach(r => {
    r.classList.remove("dragging", "drop-above", "drop-below");
    r.style.transform = "";
  });
}

$("#main").addEventListener("pointerdown", (e) => {
  const handle = e.target.closest(".reorder-handle");
  if (!handle) return;
  const row = handle.closest(".reorder-row");
  if (!row) return;
  e.preventDefault();
  const rect = row.getBoundingClientRect();
  dragState = {
    srcIdx: Number(row.dataset.idx),
    srcEl: row,
    offsetY: e.clientY - (rect.top + rect.height / 2),
    targetIdx: null,
    targetPos: null // "above" | "below"
  };
  row.classList.add("dragging");
  handle.setPointerCapture(e.pointerId);
});

$("#main").addEventListener("pointermove", (e) => {
  if (!dragState) return;
  // 源行跟着光标上下移动
  const srcRect = dragState.srcEl.getBoundingClientRect();
  const srcMidOriginal = srcRect.top + srcRect.height / 2 - parseFloat(dragState.srcEl.style.transform.match(/-?\d+/)?.[0] || 0);
  // 简化：用 clientY 相对位置直接设置 transform
  const baselineY = dragState.srcEl.offsetTop + dragState.srcEl.offsetHeight / 2;
  const parentRect = dragState.srcEl.parentElement.getBoundingClientRect();
  const relY = e.clientY - parentRect.top;
  const dy = relY - (dragState.srcEl.offsetTop + dragState.srcEl.offsetHeight / 2);
  dragState.srcEl.style.transform = `translateY(${dy}px)`;

  // 决定目标位置
  const rows = document.querySelectorAll(".reorder-row");
  let targetIdx = null, targetPos = null;
  for (const r of rows) {
    if (r === dragState.srcEl) continue;
    const rect = r.getBoundingClientRect();
    if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
      targetIdx = Number(r.dataset.idx);
      targetPos = (e.clientY < rect.top + rect.height / 2) ? "above" : "below";
      break;
    }
  }
  dragState.targetIdx = targetIdx;
  dragState.targetPos = targetPos;

  rows.forEach(r => {
    r.classList.remove("drop-above", "drop-below");
  });
  if (targetIdx !== null) {
    const tRow = document.querySelector(`.reorder-row[data-idx="${targetIdx}"]`);
    if (tRow) tRow.classList.add(targetPos === "above" ? "drop-above" : "drop-below");
  }
});

$("#main").addEventListener("pointerup", () => {
  if (!dragState) return;
  const { srcIdx, targetIdx, targetPos } = dragState;
  clearDragVisuals();
  if (targetIdx !== null && targetIdx !== srcIdx) {
    // 计算最终位置
    let destIdx = targetPos === "above" ? targetIdx : targetIdx + 1;
    // 如果 src < destIdx，删除 src 后 dest 要 -1
    if (srcIdx < destIdx) destIdx -= 1;
    if (destIdx !== srcIdx) {
      pushUndo("拖动事件");
      state = moveEventTo(state, srcIdx, destIdx);
      saveState(state);
      renderMain();
      dragState = null;
      return;
    }
  }
  dragState = null;
});

$("#main").addEventListener("pointercancel", () => {
  clearDragVisuals();
  dragState = null;
});

// <details> 折叠状态追踪（toggle 事件不冒泡，需捕获阶段）
$("#main").addEventListener("toggle", (e) => {
  const d = e.target;
  if (d.tagName !== "DETAILS" || d.dataset.txi === undefined) return;
  const i = Number(d.dataset.txi);
  if (d.open) txClosedSet.delete(i);
  else txClosedSet.add(i);
}, true);

$("#main").addEventListener("change", (e) => {
  if (e.target.name === "hway") {
    huSel.zimo = (e.target.value === "zimo");
    if (huSel.zimo) huSel.from = null;
    renderMain();
    return;
  }
  if (e.target.name === "hgen") {
    huSel.gen = Number(e.target.value);
    renderMain();
    return;
  }
  if (e.target.name === "hpattern") {
    huSel.pattern = e.target.value || null;
    const rule = RULES[state.rule];
    const meta = rule.patterns.find(p => p.id === huSel.pattern);
    if (meta?.zimoOnly) { huSel.zimo = true; huSel.from = null; }
    if (meta?.noBonus) { huSel.bonuses = []; }
    const maxGen = meta?.maxGen ?? 0;
    if (huSel.gen > maxGen) huSel.gen = maxGen;
    renderMain();
    return;
  }
  if (e.target.matches("[data-bonus]")) {
    const k = e.target.dataset.bonus;
    if (e.target.checked) {
      if (!huSel.bonuses.includes(k)) huSel.bonuses.push(k);
    } else {
      huSel.bonuses = huSel.bonuses.filter(x => x !== k);
    }
    renderMain();
    return;
  }
});

// ---------- Footer ----------
$("#btn-new-session").addEventListener("click", () => {
  const n = state?.rounds?.length ?? 0;
  const hasCurrent = state?.currentRound?.events?.length > 0;
  let msg;
  if (n === 0 && !hasCurrent) {
    msg = "确认开新场？将重置玩家和规则，回到向导页。";
  } else {
    const parts = [];
    if (n > 0) parts.push(`已完成 ${n} 局`);
    if (hasCurrent) parts.push(`当前局 ${state.currentRound.events.length} 条事件`);
    msg = `确认开新场？当前场（${parts.join("、")}）的全部数据将删除，无法恢复。`;
  }
  if (!confirm(msg)) return;
  state = null;
  localStorage.removeItem("chuanma.state");
  [0, 1, 2, 3].forEach(i => $("#p" + i).value = "");
  resetAction();
  renderRoute();
});

$("#btn-reset-round").addEventListener("click", () => {
  if (state.currentRound.events.length === 0) return;
  if (!confirm("清空本局全部事件，重新开始录入？（往局历史和玩家名保留）")) return;
  pushUndo("重置本局");
  state = { ...state, currentRound: { events: [] } };
  saveState(state);
  settlingMode = false;
  settleSel = [null, null, null, null];
  diceRoll = null;
  resetAction();
  renderMain();
});

$("#btn-end-round").addEventListener("click", () => debounced("end-round", () => {
  if (state.currentRound.events.length === 0) return;
  const huSet = huSetFromEvents(state.currentRound.events);
  if (huSet.size >= 4) {
    pushUndo("下一局");
    state = endRound(state);
    saveState(state);
    diceRoll = null;
    resetAction();
    renderMain();
    return;
  }
  settleSel = state.players.map(() => ({ status: "tingpai", maxFan: 0 }));
  settlingMode = true;
  resetAction();
  renderMain();
}));

renderRoute();

// PWA: 注册 service worker（HTTPS 或 localhost 才有效）
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(err =>
      console.warn("service worker 注册失败（非 https 时正常）:", err)
    );
  });
}
