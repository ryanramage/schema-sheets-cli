export function getDateRanges() {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  
  // This week (Monday to Sunday)
  const dayOfWeek = now.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek // Handle Sunday as 0
  const thisWeekStart = new Date(today.getTime() + mondayOffset * 24 * 60 * 60 * 1000)
  const thisWeekEnd = new Date(thisWeekStart.getTime() + 6 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 999)
  
  // Last week
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000)
  const lastWeekEnd = new Date(thisWeekStart.getTime() - 1)
  
  // This month
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  
  // Last month
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
  
  return {
    today: { gte: today.getTime(), lte: new Date(today.getTime() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 999).getTime() },
    yesterday: { gte: yesterday.getTime(), lte: new Date(yesterday.getTime() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 999).getTime() },
    thisWeek: { gte: thisWeekStart.getTime(), lte: thisWeekEnd.getTime() },
    lastWeek: { gte: lastWeekStart.getTime(), lte: lastWeekEnd.getTime() },
    thisMonth: { gte: thisMonthStart.getTime(), lte: thisMonthEnd.getTime() },
    lastMonth: { gte: lastMonthStart.getTime(), lte: lastMonthEnd.getTime() }
  }
}

export function formatDateRange(filterType, gte, lte) {
  const startDate = new Date(gte).toLocaleDateString()
  const endDate = new Date(lte).toLocaleDateString()
  return `${filterType === 'custom' ? 'Custom' : filterType} (${startDate} - ${endDate})`
}
