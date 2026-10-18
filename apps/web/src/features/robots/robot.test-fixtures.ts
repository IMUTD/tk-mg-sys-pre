import { emptyRobot, idleRun, type Robot } from "./robot"

export const createRobotFixtures = (): Robot[] => [
  {
    ...emptyRobot(1, "2026-09-17 12:00:00"),
    accountCount: 48,
    chainId: 1,
    chainName: "早班养号",
    name: "美区养号",
    run: idleRun(48),
  },
  {
    ...emptyRobot(2, "2026-09-17 12:00:00"),
    chainId: 2,
    chainName: "补号流程",
    name: "英文区补号",
  },
  { ...emptyRobot(3, "2026-09-17 12:00:00"), chainId: 3, chainName: "发布作品", name: "晚班日更" },
  { ...emptyRobot(4, "2026-09-17 12:00:00"), chainId: 4, chainName: "账号检查", name: "夜间巡检" },
]
