export const RULES = {
  huansanzhang: {
    id: "huansanzhang",
    name: "换三张",
    capFan: 5,
    capScore: 32,
    penalty: 32,
    gangPoint: { bu: 1, dian: 2, an: 2 },
    patternFan: {
      pinghu:           [0, 1, 2],
      dadui:            [1, 2, 3],
      qingdadui:        [3, 4, 5],
      qingyise:         [2, 3, 4],
      qiduai:           [2],
      longqiduai:       [3],
      shuanglongqiduai: [4],
      qingqiduai:       [4],
      qinglongqiduai:   [5],
      jingoudiao:       [2, 3, 4, 5],
      qingjingoudiao:   [4, 5, 5],
      yaojiu:           [3, 4],
      jiangdui:         [4, 5],
      tianhu:           [4],
      dihu:             [5]
    },
    patterns: [
      { id: "pinghu",           name: "平胡",                          maxGen: 2, common: true },
      { id: "dadui",            name: "大对子（对对胡/碰碰胡）",        maxGen: 2, common: true },
      { id: "qingyise",         name: "清一色",                        maxGen: 2, common: true },
      { id: "qiduai",           name: "七对",                          maxGen: 0, common: true },
      { id: "qingdadui",        name: "清大对（清碰）",                 maxGen: 2 },
      { id: "longqiduai",       name: "龙七对（豪华七对）",             maxGen: 0 },
      { id: "shuanglongqiduai", name: "双龙七对",                      maxGen: 0 },
      { id: "qingqiduai",       name: "清七对",                        maxGen: 0 },
      { id: "qinglongqiduai",   name: "清龙七对",                      maxGen: 0 },
      { id: "jingoudiao",       name: "金钩钓（单钓将/大单调）",        maxGen: 3 },
      { id: "qingjingoudiao",   name: "清金钩钓",                      maxGen: 2 },
      { id: "yaojiu",           name: "幺九（带幺九）",                 maxGen: 1 },
      { id: "jiangdui",         name: "将对（将将胡）",                 maxGen: 1, zimoNoBonus: true },
      { id: "tianhu",           name: "天胡",                          maxGen: 0, zimoOnly: true, noBonus: true },
      { id: "dihu",             name: "地胡",                          maxGen: 0, noBonus: true }
    ]
  },
  bloodbattle: {
    id: "bloodbattle",
    name: "血战到底",
    capFan: 4,
    capScore: 16,
    penalty: 16,
    gangPoint: { bu: 1, dian: 2, an: 2 },
    // patternId → [gen0番, gen1番, gen2番]
    patternFan: {
      pinghu:         [0, 1, 2],
      dadui:          [1, 2, 3],
      qingdadui:      [3, 4, 4],
      qingyise:       [2, 3, 4],
      qiduai:         [2],
      longqiduai:     [3],
      qingqiduai:     [4],
      qinglongqiduai: [4],
      jingoudiao:     [2, 3, 4],
      qingjingoudiao: [4, 4, 4],
      yaojiu:         [3, 4],
      jiangdui:       [3, 4],
      tianhu:         [4],
      dihu:           [4]
    },
    patterns: [
      { id: "pinghu",         name: "平胡",                          maxGen: 2, common: true },
      { id: "dadui",          name: "大对子（对对胡/碰碰胡）",        maxGen: 2, common: true },
      { id: "qingyise",       name: "清一色",                        maxGen: 2, common: true },
      { id: "qiduai",         name: "七对",                          maxGen: 0, common: true },
      { id: "qingdadui",      name: "清大对（清碰）",                 maxGen: 2 },
      { id: "longqiduai",     name: "龙七对（豪华七对）",             maxGen: 0 },
      { id: "qingqiduai",     name: "清七对",                        maxGen: 0 },
      { id: "qinglongqiduai", name: "清龙七对",                      maxGen: 0 },
      { id: "jingoudiao",     name: "金钩钓（单钓将/大单调）",        maxGen: 2 },
      { id: "qingjingoudiao", name: "清金钩钓",                      maxGen: 2 },
      { id: "yaojiu",         name: "幺九（带幺九）",                 maxGen: 1 },
      { id: "jiangdui",       name: "将对（将将胡）",                 maxGen: 1 },
      { id: "tianhu",         name: "天胡",                          maxGen: 0, zimoOnly: true,  noBonus: true },
      { id: "dihu",           name: "地胡",                          maxGen: 0, zimoOnly: false, noBonus: true }
    ]
  }
};

export const BONUS_KEYS = ["gangshang", "qianggang", "haidi"];
export const BONUS_NAMES = { gangshang: "杠上花/炮", qianggang: "抢杠胡", haidi: "海底" };
