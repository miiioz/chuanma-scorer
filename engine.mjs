// 纯函数记分引擎

export function computeFan(rule, hu) {
  const { pattern, gen = 0, zimo = false, bonuses = [] } = hu;
  const table = rule.patternFan[pattern];
  if (!table) throw new Error(`unknown pattern: ${pattern}`);
  const base = table[gen] ?? table[table.length - 1];
  const patternMeta = rule.patterns.find(p => p.id === pattern);
  const zimoBonus = (zimo && !patternMeta?.zimoNoBonus) ? 1 : 0;
  const extraBonuses = patternMeta?.noBonus ? 0 : bonuses.length;
  return Math.min(base + zimoBonus + extraBonuses, rule.capFan);
}

export function computeScore(rule, hu, baseScore) {
  return (2 ** computeFan(rule, hu)) * baseScore;
}

export function applyHuEvent(rule, baseScore, scores, event, huSet = new Set(), lastGang = new Map()) {
  const next = [...scores];
  const score = computeScore(rule, event, baseScore);
  if (event.from === null) {
    // 自摸：先胡不给，已胡玩家不付
    let payers = 0;
    for (let i = 0; i < 4; i++) {
      if (i === event.player) continue;
      if (huSet.has(i)) continue;
      next[i] -= score;
      payers++;
    }
    next[event.player] += score * payers;
  } else {
    // 点炮：点炮者付（不管 from 是否已胡）
    next[event.player] += score;
    next[event.from] -= score;
    // 杠上炮"转雨"（规则 C）：点炮者最近一次杠收入转给胡者
    if (event.bonuses?.includes("gangshang")) {
      const prev = lastGang.get(event.from);
      if (prev && prev.amount > 0) {
        next[event.from] -= prev.amount;
        next[event.player] += prev.amount;
      }
    }
  }
  return next;
}

export function applyGangEvent(rule, baseScore, scores, event, huSet = new Set()) {
  const next = [...scores];
  const unit = rule.gangPoint[event.gangType] * baseScore;
  if (event.gangType === "dian") {
    // 点杠: 只 from 那一个人付
    next[event.player] += unit;
    next[event.from] -= unit;
  } else {
    // bu / an: 未胡的其他 3 人各付 unit
    for (let i = 0; i < 4; i++) {
      if (i === event.player) continue;
      if (huSet.has(i)) continue;
      next[i] -= unit;
      next[event.player] += unit;
    }
  }
  return next;
}

export function replayEvents(rule, baseScore, events) {
  let scores = [0, 0, 0, 0];
  const huSet = new Set();
  const lastGang = new Map();  // player → { amount: gang 收入总额 }
  for (const ev of events) {
    if (ev.type === "hu") {
      scores = applyHuEvent(rule, baseScore, scores, ev, huSet, lastGang);
      huSet.add(ev.player);
    } else if (ev.type === "gang") {
      scores = applyGangEvent(rule, baseScore, scores, ev, huSet);
      const pairs = eventPairwise(rule, baseScore, ev, huSet);
      const income = pairs.reduce((a, p) => p.to === ev.player ? a + p.amount : a, 0);
      lastGang.set(ev.player, { amount: income });
    } else if (ev.type === "settlement") {
      scores = applySettlementEvent(rule, baseScore, scores, ev);
    } else if (ev.type === "mahu") {
      scores = applyMahuEvent(rule, baseScore, scores, ev);
    } else {
      throw new Error(`unknown event type: ${ev.type}`);
    }
  }
  return scores;
}

// 流局结算：花猪赔 penalty 给非花猪；未听赔已听 2^maxFan；相公不参与
// ev.result: [{player, kind: "huazhu"|"tingpai"|"weiting"|"xianggong", maxFan?}]
// 胡者不在 result 中
export function applySettlementEvent(rule, baseScore, scores, event) {
  const next = [...scores];
  const roles = Array(4).fill(null);
  const maxFanOf = Array(4).fill(0);
  for (const r of event.result) {
    roles[r.player] = r.kind;
    if (r.kind === "tingpai") maxFanOf[r.player] = r.maxFan ?? 0;
  }
  for (let i = 0; i < 4; i++) {
    if (roles[i] === null) roles[i] = "hu";
  }
  const penalty = rule.penalty * baseScore;
  // 花猪赔 penalty 给每个非花猪非相公
  for (let i = 0; i < 4; i++) {
    if (roles[i] !== "huazhu") continue;
    for (let j = 0; j < 4; j++) {
      if (j === i) continue;
      if (roles[j] === "huazhu") continue;
      if (roles[j] === "xianggong") continue;
      next[i] -= penalty;
      next[j] += penalty;
    }
  }
  // 查听：未听赔已听（相公不参与）
  for (let i = 0; i < 4; i++) {
    if (roles[i] !== "weiting") continue;
    for (let j = 0; j < 4; j++) {
      if (roles[j] !== "tingpai") continue;
      const fan = Math.min(maxFanOf[j], rule.capFan);
      const amount = (2 ** fan) * baseScore;
      next[i] -= amount;
      next[j] += amount;
    }
  }
  return next;
}

