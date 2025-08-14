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
    head: ['Row ID', 'JSON Snippet'],
    colWidths: [20, 60]
  })
}

export function addRowToTable(table, row) {
  const jsonString = JSON.stringify(row.json || {})
  const snippet = jsonString.substring(0, 55)
  const displaySnippet = snippet.length === 55 ? snippet + '...' : snippet
  const rowIdDisplay = (row.rowId || '').substring(0, 16) + '...'
  table.push([rowIdDisplay, displaySnippet])
}

export function createRowChoices(rows) {
  return rows.map(row => {
    const jsonString = JSON.stringify(row.json || {})
    const snippet = jsonString.substring(0, 40)
    const rowIdDisplay = (row.rowId || '').substring(0, 16)
    return {
      name: `${rowIdDisplay}... - ${snippet}...`,
      value: row.rowId,
      description: 'View full JSON'
    }
  })
}
