export const zones = ['Zone A', 'Zone B', 'Zone C']

export const riskLevels = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
}
export const simulationByLevel = {
  [riskLevels.low]: {
    peopleCount: 10,
    density: 'LOW',
    movement: 'NORMAL',
    risk: riskLevels.low,
  },
  [riskLevels.medium]: {
    peopleCount: 30,
    density: 'MEDIUM',
    movement: 'NORMAL',
    risk: riskLevels.medium,
  },
  [riskLevels.high]: {
    peopleCount: 70,
    density: 'HIGH',
    movement: 'ABNORMAL',
    risk: riskLevels.high,
  },
}

export const getSimulationLevelFromTime = (seconds) => {
  if (seconds >= 10) return riskLevels.high
  if (seconds >= 5) return riskLevels.medium
  return riskLevels.low
}

const heatmapByRisk = {
  [riskLevels.low]: [
    { id: 'LOW-1', top: '28%', left: '34%', size: '30px', opacity: 0.2 },
    { id: 'LOW-2', top: '42%', left: '58%', size: '34px', opacity: 0.2 },
    { id: 'LOW-3', top: '60%', left: '44%', size: '26px', opacity: 0.2 },
  ],
  [riskLevels.medium]: [
    { id: 'MEDIUM-1', top: '22%', left: '30%', size: '34px', opacity: 0.24 },
    { id: 'MEDIUM-2', top: '36%', left: '48%', size: '42px', opacity: 0.28 },
    { id: 'MEDIUM-3', top: '48%', left: '62%', size: '40px', opacity: 0.26 },
    { id: 'MEDIUM-4', top: '60%', left: '40%', size: '36px', opacity: 0.24 },
    { id: 'MEDIUM-5', top: '66%', left: '56%', size: '32px', opacity: 0.22 },
  ],
  [riskLevels.high]: [
    { id: 'HIGH-1', top: '18%', left: '24%', size: '42px', opacity: 0.3 },
    { id: 'HIGH-2', top: '24%', left: '42%', size: '50px', opacity: 0.34 },
    { id: 'HIGH-3', top: '30%', left: '60%', size: '56px', opacity: 0.35 },
    { id: 'HIGH-4', top: '40%', left: '28%', size: '48px', opacity: 0.32 },
    { id: 'HIGH-5', top: '46%', left: '48%', size: '58px', opacity: 0.36 },
    { id: 'HIGH-6', top: '52%', left: '68%', size: '52px', opacity: 0.35 },
    { id: 'HIGH-7', top: '64%', left: '36%', size: '44px', opacity: 0.33 },
    { id: 'HIGH-8', top: '70%', left: '56%', size: '46px', opacity: 0.32 },
  ],
}

export const getHeatmapPoints = (risk) => heatmapByRisk[risk] ?? heatmapByRisk.LOW

export const formatAlertTimestamp = () =>
  new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date())
