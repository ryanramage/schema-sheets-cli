#!/usr/bin/env node

import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import BlindPeering from '@holepunchto/blind-peering'
import z32 from 'z32'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import SchemaSheets from 'schema-sheets'
import envPaths from 'env-paths';
import {makeDirectory} from 'make-dir'
import { select, input, confirm } from '@inquirer/prompts'
import fileSelector from 'inquirer-file-selector'
import chalk from 'chalk'
import { spawn } from 'child_process'
import { promisify } from 'util'
import { exec } from 'child_process'
import Table from 'cli-table3'
import toClipboard from 'to-clipboard-android'
import Ajv from 'ajv'
import addFormats from "ajv-formats"
import Wakeup from 'protomux-wakeup'
import { createLobby } from './lobby.mjs'
import { WebFormServer } from './web/index.mjs'
const paths = envPaths('schema-sheets')
const execAsync = promisify(exec)


// Default configuration
const DefaultConfig = {
  storage: paths.data,
  DEFAULT_BLIND_PEER_KEYS: []
}

// Try to load config from file
let config = { ...DefaultConfig }
try {
  const configPath = join(paths.config, 'config.json')
  const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (configData.DEFAULT_BLIND_PEER_KEYS) {
    config.DEFAULT_BLIND_PEER_KEYS = configData.DEFAULT_BLIND_PEER_KEYS
  }
} catch (error) {
  // Config file doesn't exist or is invalid, use defaults
  console.log('Using default config (no config file found)')
}

// Ensure storage directory exists
await makeDirectory(config.storage)

// Create corestore subdirectory
const corestorePath = join(config.storage, 'corestore')
await makeDirectory(corestorePath)

const store = new Corestore(corestorePath)
const swarm = new Hyperswarm()
const wakeup = new Wakeup()
const blind = new BlindPeering(swarm, store, { wakeup, mirrors: config.DEFAULT_BLIND_PEER_KEYS })
const lobby = createLobby(config.storage)

// Track current sheet for cleanup
let currentSheet = null
let currentRoomLink = null
let currentRoomName = null
let lastUsedDirectory = null
let lastJmesQuery = ''

async function copyRoomLinkToClipboard() {
  if (!currentRoomLink) {
    console.log(chalk.red('No room link available'))
    await input({ message: 'Press Enter to continue...' })
    return showMainMenu(currentSheet)
  }

  try {
    toClipboard.sync(currentRoomLink)
    console.log(chalk.green('✓ Room link copied to clipboard'))
    console.log(chalk.blue(`Room Link: ${currentRoomLink}`))
  } catch (error) {
    console.error(chalk.red('Failed to copy to clipboard:'), error.message)
    console.log(chalk.blue(`Room Link: ${currentRoomLink}`))
  }
  
  await input({ message: 'Press Enter to continue...' })
  return showMainMenu(currentSheet)
}

async function closeCurrentSheet() {
  if (currentSheet) {
    try {
      await currentSheet.close()
      console.log(chalk.gray('Sheet closed'))
    } catch (error) {
      console.warn(chalk.yellow('Warning: Error closing sheet:'), error.message)
    }
    currentSheet = null
    currentRoomLink = null
    currentRoomName = null
    lastJmesQuery = '' // Reset query when leaving room
  }
}

async function teardown () {
  await closeCurrentSheet()
  await blind.close()
  await swarm.destroy()
  await store.close()
}

swarm.on('connection', c => {
  c.on('close', function () {})
  store.replicate(c)
  wakeup.addStream(c)
})

async function startSheet (key, encryptionKey, username) {
  const sheet = new SchemaSheets(store.namespace(crypto.randomBytes(32)), key, { encryptionKey, wakeup })
  await sheet.ready()
  swarm.join(sheet.base.discoveryKey)
  blind.addAutobaseBackground(sheet.base)
  
  // Track the current sheet for cleanup
  currentSheet = sheet
  if (username) {
    await sheet.join(username)
  }
  
  return { key: sheet.base.key, local: sheet.base.local.key, sheet }
}

async function createNewRoom(petName, username) {
  const room = await lobby.createRoom(petName, username)
  const roomLink = lobby.generateRoomLink(room.keyBuffer, room.encryptionKeyBuffer)
  
  // Store the current room link and name for clipboard functionality and headers
  currentRoomLink = roomLink
  currentRoomName = petName
  
  console.log(chalk.green(`✅ Room "${petName}" created!`))
  console.log(chalk.blue(`Room Link: ${roomLink}`))
  
  return startSheet(room.keyBuffer, room.encryptionKeyBuffer, username)
}

async function joinExistingRoom(roomLink, username, petName) {
  try {
    const room = await lobby.joinRoom(roomLink, username, petName)
    
    // Store the current room link and name for clipboard functionality and headers
    currentRoomLink = roomLink
    currentRoomName = room.petName
    
    console.log(chalk.green(`✅ Joined room "${room.petName}"`))
    
    return startSheet(room.keyBuffer, room.encryptionKeyBuffer, username)
  } catch (error) {
    console.error(chalk.red('Failed to join room:'), error.message)
    throw error
  }
}

process.once('SIGINT', async function () {
  console.log('shutting down....')
  await teardown()
  process.exit()
})

// Define missing schemas and data
const issueSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    status: { 
      type: 'string',
      enum: ['open', 'in-progress', 'closed']
    },
    priority: { 
      type: 'string',
      enum: ['low', 'med', 'high']
    },
    description: { type: 'string' }
  },
  required: ['title', 'status', 'priority']
}

const issue = {
  title: 'Sample Issue',
  status: 'open',
  priority: 'high',
  description: 'This is a sample issue'
}