export function settlementPairwise(rule, baseScore, event) {
  const pairs = [];
  const roles = Array(4).fill(null);
  const maxFanOf = Array(4).fill(0);
  for (const r of event.result) {
    roles[r.player] = r.kind;
    if (r.kind === "tingpai") maxFanOf[r.player] = r.maxFan ?? 0;
  }
  for (let i = 0; i < 4; i++) if (roles[i] === null) roles[i] = "hu";
  const penalty = rule.penalty * baseScore;
  for (let i = 0; i < 4; i++) {
    if (roles[i] !== "huazhu") continue;
    for (let j = 0; j < 4; j++) {
      if (j === i) continue;
      if (roles[j] === "huazhu") continue;
      if (roles[j] === "xianggong") continue;
      pairs.push({ from: i, to: j, amount: penalty, kind: "花猪" });
    }
  }
  for (let i = 0; i < 4; i++) {
    if (roles[i] !== "weiting") continue;
    for (let j = 0; j < 4; j++) {
      if (roles[j] !== "tingpai") continue;
      const fan = Math.min(maxFanOf[j], rule.capFan);
      const amount = (2 ** fan) * baseScore;
      pairs.push({ from: i, to: j, amount, kind: "查听" });
    }
  }
  return pairs;
}

// 麻胡：玩家 X 声称胡了但胡不成立，赔 3 家每人 penalty
// ev: { type: "mahu", player: X }
export function applyMahuEvent(rule, baseScore, scores, event) {
  const next = [...scores];
  const penalty = rule.penalty * baseScore;
  for (let j = 0; j < 4; j++) {
    if (j === event.player) continue;
    next[event.player] -= penalty;
    next[j] += penalty;
  }
  return next;
}
export function mahuPairwise(rule, baseScore, event) {
  const pairs = [];
  const penalty = rule.penalty * baseScore;
  for (let j = 0; j < 4; j++) {
    if (j === event.player) continue;
    pairs.push({ from: event.player, to: j, amount: penalty, kind: "麻胡" });
  }
  return pairs;
}

export function isZeroSum(scores) {
  return scores.reduce((a, b) => a + b, 0) === 0;
}

// 返回每个事件的成对付款列表 {from, to, amount} (amount>0)
export function eventPairwise(rule, baseScore, event, huSet = new Set(), lastGang = new Map()) {
  const pairs = [];
  if (event.type === "settlement") {
    return settlementPairwise(rule, baseScore, event);
  }
  if (event.type === "mahu") {
    return mahuPairwise(rule, baseScore, event);
  }
  if (event.type === "hu") {
    const score = computeScore(rule, event, baseScore);
    if (event.from === null) {
      for (let i = 0; i < 4; i++) {
        if (i === event.player) continue;
        if (huSet.has(i)) continue;
        pairs.push({ from: i, to: event.player, amount: score });
      }
    } else {
      pairs.push({ from: event.from, to: event.player, amount: score });
      // 杠上炮转雨
      if (event.bonuses?.includes("gangshang")) {
        const prev = lastGang.get(event.from);
        if (prev && prev.amount > 0) {
          pairs.push({ from: event.from, to: event.player, amount: prev.amount });
        }
      }
    }
  } else if (event.type === "gang") {
    const unit = rule.gangPoint[event.gangType] * baseScore;
    if (event.gangType === "dian") {
      pairs.push({ from: event.from, to: event.player, amount: unit });
    } else {
      for (let i = 0; i < 4; i++) {
        if (i === event.player) continue;
        if (huSet.has(i)) continue;
        pairs.push({ from: i, to: event.player, amount: unit });
      }
    }
  }
  return pairs;
}

// replay 全部事件，得到 4x4 流向矩阵 matrix[i][j] = i 付给 j 的总额
export function replayPairwise(rule, baseScore, events) {
  const matrix = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const huSet = new Set();
  const lastGang = new Map();
  for (const ev of events) {
    const pairs = eventPairwise(rule, baseScore, ev, huSet, lastGang);
    for (const p of pairs) matrix[p.from][p.to] += p.amount;
    if (ev.type === "hu") {
      huSet.add(ev.player);
    } else if (ev.type === "gang") {
      const income = pairs.reduce((a, p) => p.to === ev.player ? a + p.amount : a, 0);
      lastGang.set(ev.player, { amount: income });
    }
  }
  return matrix;
}

// 流向矩阵 → 净付款列表 [{from, to, amount}]，amount>0 且只含每对非 0 净额
export function netPayments(matrix) {
  const result = [];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const net = matrix[i][j] - matrix[j][i];
      if (net > 0) result.push({ from: i, to: j, amount: net });
      else if (net < 0) result.push({ from: j, to: i, amount: -net });
    }
  }
  return result;
}
