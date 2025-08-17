import { spawn } from 'child_process'
import { promisify } from 'util'
import { exec } from 'child_process'
import Table from 'cli-table3'
import chalk from 'chalk'
import { input, select } from '@inquirer/prompts'

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

/**
 * Analyze query results to determine if they can be displayed as columns
 */
export function analyzeQueryResults(rows, queryText) {
  if (!rows || rows.length === 0) {
    return { canShowColumns: false, columns: [], reason: 'No data to analyze' }
  }

  // Check if the query results in structured objects suitable for column display
  const hasStructuredData = rows.some(row => 
    row.json && 
    typeof row.json === 'object' && 
    !Array.isArray(row.json) &&
    Object.keys(row.json).length > 0
  )

  if (!hasStructuredData) {
    return { canShowColumns: false, columns: [], reason: 'Query results are not structured objects' }
  }

  // Get columns from the first structured row
  const sampleRow = rows.find(row => 
    row.json && 
    typeof row.json === 'object' && 
    !Array.isArray(row.json) &&
    Object.keys(row.json).length > 0
  )

  if (!sampleRow) {
    return { canShowColumns: false, columns: [], reason: 'No valid structured data found' }
  }

  const columns = Object.keys(sampleRow.json)
  
  if (columns.length === 0) {
    return { canShowColumns: false, columns: [], reason: 'No columns found in structured data' }
  }

  // Additional check: ensure most rows have the same structure
  const consistentRows = rows.filter(row => {
    if (!row.json || typeof row.json !== 'object' || Array.isArray(row.json)) {
      return false
    }
    const rowColumns = Object.keys(row.json)
    return rowColumns.length === columns.length && 
           columns.every(col => rowColumns.includes(col))
  })

  const consistencyRatio = consistentRows.length / rows.length
  if (consistencyRatio < 0.8) { // At least 80% of rows should have consistent structure
    return { 
      canShowColumns: false, 
      columns: [], 
      reason: `Only ${Math.round(consistencyRatio * 100)}% of rows have consistent structure` 
    }
  }

  return { canShowColumns: true, columns, reason: null }
}

/**
 * Display rows in an interactive table and allow selection
 */
export async function displayRowsInteractively(rows, listViewQuery = null, title = 'Select a row') {
  if (rows.length === 0) {
    return null
  }

  // Create choices for selection
  let choices

  if (listViewQuery) {
    const analysis = analyzeQueryResults(rows, listViewQuery.JMESPathQuery)
    
    if (analysis.canShowColumns) {
      // Create choices for structured data with better display
      choices = rows.map((row, index) => {
        if (row.json && typeof row.json === 'object' && !Array.isArray(row.json)) {
          const values = Object.values(row.json)
          const displayText = values.map(v => {
            const stringValue = String(v || '')
            return stringValue.length > 30 ? stringValue.substring(0, 30) + '...' : stringValue
          }).join(' | ')
          const rowIdDisplay = (row.uuid || '').substring(0, 8)
          const timeDisplay = new Date(row.time).toLocaleString()
          return {
            name: `${String(index + 1).padStart(3)}. ${rowIdDisplay}... | ${displayText}`,
            value: row.uuid,
            description: `Created: ${timeDisplay}`
          }
        } else {
          const rowIdDisplay = (row.uuid || '').substring(0, 8)
          const timeDisplay = new Date(row.time).toLocaleString()
          return {
            name: `${String(index + 1).padStart(3)}. ${rowIdDisplay}... | (error)`,
            value: row.uuid,
            description: `Created: ${timeDisplay}`
          }
        }
      })
    } else {
      // Fallback to JSON snippet display
      if (analysis.reason) {
        console.log(chalk.yellow(`${analysis.reason}, showing JSON snippets\n`))
      }
      choices = createRowChoicesWithNumbers(rows)
    }
  } else {
    // No list view query, use regular display
    choices = createRowChoicesWithNumbers(rows)
  }

  choices.push({
    name: chalk.cyan('← Back'),
    value: 'back'
  })

  const selectedRowId = await select({
    message: title,
    choices,
    pageSize: 15
  })

  return selectedRowId === 'back' ? null : selectedRowId
}

/**
 * Create row choices with row numbers for better navigation
 */
export function createRowChoicesWithNumbers(rows) {
  return rows.map((row, index) => {
    const jsonString = JSON.stringify(row.json || {})
    const snippet = jsonString.substring(0, 50)
    const displaySnippet = snippet.length === 50 ? snippet + '...' : snippet
    const rowIdDisplay = (row.uuid || '').substring(0, 8)
    const timeDisplay = new Date(row.time).toLocaleString()
    return {
      name: `${String(index + 1).padStart(3)}. ${rowIdDisplay}... | ${displaySnippet}`,
      value: row.uuid,
      description: `Created: ${timeDisplay}`
    }
  })
}

/**
 * Show row actions menu
 */
export async function showRowActionsMenu(row, roomName = 'Unknown') {
  console.clear()
  console.log(chalk.blue.bold(`📄 Row Actions - Room: ${roomName}\n`))
  console.log(chalk.cyan(`Row UUID: ${row.uuid}`))
  console.log(chalk.cyan(`Created: ${new Date(row.time).toLocaleString()}\n`))

  const choice = await select({
    message: 'What would you like to do with this row?',
    choices: [
      {
        name: '👁️  View Full JSON',
        value: 'view',
        description: 'Display the complete JSON data'
      },
      {
        name: '🔏 Row Signatures',
        value: 'signatures',
        description: 'View cryptographic signatures (coming soon)'
      },
      {
        name: '📋 Copy to Clipboard',
        value: 'copy',
        description: 'Copy row JSON to clipboard'
      },
      {
        name: chalk.cyan('← Back to Row List'),
        value: 'back'
      }
    ]
  })

  return choice
}

/**
 * Copy JSON data to clipboard
 */
export async function copyToClipboard(data) {
  try {
    const jsonString = JSON.stringify(data, null, 2)
    
    // Try to use pbcopy on macOS, xclip on Linux, or clip on Windows
    let clipboardCommand
    if (process.platform === 'darwin') {
      clipboardCommand = 'pbcopy'
    } else if (process.platform === 'linux') {
      clipboardCommand = 'xclip -selection clipboard'
    } else if (process.platform === 'win32') {
      clipboardCommand = 'clip'
    } else {
      throw new Error('Clipboard not supported on this platform')
    }

    const clipProcess = spawn(clipboardCommand, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    })

    clipProcess.stdin.write(jsonString)
    clipProcess.stdin.end()

    return new Promise((resolve, reject) => {
      clipProcess.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Clipboard command failed with code ${code}`))
        }
      })
      
      clipProcess.on('error', (error) => {
        reject(error)
      })
    })
  } catch (error) {
    throw new Error(`Failed to copy to clipboard: ${error.message}`)
  }
}