async function showMainMenu(sheet) {
  console.clear()
  console.log(chalk.blue.bold(`📊 Room: ${currentRoomName || 'Unknown'}`))
  console.log(chalk.gray('Navigate with arrow keys, select with Enter\n'))

  try {
    const schemas = await sheet.listSchemas()
    
    const choices = []
    
    // Add schemas to the menu
    if (schemas.length > 0) {
      schemas.forEach(schema => {
        choices.push({
          name: `📋 ${schema.name} (ID: ${schema.schemaId})`,
          value: `schema-${schema.schemaId}`,
          description: `Manage rows in schema: ${schema.name}`
        })
      })
      
      // Add separator if we have schemas
      choices.push({
        name: chalk.gray('--- Actions ---'),
        value: 'separator',
        disabled: ''
      })
    } else {
      console.log(chalk.yellow('No schemas found. Add one first!\n'))
    }

    // Add action items
    choices.push(
      {
        name: '➕ Add Schema',
        value: 'add-schema', 
        description: 'Create a new schema from file'
      },
      {
        name: '🏷️  Change Room Name',
        value: 'change-room-name',
        description: 'Change the local name for this room'
      },
      {
        name: '📋 Copy Room Link',
        value: 'copy-room-link',
        description: 'Copy room invite link to clipboard'
      },
      {
        name: '🏠 Back to Room Lobby',
        value: 'lobby',
        description: 'Return to room selection'
      }
    )

    const choice = await select({
      message: 'Select a schema to manage or choose an action:',
      choices
    })

    if (choice === 'separator') {
      // User accidentally selected separator, re-render menu
      return showMainMenu(sheet)
    }

    if (choice.startsWith('schema-')) {
      const schemaId = choice.replace('schema-', '')
      const selectedSchema = schemas.find(s => s.schemaId === schemaId)
      await showRowMenu(sheet, selectedSchema)
    } else {
      switch (choice) {
        case 'add-schema':
          await showAddSchema(sheet)
          break
        case 'change-room-name':
          await showChangeRoomName(sheet)
          break
        case 'copy-room-link':
          await copyRoomLinkToClipboard()
          break
        case 'lobby':
          await closeCurrentSheet()
          await showRoomLobby()
          break
      }
    }
  } catch (error) {
    console.error(chalk.red('Error loading schemas:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showMainMenu(sheet)
  }
}


async function showChangeRoomName(sheet) {
  console.clear()
  console.log(chalk.blue.bold(`✏️ Change Room Name - Current: ${currentRoomName || 'Unknown'}\n`))

  try {
    const newPetName = await input({
      message: 'Enter new room name:',
      default: currentRoomName || '',
      validate: (input) => {
        if (!input.trim()) return 'Room name is required'
        return true
      }
    })

    // Update the room name in the lobby
    if (currentRoomLink) {
      const decoded = z32.decode(currentRoomLink)
      const key = decoded.subarray(0, 32)
      const keyHex = key.toString('hex')
      
      await lobby.updateRoom(keyHex, { petName: newPetName })
      currentRoomName = newPetName
      
      console.log(chalk.green(`✅ Room name changed to "${newPetName}"`))
    } else {
      console.log(chalk.yellow('Warning: Could not update room name (no room link available)'))
    }
    
    await input({ message: 'Press Enter to continue...' })
    return showMainMenu(sheet)
  } catch (error) {
    console.error(chalk.red('Error changing room name:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showMainMenu(sheet)
  }
}

async function showAddSchema(sheet) {
  console.clear()
  console.log(chalk.blue.bold(`➕ Add New Schema - Room: ${currentRoomName || 'Unknown'}\n`))

  const method = await select({
    message: 'How would you like to add the schema?',
    choices: [
      {
        name: '📄 Select JSON File',
        value: 'file',
        description: 'Choose a JSON schema file from your computer'
      },
      {
        name: '🌐 Enter URL',
        value: 'url',
        description: 'Download schema from a URL'
      },
      {
        name: '📋 Use Example Issue Schema',
        value: 'example',
        description: 'Use a pre-built issue tracking schema'
      },
      {
        name: chalk.gray('← Back to Main Menu'),
        value: 'back'
      }
    ]
  })

  if (method === 'back') {
    return showMainMenu(sheet)
  }

  try {
    const name = await input({
      message: 'Enter schema name:',
      validate: (input) => {
        if (!input.trim()) return 'Schema name is required'
        return true
      }
    })

    let schemaContent

    if (method === 'file') {
      const filePath = await fileSelector({
        message: 'Select schema JSON file:',
        type: 'file',
        filter: item => item.isDirectory || item.name.endsWith('.json'),
        ...(lastUsedDirectory && { basePath: lastUsedDirectory })
      })

      // Remember the directory for next time
      lastUsedDirectory = dirname(filePath)
      schemaContent = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } else if (method === 'url') {
      const url = await input({
        message: 'Enter schema URL:',
        validate: (input) => {
          if (!input.trim()) return 'URL is required'
          try {
            new URL(input)
            return true
          } catch {
            return 'Invalid URL format'
          }
        }
      })

      console.log(chalk.gray('Downloading schema...'))
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to download schema: ${response.status} ${response.statusText}`)
      }
      schemaContent = await response.json()
    } else if (method === 'example') {
      schemaContent = issueSchema
      console.log(chalk.gray('\nUsing example issue schema:'))
      console.log(JSON.stringify(schemaContent, null, 2))
      console.log('')
    }

    const schemaId = await sheet.addNewSchema(name, schemaContent)
    
    console.log(chalk.green(`✅ Schema "${name}" added successfully with ID: ${schemaId}`))
    await input({ message: 'Press Enter to continue...' })
    
    return showMainMenu(sheet)
  } catch (error) {
    console.error(chalk.red('Error adding schema:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showMainMenu(sheet)
  }
}

async function showRowMenu(sheet, schema) {
  console.clear()
  console.log(chalk.blue.bold(`📊 Managing Schema: ${schema.name} - Room: ${currentRoomName || 'Unknown'}\n`))

  const choice = await select({
    message: 'What would you like to do?',
    choices: [
      {
        name: '📋 List Rows',
        value: 'list-rows',
        description: 'View all rows in this schema'
      },
      {
        name: '🔍 Filter Rows',
        value: 'filter-rows',
        description: 'Filter rows by date range'
      },
      {
        name: '➕ Add Row',
        value: 'add-row',
        description: 'Add a new row from JSON file'
      },
      {
        name: '🎨 Add/Set UI Schema',
        value: 'ui-schema',
        description: 'Add or set the UI layout'
      },
      {
        name: chalk.gray('← Back to Main Menu'),
        value: 'back'
      }
    ]
  })

  switch (choice) {
    case 'list-rows':
      await showRowList(sheet, schema)
      break
    case 'filter-rows':
      await showFilterRows(sheet, schema)
      break
    case 'add-row':
      await showAddRow(sheet, schema)
      break
    case 'ui-schema':
      await showUISchemaMenu(sheet, schema)
      break
    case 'back':
      return showMainMenu(sheet)
  }
}

function getDateRanges() {
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

async function showFilterRows(sheet, schema) {
  console.clear()
  console.log(chalk.blue.bold(`🔍 Filter Rows - Schema: ${schema.name} - Room: ${currentRoomName || 'Unknown'}\n`))

  const ranges = getDateRanges()
  
  const choice = await select({
    message: 'Select date range:',
    choices: [
      {
        name: '📅 Today',
        value: 'today',
        description: 'Show rows from today'
      },
      {
        name: '📅 Yesterday', 
        value: 'yesterday',
        description: 'Show rows from yesterday'
      },
      {
        name: '📅 This Week',
        value: 'thisWeek',
        description: 'Show rows from this week (Monday-Sunday)'
      },
      {
        name: '📅 Last Week',
        value: 'lastWeek', 
        description: 'Show rows from last week'
      },
      {
        name: '📅 This Month',
        value: 'thisMonth',
        description: 'Show rows from this month'
      },
      {
        name: '📅 Last Month',
        value: 'lastMonth',
        description: 'Show rows from last month'
      },
      {
        name: '🛠️ Custom Range',
        value: 'custom',
        description: 'Set custom date range'
      },
      {
        name: chalk.gray('← Back to Row Menu'),
        value: 'back'
      }
    ]
  })

  if (choice === 'back') {
    return showRowMenu(sheet, schema)
  }

  let gte, lte

  if (choice === 'custom') {
    console.log(chalk.gray('\nEnter custom date range:'))
    
    // Default LTE to today
    const defaultLte = new Date().toISOString().split('T')[0]
    const lteInput = await input({
      message: 'End date (YYYY-MM-DD):',
      default: defaultLte,
      validate: (input) => {
        const date = new Date(input)
        if (isNaN(date.getTime())) return 'Invalid date format'
        return true
      }
    })
    
    // Default GTE to first of this month
    const defaultGte = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
    const gteInput = await input({
      message: 'Start date (YYYY-MM-DD):',
      default: defaultGte,
      validate: (input) => {
        const date = new Date(input)
        if (isNaN(date.getTime())) return 'Invalid date format'
        const lteDate = new Date(lteInput)
        if (date > lteDate) return 'Start date must be before or equal to end date'
        return true
      }
    })
    
    gte = new Date(gteInput).getTime()
    lte = new Date(lteInput + 'T23:59:59.999Z').getTime()
  } else {
    const range = ranges[choice]
    gte = range.gte
    lte = range.lte
  }

  // Handle JMESPath query selection/creation
  const jmesQuery = await showQuerySelection(sheet, schema)

  const filter = { gte, lte }
  if (jmesQuery && jmesQuery.trim()) {
    filter.query = jmesQuery.trim()
  }

  await showFilteredRowList(sheet, schema, filter, choice, jmesQuery || '')
}

async function showQuerySelection(sheet, schema) {
  try {
    const savedQueries = await sheet.listQueries(schema.schemaId)
    
    const choices = []
    
    // Add saved queries if any exist
    if (savedQueries.length > 0) {
      choices.push({
        name: chalk.gray('--- Saved Queries ---'),
        value: 'separator-saved',
        disabled: ''
      })
      
      savedQueries.forEach(query => {
        choices.push({
          name: `💾 ${query.name}`,
          value: `saved-${query.queryId}`,
          description: `Query: ${query.JMESPathQuery}`
        })
      })
      
      choices.push({
        name: chalk.gray('--- Create New ---'),
        value: 'separator-new',
        disabled: ''
      })
    }
    
    // Add options for creating new queries
    choices.push(
      {
        name: '✏️ Enter Custom Query',
        value: 'custom',
        description: 'Enter a new JMESPath query'
      },
      {
        name: '🚫 No Query Filter',
        value: 'none',
        description: 'Skip JMESPath filtering'
      }
    )
    
    if (savedQueries.length > 0) {
      choices.push({
        name: '🗑️ Manage Saved Queries',
        value: 'manage',
        description: 'Delete or edit saved queries'
      })
    }

    const queryChoice = await select({
      message: 'Select a query filter:',
      choices
    })

    if (queryChoice.startsWith('separator-')) {
      // User accidentally selected separator, re-render menu
      return showQuerySelection(sheet, schema)
    }

    if (queryChoice === 'none') {
      return ''
    }

    if (queryChoice === 'manage') {
      return showManageQueries(sheet, schema)
    }

    if (queryChoice.startsWith('saved-')) {
      const queryId = queryChoice.replace('saved-', '')
      const selectedQuery = savedQueries.find(q => q.queryId === queryId)
      if (selectedQuery) {
        lastJmesQuery = selectedQuery.JMESPathQuery
        return selectedQuery.JMESPathQuery
      }
    }

    if (queryChoice === 'custom') {
      console.log(chalk.gray('\nEnter JMESPath query to filter results'))
      console.log(chalk.gray('Examples: title, status == `open`, priority == `high`'))
      console.log(chalk.gray('Leave empty to skip filtering\n'))
      
      const customQuery = await input({
        message: 'JMESPath query:',
        default: lastJmesQuery,
        validate: (input) => {
          // Allow empty input
          if (!input.trim()) return true
          return true
        }
      })

      const queryText = customQuery.trim()
      lastJmesQuery = queryText

      // Ask if user wants to save this query
      if (queryText) {
        const shouldSave = await confirm({
          message: 'Save this query for reuse?',
          default: false
        })

        if (shouldSave) {
          const queryName = await input({
            message: 'Enter name for this query:',
            validate: (input) => {
              if (!input.trim()) return 'Query name is required'
              return true
            }
          })

          try {
            await sheet.addQuery(schema.schemaId, queryName.trim(), queryText)
            console.log(chalk.green(`✅ Query "${queryName.trim()}" saved!`))
          } catch (error) {
            console.log(chalk.yellow(`Warning: Could not save query: ${error.message}`))
          }
        }
      }

      return queryText
    }

    return ''
  } catch (error) {
    console.error(chalk.red('Error loading queries:'), error.message)
    return ''
  }
}

async function showManageQueries(sheet, schema) {
  console.clear()
  console.log(chalk.blue.bold(`🗑️ Manage Saved Queries - Schema: ${schema.name}\n`))

  try {
    const savedQueries = await sheet.listQueries(schema.schemaId)
    
    if (savedQueries.length === 0) {
      console.log(chalk.yellow('No saved queries found.'))
      await input({ message: 'Press Enter to continue...' })
      return showQuerySelection(sheet, schema)
    }

    const choices = savedQueries.map(query => ({
      name: `${query.name} - ${query.JMESPathQuery}`,
      value: query.queryId,
      description: 'Delete this query'
    }))

    choices.push({
      name: chalk.gray('← Back to Query Selection'),
      value: 'back'
    })

    const choice = await select({
      message: 'Select a query to delete:',
      choices
    })

    if (choice === 'back') {
      return showQuerySelection(sheet, schema)
    }

    const selectedQuery = savedQueries.find(q => q.queryId === choice)
    if (selectedQuery) {
      const confirmDelete = await confirm({
        message: `Delete query "${selectedQuery.name}"?`,
        default: false
      })

      if (confirmDelete) {
        try {
          await sheet.deleteQuery(choice)
          console.log(chalk.green(`✅ Query "${selectedQuery.name}" deleted!`))
          await input({ message: 'Press Enter to continue...' })
        } catch (error) {
          console.error(chalk.red('Error deleting query:'), error.message)
          await input({ message: 'Press Enter to continue...' })
        }
      }
    }

    return showManageQueries(sheet, schema)
  } catch (error) {
    console.error(chalk.red('Error managing queries:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showQuerySelection(sheet, schema)
  }
}

async function showFilteredRowList(sheet, schema, filter, filterType, jmesQuery = '') {
  console.clear()
  console.log(chalk.blue.bold(`📋 Filtered Rows - Schema: ${schema.name} - Room: ${currentRoomName || 'Unknown'}\n`))
  
  const startDate = new Date(filter.gte).toLocaleDateString()
  const endDate = new Date(filter.lte).toLocaleDateString()
  console.log(chalk.gray(`Date Filter: ${filterType === 'custom' ? 'Custom' : filterType} (${startDate} - ${endDate})`))
  
  if (jmesQuery) {
    console.log(chalk.gray(`JMESPath Query: ${jmesQuery}`))
  }
  console.log('')

  try {
    const rows = await sheet.list(schema.schemaId, filter)
    
    if (rows.length === 0) {
      console.log(chalk.yellow('No rows found in the selected date range.'))
      await input({ message: 'Press Enter to continue...' })
      return showFilterRows(sheet, schema)
    }

    // Create table with row snippets
    const table = new Table({
      head: ['Row ID', 'JSON Snippet'],
      colWidths: [20, 60]
    })

    rows.forEach(row => {
      const jsonString = JSON.stringify(row.json || {})
      const snippet = jsonString.substring(0, 55)
      const displaySnippet = snippet.length === 55 ? snippet + '...' : snippet
      const rowIdDisplay = (row.rowId || '').substring(0, 16) + '...'
      table.push([rowIdDisplay, displaySnippet])
    })

    console.log(table.toString())

    const choices = rows.map(row => {
      const jsonString = JSON.stringify(row.json || {})
      const snippet = jsonString.substring(0, 40)
      const rowIdDisplay = (row.rowId || '').substring(0, 16)
      return {
        name: `${rowIdDisplay}... - ${snippet}...`,
        value: row.rowId,
        description: 'View full JSON'
      }
    })

    choices.push({
      name: chalk.gray('← Back to Filter Menu'),
      value: 'back'
    })

    const choice = await select({
      message: 'Select a row to view full JSON:',
      choices
    })

    if (choice === 'back') {
      return showFilterRows(sheet, schema)
    }

    const selectedRow = rows.find(r => r.rowId === choice)
    await showRowDetail(sheet, schema, selectedRow, 'filter')
  } catch (error) {
    console.error(chalk.red('Error loading filtered rows:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showFilterRows(sheet, schema)
  }
}

async function showRowList(sheet, schema) {
  console.clear()
  console.log(chalk.blue.bold(`📋 Rows in Schema: ${schema.name} - Room: ${currentRoomName || 'Unknown'}\n`))

  try {
    const rows = await sheet.list(schema.schemaId, {})
    
    if (rows.length === 0) {
      console.log(chalk.yellow('No rows found. Add one first!'))
      await input({ message: 'Press Enter to continue...' })
      return showRowMenu(sheet, schema)
    }

    // Create table with row snippets
    const table = new Table({
      head: ['Row ID', 'JSON Snippet'],
      colWidths: [20, 60]
    })

    rows.forEach(row => {
      const jsonString = JSON.stringify(row.json || {})
      const snippet = jsonString.substring(0, 55)
      const displaySnippet = snippet.length === 55 ? snippet + '...' : snippet
      const rowIdDisplay = (row.rowId || '').substring(0, 16) + '...'
      table.push([rowIdDisplay, displaySnippet])
    })

    console.log(table.toString())

    const choices = rows.map(row => {
      const jsonString = JSON.stringify(row.json || {})
      const snippet = jsonString.substring(0, 40)
      const rowIdDisplay = (row.rowId || '').substring(0, 16)
      return {
        name: `${rowIdDisplay}... - ${snippet}...`,
        value: row.rowId,
        description: 'View full JSON'
      }
    })

    choices.push({
      name: chalk.gray('← Back to Row Menu'),
      value: 'back'
    })

    const choice = await select({
      message: 'Select a row to view full JSON:',
      choices
    })

    if (choice === 'back') {
      return showRowMenu(sheet, schema)
    }

    const selectedRow = rows.find(r => r.rowId === choice)
    await showRowDetail(sheet, schema, selectedRow)
  } catch (error) {
    console.error(chalk.red('Error loading rows:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showRowMenu(sheet, schema)
  }
}

async function showWebForm(sheet, schema) {
  const webServer = new WebFormServer()
  
  try {
    console.log(chalk.blue('Starting web form server...'))
    const port = await webServer.start()
    
    const { sessionId, promise } = await webServer.createFormSession(schema.schemaId, schema.jsonSchema)
    const url = `http://localhost:${port}/?session=${sessionId}&schema=${schema.schemaId}`
    
    console.log(chalk.green(`✅ Web form ready at: ${url}`))
    console.log(chalk.gray('Opening browser... (Press Ctrl+C to cancel)'))
    
    // Open browser
    const openCommand = process.platform === 'darwin' ? 'open' : 
                       process.platform === 'win32' ? 'start' : 'xdg-open'
    spawn(openCommand, [url], { detached: true, stdio: 'ignore' })
    
    // Wait for form completion
    const result = await promise
    
    if (result.cancelled) {
      console.log(chalk.yellow('Form cancelled'))
      await input({ message: 'Press Enter to continue...' })
      return showRowMenu(sheet, schema)
    }
    
    if (result.success && result.data) {
      console.log(chalk.green('✅ Form submitted successfully!'))
      
      // Add the row to the sheet
      const rowId = await sheet.addRow(schema.schemaId, result.data)
      console.log(chalk.green(`✅ Row added with ID: ${rowId}`))
      
      await input({ message: 'Press Enter to continue...' })
      return showRowMenu(sheet, schema)
    }
    
  } catch (error) {
    console.error(chalk.red('Error with web form:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showRowMenu(sheet, schema)
  } finally {
    await webServer.stop()
    console.log(chalk.gray('Web server stopped'))
  }
}

async function showAddRow(sheet, schema) {
  console.clear()
  console.log(chalk.blue.bold(`➕ Add Row to Schema: ${schema.name} - Room: ${currentRoomName || 'Unknown'}\n`))

  const method = await select({
    message: 'How would you like to add the row?',
    choices: [
      {
        name: '📄 Select JSON File',
        value: 'file',
        description: 'Choose a JSON file from your computer'
      },
      {
        name: '🌐 Web Form',
        value: 'web',
        description: 'Fill out a form in your browser'
      },
      {
        name: chalk.gray('← Back to Row Menu'),
        value: 'back'
      }
    ]
  })

  if (method === 'back') {
    return showRowMenu(sheet, schema)
  }

  if (method === 'web') {
    return showWebForm(sheet, schema)
  }

  // File method (existing code)
  try {
    const filePath = await fileSelector({
      message: 'Select JSON file:',
      type: 'file',
      filter: item => item.isDirectory || item.name.endsWith('.json'),
      ...(lastUsedDirectory && { basePath: lastUsedDirectory })
    })

    // Remember the directory for next time
    lastUsedDirectory = dirname(filePath)

    const jsonContent = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    
    // Validate JSON against schema using AJV
    const ajv = new Ajv({ allErrors: true })
    addFormats(ajv)

    const validate = ajv.compile(schema.jsonSchema)
    const valid = validate(jsonContent)
    
    // Show preview of JSON
    console.log(chalk.gray('\nJSON Preview:'))
    console.log(JSON.stringify(jsonContent, null, 2))
    
    if (!valid) {
      console.log(chalk.red('\n❌ JSON validation failed against schema!'))
      console.log(chalk.yellow('\nValidation errors:'))
      validate.errors.forEach((error, index) => {
        console.log(chalk.red(`  ${index + 1}. ${error.instancePath || 'root'}: ${error.message}`))
        if (error.params && error.params.allowedValues) {
          console.log(chalk.gray(`     Allowed values: ${error.params.allowedValues.join(', ')}`))
        }
      })
      console.log(chalk.gray('\nPlease fix the JSON data and try again.'))
      await input({ message: 'Press Enter to continue...' })
      return showRowMenu(sheet, schema)
    }
    
    console.log(chalk.green('\n✅ JSON validation passed!'))
    
    const confirm = await input({
      message: '\nAdd this row? (y/N):',
      default: 'n'
    })

    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      console.log(chalk.yellow('Row addition cancelled'))
      await input({ message: 'Press Enter to continue...' })
      return showRowMenu(sheet, schema)
    }

    const rowId = await sheet.addRow(schema.schemaId, jsonContent)
    
    console.log(chalk.green(`✅ Row added successfully with ID: ${rowId}`))
    await input({ message: 'Press Enter to continue...' })
    
    return showRowMenu(sheet, schema)
  } catch (error) {
    console.error(chalk.red('Error adding row:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showRowMenu(sheet, schema)
  }
}

async function viewJsonWithFx(jsonData) {
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

async function showRowDetail(sheet, schema, row, returnTo = 'list') {
  console.clear()
  console.log(chalk.blue.bold(`📄 Row Detail - Room: ${currentRoomName || 'Unknown'}\n`))
  console.log(chalk.gray(`Schema: ${schema.name}`))
  console.log(chalk.gray(`Row ID: ${row.rowId}\n`))
  
  // Try to use fx if available
  try {
    // Check if fx is available
    await execAsync('which fx')
    
    // Use fx for interactive JSON viewing
    await viewJsonWithFx(row.json)
  } catch (error) {
    // fx not available, fallback to simple display
    console.log(chalk.yellow('fx not found, showing plain JSON (install fx for better viewing)'))
    console.log(chalk.white('Full JSON:'))
    console.log(JSON.stringify(row.json, null, 2))
    
    await input({ message: '\nPress Enter to go back...' })
  }
  
  // Return to the appropriate list view
  if (returnTo === 'filter') {
    return showFilterRows(sheet, schema)
  } else {
    return showRowList(sheet, schema)
  }
}

async function showUISchemaMenu(sheet, schema) {
  console.clear()
  console.log(chalk.blue.bold(`🎨 UI Schema Management - Schema: ${schema.name} - Room: ${currentRoomName || 'Unknown'}\n`))

  try {
    const uiSchemas = await sheet.listUISchemas(schema.schemaId)
    
    const choices = []
    
    if (uiSchemas.length > 0) {
      choices.push({
        name: chalk.gray('--- Existing UI Schemas ---'),
        value: 'separator-existing',
        disabled: ''
      })
      
      uiSchemas.forEach(uiSchema => {
        choices.push({
          name: `📄 ${uiSchema.name}`,
          value: `existing-${uiSchema.uischemaId}`,
          description: 'View, update, or delete this UI schema'
        })
      })
      
      choices.push({
        name: chalk.gray('--- Actions ---'),
        value: 'separator-actions',
        disabled: ''
      })
    }
    
    choices.push(
      {
        name: '➕ Add New UI Schema',
        value: 'add-new',
        description: 'Create a new UI schema from file or URL'
      },
      {
        name: chalk.gray('← Back to Schema Menu'),
        value: 'back'
      }
    )

    const choice = await select({
      message: 'Select an option:',
      choices
    })

    if (choice.startsWith('separator-')) {
      return showUISchemaMenu(sheet, schema)
    }

    if (choice === 'back') {
      return showRowMenu(sheet, schema)
    }

    if (choice === 'add-new') {
      return showAddUISchema(sheet, schema)
    }

    if (choice.startsWith('existing-')) {
      const uischemaId = choice.replace('existing-', '')
      const selectedUISchema = uiSchemas.find(ui => ui.uischemaId === uischemaId)
      return showUISchemaDetail(sheet, schema, selectedUISchema)
    }

  } catch (error) {
    console.error(chalk.red('Error loading UI schemas:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showRowMenu(sheet, schema)
  }
}

async function showAddUISchema(sheet, schema) {
  console.clear()
  console.log(chalk.blue.bold(`➕ Add UI Schema - Schema: ${schema.name} - Room: ${currentRoomName || 'Unknown'}\n`))

  const method = await select({
    message: 'How would you like to add the UI schema?',
    choices: [
      {
        name: '📄 Select JSON File',
        value: 'file',
        description: 'Choose a JSON UI schema file from your computer'
      },
      {
        name: '🌐 Enter URL',
        value: 'url',
        description: 'Download UI schema from a URL'
      },
      {
        name: chalk.gray('← Back to UI Schema Menu'),
        value: 'back'
      }
    ]
  })

  if (method === 'back') {
    return showUISchemaMenu(sheet, schema)
  }

  try {
    const name = await input({
      message: 'Enter UI schema name:',
      validate: (input) => {
        if (!input.trim()) return 'UI schema name is required'
        return true
      }
    })

    let uiSchemaContent

    if (method === 'file') {
      const filePath = await fileSelector({
        message: 'Select UI schema JSON file:',
        type: 'file',
        filter: item => item.isDirectory || item.name.endsWith('.json'),
        ...(lastUsedDirectory && { basePath: lastUsedDirectory })
      })

      lastUsedDirectory = dirname(filePath)
      uiSchemaContent = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } else if (method === 'url') {
      const url = await input({
        message: 'Enter UI schema URL:',
        validate: (input) => {
          if (!input.trim()) return 'URL is required'
          try {
            new URL(input)
            return true
          } catch {
            return 'Invalid URL format'
          }
        }
      })

      console.log(chalk.gray('Downloading UI schema...'))
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to download UI schema: ${response.status} ${response.statusText}`)
      }
      uiSchemaContent = await response.json()
    }

    // Show preview
    console.log(chalk.gray('\nUI Schema Preview:'))
    console.log(JSON.stringify(uiSchemaContent, null, 2))
    
    const confirmAdd = await confirm({
      message: 'Add this UI schema?',
      default: true
    })

    if (!confirmAdd) {
      console.log(chalk.yellow('UI schema addition cancelled'))
      await input({ message: 'Press Enter to continue...' })
      return showUISchemaMenu(sheet, schema)
    }

    const uischemaId = await sheet.addUISchema(schema.schemaId, name, uiSchemaContent)
    
    console.log(chalk.green(`✅ UI Schema "${name}" added successfully with ID: ${uischemaId}`))
    await input({ message: 'Press Enter to continue...' })
    
    return showUISchemaMenu(sheet, schema)
  } catch (error) {
    console.error(chalk.red('Error adding UI schema:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showUISchemaMenu(sheet, schema)
  }
}

async function showUISchemaDetail(sheet, schema, uiSchema) {
  console.clear()
  console.log(chalk.blue.bold(`📄 UI Schema Detail - Room: ${currentRoomName || 'Unknown'}\n`))
  console.log(chalk.gray(`Schema: ${schema.name}`))
  console.log(chalk.gray(`UI Schema: ${uiSchema.name}`))
  console.log(chalk.gray(`UI Schema ID: ${uiSchema.uischemaId}\n`))

  const choice = await select({
    message: 'What would you like to do?',
    choices: [
      {
        name: '👁️ View UI Schema JSON',
        value: 'view',
        description: 'Display the full UI schema JSON'
      },
      {
        name: '✏️ Update UI Schema',
        value: 'update',
        description: 'Replace with a new UI schema'
      },
      {
        name: '🗑️ Delete UI Schema',
        value: 'delete',
        description: 'Remove this UI schema'
      },
      {
        name: chalk.gray('← Back to UI Schema Menu'),
        value: 'back'
      }
    ]
  })

  switch (choice) {
    case 'view':
      await showUISchemaJSON(sheet, schema, uiSchema)
      break
    case 'update':
      await showUpdateUISchema(sheet, schema, uiSchema)
      break
    case 'delete':
      await showDeleteUISchema(sheet, schema, uiSchema)
      break
    case 'back':
      return showUISchemaMenu(sheet, schema)
  }
}

async function showUISchemaJSON(sheet, schema, uiSchema) {
  console.clear()
  console.log(chalk.blue.bold(`👁️ UI Schema JSON - ${uiSchema.name}\n`))
  
  try {
    // Try to use fx if available
    await execAsync('which fx')
    await viewJsonWithFx(uiSchema.uiSchema)
  } catch (error) {
    // fx not available, fallback to simple display
    console.log(chalk.yellow('fx not found, showing plain JSON (install fx for better viewing)'))
    console.log(chalk.white('UI Schema JSON:'))
    console.log(JSON.stringify(uiSchema.uiSchema, null, 2))
    
    await input({ message: '\nPress Enter to go back...' })
  }
  
  return showUISchemaDetail(sheet, schema, uiSchema)
}

async function showUpdateUISchema(sheet, schema, uiSchema) {
  console.clear()
  console.log(chalk.blue.bold(`✏️ Update UI Schema - ${uiSchema.name}\n`))

  const method = await select({
    message: 'How would you like to update the UI schema?',
    choices: [
      {
        name: '📄 Select JSON File',
        value: 'file',
        description: 'Choose a new JSON UI schema file'
      },
      {
        name: '🌐 Enter URL',
        value: 'url',
        description: 'Download new UI schema from a URL'
      },
      {
        name: chalk.gray('← Back to UI Schema Detail'),
        value: 'back'
      }
    ]
  })

  if (method === 'back') {
    return showUISchemaDetail(sheet, schema, uiSchema)
  }

  try {
    let newUISchemaContent

    if (method === 'file') {
      const filePath = await fileSelector({
        message: 'Select new UI schema JSON file:',
        type: 'file',
        filter: item => item.isDirectory || item.name.endsWith('.json'),
        ...(lastUsedDirectory && { basePath: lastUsedDirectory })
      })

      lastUsedDirectory = dirname(filePath)
      newUISchemaContent = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } else if (method === 'url') {
      const url = await input({
        message: 'Enter UI schema URL:',
        validate: (input) => {
          if (!input.trim()) return 'URL is required'
          try {
            new URL(input)
            return true
          } catch {
            return 'Invalid URL format'
          }
        }
      })

      console.log(chalk.gray('Downloading UI schema...'))
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to download UI schema: ${response.status} ${response.statusText}`)
      }
      newUISchemaContent = await response.json()
    }

    // Show preview
    console.log(chalk.gray('\nNew UI Schema Preview:'))
    console.log(JSON.stringify(newUISchemaContent, null, 2))
    
    const confirmUpdate = await confirm({
      message: 'Update the UI schema with this content?',
      default: true
    })

    if (!confirmUpdate) {
      console.log(chalk.yellow('UI schema update cancelled'))
      await input({ message: 'Press Enter to continue...' })
      return showUISchemaDetail(sheet, schema, uiSchema)
    }

    await sheet.updateUISchema(uiSchema.uischemaId, schema.schemaId, uiSchema.name, newUISchemaContent)
    
    console.log(chalk.green(`✅ UI Schema "${uiSchema.name}" updated successfully`))
    await input({ message: 'Press Enter to continue...' })
    
    return showUISchemaMenu(sheet, schema)
  } catch (error) {
    console.error(chalk.red('Error updating UI schema:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showUISchemaDetail(sheet, schema, uiSchema)
  }
}

async function showDeleteUISchema(sheet, schema, uiSchema) {
  console.clear()
  console.log(chalk.blue.bold(`🗑️ Delete UI Schema - ${uiSchema.name}\n`))
  console.log(chalk.yellow('⚠️ This action cannot be undone!'))
  console.log(chalk.gray(`UI Schema: ${uiSchema.name}`))
  console.log(chalk.gray(`UI Schema ID: ${uiSchema.uischemaId}\n`))

  const confirmDelete = await confirm({
    message: 'Are you sure you want to delete this UI schema?',
    default: false
  })

  if (!confirmDelete) {
    console.log(chalk.yellow('Deletion cancelled'))
    await input({ message: 'Press Enter to continue...' })
    return showUISchemaDetail(sheet, schema, uiSchema)
  }

  try {
    await sheet.deleteUISchema(uiSchema.uischemaId)
    
    console.log(chalk.green(`✅ UI Schema "${uiSchema.name}" deleted successfully`))
    await input({ message: 'Press Enter to continue...' })
    
    return showUISchemaMenu(sheet, schema)
  } catch (error) {
    console.error(chalk.red('Error deleting UI schema:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showUISchemaDetail(sheet, schema, uiSchema)
  }
}

async function showRoomLobby() {
  console.clear()
  console.log(chalk.blue.bold('🏠 Room Lobby'))
  console.log(chalk.gray('Manage your rooms and join schema sheets\n'))

  const rooms = await lobby.listRooms()
  
  const choices = [
    {
      name: '🆕 Create New Room',
      value: 'create-room',
      description: 'Create a new room and get a shareable link'
    },
    {
      name: '🔗 Join Room by Link',
      value: 'join-room',
      description: 'Join an existing room using a room link'
    }
  ]

  // Add existing rooms to the menu
  if (rooms.length > 0) {
    choices.push({
      name: chalk.gray('--- Known Rooms ---'),
      value: 'separator',
      disabled: ''
    })
    
    rooms.forEach(room => {
      const createdDate = new Date(room.createdAt).toLocaleDateString()
      const isCreator = room.isCreator ? '👑' : '👤'
      choices.push({
        name: `${isCreator} ${room.petName} (${createdDate})`,
        value: `room-${room.key}`,
        description: `Join as ${room.username}`
      })
    })
  }

  choices.push({
    name: '🚪 Exit',
    value: 'exit',
    description: 'Close the application'
  })

  const choice = await select({
    message: 'What would you like to do?',
    choices
  })

  if (choice === 'separator') {
    // User accidentally selected separator, re-render menu
    return showRoomLobby()
  }

  switch (choice) {
    case 'create-room':
      await showCreateRoom()
      break
    case 'join-room':
      await showJoinRoom()
      break
    case 'exit':
      console.log(chalk.green('Goodbye! 👋'))
      process.exit(0)
      break
    default:
      if (choice.startsWith('room-')) {
        const roomKey = choice.replace('room-', '')
        const room = rooms.find(r => r.key === roomKey)
        if (room) {
          await joinKnownRoom(room)
        }
      }
      break
  }
}

async function showCreateRoom() {
  console.clear()
  console.log(chalk.blue.bold('🆕 Create New Room\n'))

  try {
    const petName = await input({
      message: 'Enter room name:',
      validate: (input) => {
        if (!input.trim()) return 'Room name is required'
        return true
      }
    })

    const username = await input({
      message: 'Enter your username:',
      validate: (input) => {
        if (!input.trim()) return 'Username is required'
        return true
      }
    })

    const { sheet } = await createNewRoom(petName, username)
    const member = await sheet.join(username)
    
    console.log(chalk.green('✅ Connected to schema sheets'))
    await input({ message: 'Press Enter to continue to room...' })
    
    // Start the schema sheets TUI
    await showMainMenu(sheet)
  } catch (error) {
    console.error(chalk.red('Error creating room:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showRoomLobby()
  }
}

async function showJoinRoom() {
  console.clear()
  console.log(chalk.blue.bold('🔗 Join Room by Link\n'))

  try {
    const roomLink = await input({
      message: 'Enter room link:',
      validate: (input) => {
        if (!input.trim()) return 'Room link is required'
        try {
          z32.decode(input)
          return true
        } catch {
          return 'Invalid room link format'
        }
      }
    })

    const username = await input({
      message: 'Enter your username:',
      validate: (input) => {
        if (!input.trim()) return 'Username is required'
        return true
      }
    })

    const petName = await input({
      message: 'Enter a local name for this room (optional):',
      validate: (input) => {
        // Allow empty input for optional field
        return true
      }
    })

    const { sheet } = await joinExistingRoom(roomLink, username, petName.trim() || undefined)
    const member = await sheet.join(username)
    
    console.log(chalk.green('✅ Connected to schema sheets'))
    await input({ message: 'Press Enter to continue to room...' })
    
    // Start the schema sheets TUI
    await showMainMenu(sheet)
  } catch (error) {
    console.error(chalk.red('Error joining room:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showRoomLobby()
  }
}

async function joinKnownRoom(room) {
  console.clear()
  console.log(chalk.blue.bold(`🏠 Joining Room: ${room.petName}\n`))

  try {
    const roomLink = lobby.generateRoomLink(z32.decode(room.key), z32.decode(room.encryptionKey))
    const { sheet } = await joinExistingRoom(roomLink, room.username)
    const member = await sheet.join(room.username)
    
    console.log(chalk.green('✅ Connected to schema sheets'))
    await input({ message: 'Press Enter to continue to room...' })
    
    // Start the schema sheets TUI
    await showMainMenu(sheet)
  } catch (error) {
    console.error(chalk.red('Error joining room:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showRoomLobby()
  }
}

async function run() {
  await lobby.init()
  await showRoomLobby()
}

run()

