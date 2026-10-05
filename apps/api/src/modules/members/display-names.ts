export const MEMBER_DISPLAY_NAMES: readonly string[] = [
  "路飞",
  "鸣人",
  "佐助",
  "柯南",
  "灰原哀",
  "樱桃丸子",
  "哆啦A梦",
  "大雄",
  "千寻",
  "龙猫",
  "无面人",
  "孙悟空",
  "猪八戒",
  "林黛玉",
  "贾宝玉",
  "福尔摩斯",
  "华生",
  "哈利",
  "赫敏",
  "小丸子",
  "佩奇",
  "小熊维尼",
  "跳跳虎",
  "小兔子",
  "小狐狸",
  "小熊猫",
  "小猫咪",
  "小企鹅",
  "考拉",
  "成龙",
  "刘德华",
  "周杰伦",
  "林青霞",
  "张国荣",
  "宫崎骏",
  "豆豆",
]

export const pickMemberDisplayName = (taken: readonly string[]): string => {
  const used = new Set(taken)
  const available = MEMBER_DISPLAY_NAMES.filter((name) => !used.has(name))
  const pool = available.length > 0 ? available : MEMBER_DISPLAY_NAMES
  const base = pool[Math.floor(Math.random() * pool.length)] ?? "豆豆"
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}${suffix}`)) suffix += 1
  return `${base}${suffix}`
}
