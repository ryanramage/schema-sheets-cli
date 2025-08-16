import { spawn } from 'child_process'
import { promisify } from 'util'
import { exec } from 'child_process'
import Table from 'cli-table3'
import chalk from 'chalk'
import { input } from '@inquirer/prompts'

const execAsync = promisify(exec)

export async function viewJsonWithFx(jsonData) {
  return new Promise((resolve, reject) => {
    // Save current terminal state
    const originalRawMode = process.stdin.isRaw
    
    // Exit raw mode if we're in it (inquirer uses raw mode)
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false)
    }
    
    const fx = spawn('fx', [], {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: {
        ...process.env,
        FX_COLLAPSED: 'true'
      }
    })
    
    // Send JSON to fx via stdin
    fx.stdin.write(JSON.stringify(jsonData, null, 2))
    fx.stdin.end()
    
    fx.on('close', (code) => {
      // Restore original terminal state
      if (process.stdin.setRawMode && originalRawMode) {
        process.stdin.setRawMode(true)
      }
      resolve()
    })
    
    fx.on('error', (error) => {
      // Restore original terminal state on error
      if (process.stdin.setRawMode && originalRawMode) {
        process.stdin.setRawMode(true)
      }
      reject(error)
    })
  })
}

export async function displayJsonWithFallback(jsonData, title = 'JSON Data') {
  try {
    // Check if fx is available
    await execAsync('which fx')
    
    // Use fx for interactive JSON viewing
    await viewJsonWithFx(jsonData)
  } catch (error) {
    // fx not available, fallback to simple display
    console.log(chalk.yellow('fx not found, showing plain JSON (install fx for better viewing)'))
    console.log(chalk.white(`${title}:`))
    console.log(JSON.stringify(jsonData, null, 2))
    
    await input({ message: '\nPress Enter to go back...' })
  }
}

export function createRowTable() {
  return new Table({
    head: ['UUID', 'JSON Snippet'],
    colWidths: [20, 60]
  })
}

export function addRowToTable(table, row) {
  const jsonString = JSON.stringify(row.json || {})
  const snippet = jsonString.substring(0, 55)
  const displaySnippet = snippet.length === 55 ? snippet + '...' : snippet
  const uuidDisplay = (row.uuid || '').substring(0, 16) + '...'
  table.push([uuidDisplay, displaySnippet])
}

export function createRowChoices(rows) {
  return rows.map(row => {
    const jsonString = JSON.stringify(row.json || {})
    const snippet = jsonString.substring(0, 40)
    const uuidDisplay = (row.uuid || '').substring(0, 16)
    return {
      name: `${uuidDisplay}... - ${snippet}...`,
      value: row.uuid,
      description: 'View full JSON'
    }
  })
}

/**
 * Create a dynamic table based on list view query results
 */
export function createDynamicTable(columns, maxColumnWidth = 30) {
  const colWidths = columns.map(col => Math.min(col.length + 2, maxColumnWidth))
  
  return new Table({
    head: columns,
    colWidths: colWidths.length > 0 ? colWidths : [20, 60]
  })
}

/**
 * Add a row to dynamic table with list view data
 */
export function addDynamicRowToTable(table, listViewData, maxColumnWidth = 30) {
  const values = Object.values(listViewData || {}).map(value => 
    truncateValue(value, maxColumnWidth - 2)
  )
  table.push(values)
}

/**
 * Truncate a value intelligently for display
 */
export function truncateValue(value, maxLength) {
  if (value === null || value === undefined) {
    return ''
  }
  
  const stringValue = String(value)
  if (stringValue.length <= maxLength) {
    return stringValue
  }
  
  return stringValue.substring(0, maxLength - 3) + '...'
}

/**
 * Apply a JMESPath query to transform row data for list view
 */
export async function applyListViewQuery(rows, queryText) {
  try {
    const jmespath = (await import('jmespath')).default
    
    const transformedRows = []
    
    for (const row of rows) {
      try {
        const result = jmespath.search(row.json, queryText)
        if (result && typeof result === 'object' && !Array.isArray(result)) {
          transformedRows.push({
            uuid: row.uuid,
            time: row.time,
            listViewData: result,
            originalJson: row.json
          })
        } else {
          // Fallback to original row if query doesn't return an object
          transformedRows.push({
            uuid: row.uuid,
            time: row.time,
            listViewData: null,
            originalJson: row.json
          })
        }
      } catch (error) {
        // Fallback to original row if query fails
        transformedRows.push({
          uuid: row.uuid,
          time: row.time,
          listViewData: null,
          originalJson: row.json
        })
      }
    }
    
    return transformedRows
  } catch (error) {
    console.warn('Failed to apply list view query:', error.message)
    // Return rows in fallback format
    return rows.map(row => ({
      uuid: row.uuid,
      time: row.time,
      listViewData: null,
      originalJson: row.json
    }))
  }
}

/**
 * Create row choices for list view transformed data
 */
export function createListViewRowChoices(transformedRows) {
  return transformedRows.map(row => {
    if (row.listViewData) {
      // Use list view data for display
      const values = Object.values(row.listViewData)
      const displayText = values.map(v => truncateValue(v, 20)).join(' | ')
      const uuidDisplay = (row.uuid || '').substring(0, 16)
      return {
        name: `${uuidDisplay}... - ${displayText}`,
        value: row.uuid,
        description: 'View full JSON'
      }
    } else {
      // Fallback to JSON snippet
      const jsonString = JSON.stringify(row.originalJson || {})
      const snippet = jsonString.substring(0, 40)
      const uuidDisplay = (row.uuid || '').substring(0, 16)
      return {
        name: `${uuidDisplay}... - ${snippet}...`,
        value: row.uuid,
        description: 'View full JSON'
      }
    }
  })
}
