import { RULES } from "./rules.mjs";
import { replayEvents } from "./engine.mjs";

const KEY_STATE = "chuanma.state";

export function loadState() {
  const raw = localStorage.getItem(KEY_STATE);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn("chuanma.state corrupted, ignoring:", e);
    return null;
  }
}

export function saveState(state) {
  localStorage.setItem(KEY_STATE, JSON.stringify(state));
}

export function newSession({ players, rule = "bloodbattle", baseScore = 1 }) {
  return {
    rule,
    baseScore,
    players: [...players],
    sessionStart: new Date().toISOString(),
    rounds: [],
    currentRound: { events: [] }
  };
}

export function addEvent(state, event) {
  return {
    ...state,
    currentRound: {
      ...state.currentRound,
      events: [...state.currentRound.events, event]
    }
  };
}

export function removeEventAt(state, index) {
  const events = state.currentRound.events.slice();
  events.splice(index, 1);
  return {
    ...state,
    currentRound: { ...state.currentRound, events }
  };
}

export function moveEventBy(state, index, delta) {
  const events = state.currentRound.events.slice();
  const newIdx = index + delta;
  if (newIdx < 0 || newIdx >= events.length) return state;
  [events[index], events[newIdx]] = [events[newIdx], events[index]];
  return {
    ...state,
    currentRound: { ...state.currentRound, events }
  };
}

export function moveEventTo(state, fromIdx, toIdx) {
  if (fromIdx === toIdx) return state;
  const events = state.currentRound.events.slice();
  if (fromIdx < 0 || fromIdx >= events.length) return state;
  if (toIdx < 0 || toIdx >= events.length) return state;
  const [moved] = events.splice(fromIdx, 1);
  events.splice(toIdx, 0, moved);
  return {
    ...state,
    currentRound: { ...state.currentRound, events }
  };
}

export function endRound(state) {
  const rule = RULES[state.rule];
  const delta = replayEvents(rule, state.baseScore, state.currentRound.events);
  const finishedRound = {
    events: state.currentRound.events,
    scoreDelta: delta
  };
  return {
    ...state,
    rounds: [...state.rounds, finishedRound],
    currentRound: { events: [] }
  };
}

// 当前本局 net 分数（不含历史局）
export function currentRoundScores(state) {
  const rule = RULES[state.rule];
  return replayEvents(rule, state.baseScore, state.currentRound.events);
}

// 跨局累计总分 —— 保留给将来历史页用，主屏不用
export function totalScores(state) {
  const rule = RULES[state.rule];
  const totals = [0, 0, 0, 0];
  for (const r of state.rounds) {
    for (let i = 0; i < 4; i++) totals[i] += r.scoreDelta[i];
  }
  const currentDelta = replayEvents(rule, state.baseScore, state.currentRound.events);
  for (let i = 0; i < 4; i++) totals[i] += currentDelta[i];
  return totals;
}
