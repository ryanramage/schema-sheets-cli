import chalk from 'chalk'
import { spawn } from 'child_process'
import { select, input, confirm } from '@inquirer/prompts'
import { BaseMenu } from './base-menu.mjs'
import { WebFormServer } from '../web/index.mjs'
import { getDateRanges, formatDateRange } from '../utils/date-filters.mjs'
import { displayJsonWithFallback, createRowTable, addRowToTable, createRowChoices } from '../utils/display.mjs'

export class RowMenu extends BaseMenu {
  async show(sheet, schema) {
    const title = `📊 Managing Schema: ${schema.name} - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}`

    const choices = [
      {
        name: '📋 List Rows',
        value: 'list-rows',
        description: 'View all rows in this schema'
      },
      {
        name: '🔍 Filter Rows',
        value: 'filter-rows',
        description: 'Filter rows by date range and JMESPath queries'
      },
      {
        name: '➕ Add Row',
        value: 'add-row',
        description: 'Add a new row to this schema'
      },
      {
        name: '🎨 UI Schema',
        value: 'ui-schema',
        description: 'Manage UI schemas for this schema'
      },
      {
        name: '🔍 Manage Queries',
        value: 'manage-queries',
        description: 'Create, edit, and delete saved queries for this schema'
      },
      {
        name: chalk.gray('← Back to Main Menu'),
        value: 'back'
      }
    ]

    const choice = await this.showMenu(title, choices, 'What would you like to do?')

    switch (choice) {
      case 'list-rows':
        return this.showRowList(sheet, schema, this.show.bind(this))
      case 'filter-rows':
        return this.showFilterRows(sheet, schema, this.show.bind(this))
      case 'add-row':
        return this.showAddRow(sheet, schema, this.show.bind(this))
      case 'ui-schema':
        return this.showUISchemaMenu(sheet, schema, this.show.bind(this))
      case 'manage-queries':
        return this.showManageQueries(sheet, schema, this.show.bind(this))
      case 'back':
        return 'back'
      default:
        return choice
    }
  }

  async showRowList(sheet, schema, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`📋 Rows in Schema: ${schema.name} - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}\n`))

    try {
      // Check for list view query to use at the schema-sheets level
      const listViewQuery = await this.sheetOps.getListViewQuery(sheet, schema)
      const listOptions = {}
      
      if (listViewQuery) {
        console.log(chalk.gray(`Using list view: ${listViewQuery.name} 📋\n`))
        listOptions.query = listViewQuery.JMESPathQuery
      }

      const rows = await sheet.list(schema.schemaId, listOptions)
      
      if (rows.length === 0) {
        console.log(chalk.yellow('No rows found. Add one first!'))
        await this.waitForContinue()
        return returnCallback(sheet, schema)
      }

      // Create table and choices based on whether we have list view data
      let table
      let choices

      if (listViewQuery) {
        // Check if the list view query returned structured data
        const hasListViewData = rows.some(row => row.json && typeof row.json === 'object' && !Array.isArray(row.json))
        
        if (hasListViewData) {
          // Get columns from the first row's data
          const sampleData = rows.find(row => row.json && typeof row.json === 'object')?.json
          const columns = sampleData ? Object.keys(sampleData) : []
          
          if (columns.length > 0) {
            // Create dynamic table for list view
            const { createDynamicTable, addDynamicRowToTable } = await import('../utils/display.mjs')
            table = createDynamicTable(columns)
            
            rows.forEach(row => {
              if (row.json && typeof row.json === 'object') {
                addDynamicRowToTable(table, row.json)
              } else {
                // Add fallback row for failed transformations
                const fallbackData = {}
                columns.forEach(col => { fallbackData[col] = '(error)' })
                addDynamicRowToTable(table, fallbackData)
              }
            })
            
            // Create choices for list view
            choices = rows.map(row => {
              if (row.json && typeof row.json === 'object') {
                const values = Object.values(row.json)
                const displayText = values.map(v => {
                  const stringValue = String(v || '')
                  return stringValue.length > 20 ? stringValue.substring(0, 20) + '...' : stringValue
                }).join(' | ')
                const rowIdDisplay = (row.rowId || '').substring(0, 16)
                return {
                  name: `${rowIdDisplay}... - ${displayText}`,
                  value: row.rowId,
                  description: 'View full JSON'
                }
              } else {
                const rowIdDisplay = (row.rowId || '').substring(0, 16)
                return {
                  name: `${rowIdDisplay}... - (error)`,
                  value: row.rowId,
                  description: 'View full JSON'
                }
              }
            })
          } else {
            // Fallback to regular table
            console.log(chalk.yellow('List view query returned no columns, falling back to JSON snippets\n'))
            const { createRowTable, addRowToTable, createRowChoices } = await import('../utils/display.mjs')
            table = createRowTable()
            rows.forEach(row => addRowToTable(table, row))
            choices = createRowChoices(rows)
          }
        } else {
          // Fallback to regular table
          console.log(chalk.yellow('List view query failed, falling back to JSON snippets\n'))
          const { createRowTable, addRowToTable, createRowChoices } = await import('../utils/display.mjs')
          table = createRowTable()
          rows.forEach(row => addRowToTable(table, row))
          choices = createRowChoices(rows)
        }
      } else {
        // No list view query, use regular table
        const { createRowTable, addRowToTable, createRowChoices } = await import('../utils/display.mjs')
        table = createRowTable()
        rows.forEach(row => addRowToTable(table, row))
        choices = createRowChoices(rows)
      }

      console.log(table.toString())

      choices.push({
        name: chalk.gray('← Back to Row Menu'),
        value: 'back'
      })

      const choice = await select({
        message: 'Select a row to view full JSON:',
        choices
      })

      if (choice === 'back') {
        return returnCallback(sheet, schema)
      }

      // Get the full row data since list view query may have filtered the JSON
      const fullRow = await sheet.getRow(schema.schemaId, choice)
      await this.showRowDetail(sheet, schema, fullRow, 'list', returnCallback)
    } catch (error) {
      console.error(chalk.red('Error loading rows:'), error.message)
      await this.waitForContinue()
      return returnCallback(sheet, schema)
    }
  }

  async showFilterRows(sheet, schema, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`🔍 Filter Rows - Schema: ${schema.name} - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}\n`))

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
      return returnCallback(sheet, schema)
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
    const jmesQuery = await this.sheetOps.showQuerySelection(sheet, schema)

    const filter = { gte, lte }
    if (jmesQuery && jmesQuery.trim()) {
      filter.query = jmesQuery.trim()
    }

    await this.showFilteredRowList(sheet, schema, filter, choice, jmesQuery || '', returnCallback)
  }


  async showFilteredRowList(sheet, schema, filter, filterType, jmesQuery = '', returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`📋 Filtered Rows - Schema: ${schema.name} - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}\n`))
    
    console.log(chalk.gray(`Date Filter: ${formatDateRange(filterType, filter.gte, filter.lte)}`))
    
    if (jmesQuery) {
      console.log(chalk.gray(`JMESPath Query: ${jmesQuery}`))
    }
    console.log('')

    try {
      // Use the provided jmesQuery if available, otherwise check for list view query
      let queryToUse = jmesQuery
      let listViewQuery = null
      
      if (!jmesQuery) {
        listViewQuery = await this.sheetOps.getListViewQuery(sheet, schema)
        if (listViewQuery) {
          queryToUse = listViewQuery.JMESPathQuery
          console.log(chalk.gray(`Using list view: ${listViewQuery.name} 📋\n`))
        }
      }

      // Add query to filter if we have one
      const listOptions = { ...filter }
      if (queryToUse) {
        listOptions.query = queryToUse
      }

      const rows = await sheet.list(schema.schemaId, listOptions)
      
      if (rows.length === 0) {
        console.log(chalk.yellow('No rows found in the selected date range.'))
        await this.waitForContinue()
        return this.showFilterRows(sheet, schema, returnCallback)
      }

      // Create table and choices based on whether we used a list view query
      let table
      let choices

      if (listViewQuery && !jmesQuery) {
        // Check if the list view query returned structured data
        const hasListViewData = rows.some(row => row.json && typeof row.json === 'object' && !Array.isArray(row.json))
        
        if (hasListViewData) {
          // Get columns from the first row's data
          const sampleData = rows.find(row => row.json && typeof row.json === 'object')?.json
          const columns = sampleData ? Object.keys(sampleData) : []
          
          if (columns.length > 0) {
            // Create dynamic table for list view
            const { createDynamicTable, addDynamicRowToTable } = await import('../utils/display.mjs')
            table = createDynamicTable(columns)
            
            rows.forEach(row => {
              if (row.json && typeof row.json === 'object') {
                addDynamicRowToTable(table, row.json)
              } else {
                // Add fallback row for failed transformations
                const fallbackData = {}
                columns.forEach(col => { fallbackData[col] = '(error)' })
                addDynamicRowToTable(table, fallbackData)
              }
            })
            
            // Create choices for list view
            choices = rows.map(row => {
              if (row.json && typeof row.json === 'object') {
                const values = Object.values(row.json)
                const displayText = values.map(v => {
                  const stringValue = String(v || '')
                  return stringValue.length > 20 ? stringValue.substring(0, 20) + '...' : stringValue
                }).join(' | ')
                const rowIdDisplay = (row.rowId || '').substring(0, 16)
                return {
                  name: `${rowIdDisplay}... - ${displayText}`,
                  value: row.rowId,
                  description: 'View full JSON'
                }
              } else {
                const rowIdDisplay = (row.rowId || '').substring(0, 16)
                return {
                  name: `${rowIdDisplay}... - (error)`,
                  value: row.rowId,
                  description: 'View full JSON'
                }
              }
            })
          } else {
            // Fallback to regular table
            console.log(chalk.yellow('List view query returned no columns, falling back to JSON snippets\n'))
            const { createRowTable, addRowToTable, createRowChoices } = await import('../utils/display.mjs')
            table = createRowTable()
            rows.forEach(row => addRowToTable(table, row))
            choices = createRowChoices(rows)
          }
        } else {
          // Fallback to regular table
          console.log(chalk.yellow('List view query failed, falling back to JSON snippets\n'))
          const { createRowTable, addRowToTable, createRowChoices } = await import('../utils/display.mjs')
          table = createRowTable()
          rows.forEach(row => addRowToTable(table, row))
          choices = createRowChoices(rows)
        }
      } else {
        // No list view query or custom JMESPath filter already applied, use regular table
        const { createRowTable, addRowToTable, createRowChoices } = await import('../utils/display.mjs')
        table = createRowTable()
        rows.forEach(row => addRowToTable(table, row))
        choices = createRowChoices(rows)
      }

      console.log(table.toString())

      choices.push({
        name: chalk.gray('← Back to Filter Menu'),
        value: 'back'
      })

      const choice = await select({
        message: 'Select a row to view full JSON:',
        choices
      })

      if (choice === 'back') {
        return this.showFilterRows(sheet, schema, returnCallback)
      }

      // Get the full row data since list view query may have filtered the JSON
      const fullRow = await sheet.getRow(schema.schemaId, choice)
      await this.showRowDetail(sheet, schema, fullRow, 'filter', returnCallback)
    } catch (error) {
      console.error(chalk.red('Error loading filtered rows:'), error.message)
      await this.waitForContinue()
      return this.showFilterRows(sheet, schema, returnCallback)
    }
  }

  async showRowDetail(sheet, schema, row, returnTo = 'list', returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`📄 Row Detail - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}\n`))
    console.log(chalk.gray(`Schema: ${schema.name}`))
    console.log(chalk.gray(`Row ID: ${row.rowId}\n`))
    
    await displayJsonWithFallback(row.json, 'Full JSON')
    
    // Return to the appropriate list view
    if (returnTo === 'filter') {
      return this.showFilterRows(sheet, schema, returnCallback)
    } else {
      return this.showRowList(sheet, schema, returnCallback)
    }
  }

  async showAddRow(sheet, schema, returnCallback) {
    const title = `➕ Add Row to Schema: ${schema.name} - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}`

    const choices = [
      {
        name: '🌐 Web Form',
        value: 'web',
        description: 'Use a web-based form (opens in browser)'
      },
      {
        name: '📄 JSON File',
        value: 'file',
        description: 'Select a JSON file from your computer'
      },
      {
        name: chalk.gray('← Back to Row Menu'),
        value: 'back'
      }
    ]

    const method = await this.showMenu(title, choices, 'How would you like to add the row?')

    if (method === 'back') {
      return returnCallback(sheet, schema)
    }

    if (method === 'web') {
      return this.showWebForm(sheet, schema, returnCallback)
    }

    // File method
    try {
      await this.sheetOps.addRowFromFile(sheet, schema)
      await this.waitForContinue()
      
      return returnCallback(sheet, schema)
    } catch (error) {
      console.error(chalk.red('Error adding row:'), error.message)
      await this.waitForContinue()
      return returnCallback(sheet, schema)
    }
  }

  async showWebForm(sheet, schema, returnCallback) {
    const webServer = new WebFormServer()
    
    try {
      console.log(chalk.blue('Starting web form server...'))
      const port = await webServer.start()
      
      const { sessionId, promise } = await webServer.createFormSession(schema.schemaId, schema.jsonSchema, sheet)
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
        await this.waitForContinue()
        return returnCallback(sheet, schema)
      }
      
      if (result.success && result.data) {
        console.log(chalk.green('✅ Form submitted successfully!'))
        
        // Add the row to the sheet
        const rowId = await sheet.addRow(schema.schemaId, result.data)
        console.log(chalk.green(`✅ Row added with ID: ${rowId}`))
        
        await this.waitForContinue()
        return returnCallback(sheet, schema)
      }
      
    } catch (error) {
      console.error(chalk.red('Error with web form:'), error.message)
      await this.waitForContinue()
      return returnCallback(sheet, schema)
    } finally {
      await webServer.stop()
      console.log(chalk.gray('Web server stopped'))
    }
  }

  async showUISchemaMenu(sheet, schema, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`🎨 UI Schema Management - Schema: ${schema.name} - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}\n`))

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
          name: chalk.gray('← Back to Row Menu'),
          value: 'back'
        }
      )

      const choice = await select({
        message: 'Select an option:',
        choices
      })

      if (choice.startsWith('separator-')) {
        return this.showUISchemaMenu(sheet, schema, returnCallback)
      }

      if (choice === 'back') {
        return returnCallback(sheet, schema)
      }

      if (choice === 'add-new') {
        return this.showAddUISchema(sheet, schema, returnCallback)
      }

      if (choice.startsWith('existing-')) {
        const uischemaId = choice.replace('existing-', '')
        const selectedUISchema = uiSchemas.find(ui => ui.uischemaId === uischemaId)
        return this.showUISchemaDetail(sheet, schema, selectedUISchema, returnCallback)
      }

    } catch (error) {
      console.error(chalk.red('Error loading UI schemas:'), error.message)
      await this.waitForContinue()
      return returnCallback(sheet, schema)
    }
  }

  async showAddUISchema(sheet, schema, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`➕ Add UI Schema - Schema: ${schema.name} - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}\n`))

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
      return this.showUISchemaMenu(sheet, schema, returnCallback)
    }

    try {
      const name = await input({
        message: 'Enter UI schema name:',
        validate: (input) => {
          if (!input.trim()) return 'UI schema name is required'
          return true
        }
      })

      await this.sheetOps.addUISchema(sheet, schema, method, name)
      await this.waitForContinue()
      
      return this.showUISchemaMenu(sheet, schema, returnCallback)
    } catch (error) {
      console.error(chalk.red('Error adding UI schema:'), error.message)
      await this.waitForContinue()
      return this.showUISchemaMenu(sheet, schema, returnCallback)
    }
  }

  async showUISchemaDetail(sheet, schema, uiSchema, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`📄 UI Schema Detail - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}\n`))
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
        await this.showUISchemaJSON(sheet, schema, uiSchema, returnCallback)
        break
      case 'update':
        await this.showUpdateUISchema(sheet, schema, uiSchema, returnCallback)
        break
      case 'delete':
        await this.showDeleteUISchema(sheet, schema, uiSchema, returnCallback)
        break
      case 'back':
        return this.showUISchemaMenu(sheet, schema, returnCallback)
    }
  }

  async showUISchemaJSON(sheet, schema, uiSchema, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`👁️ UI Schema JSON - ${uiSchema.name}\n`))
    
    await displayJsonWithFallback(uiSchema.uiSchema, 'UI Schema JSON')
    
    return this.showUISchemaDetail(sheet, schema, uiSchema, returnCallback)
  }

  async showUpdateUISchema(sheet, schema, uiSchema, returnCallback) {
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
      return this.showUISchemaDetail(sheet, schema, uiSchema, returnCallback)
    }

    try {
      await this.sheetOps.updateUISchema(sheet, schema, uiSchema, method)
      await this.waitForContinue()
      
      return this.showUISchemaMenu(sheet, schema, returnCallback)
    } catch (error) {
      console.error(chalk.red('Error updating UI schema:'), error.message)
      await this.waitForContinue()
      return this.showUISchemaDetail(sheet, schema, uiSchema, returnCallback)
    }
  }

  async showDeleteUISchema(sheet, schema, uiSchema, returnCallback) {
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
      await this.waitForContinue()
      return this.showUISchemaDetail(sheet, schema, uiSchema, returnCallback)
    }

    try {
      await sheet.deleteUISchema(uiSchema.uischemaId)
      
      console.log(chalk.green(`✅ UI Schema "${uiSchema.name}" deleted successfully`))
      await this.waitForContinue()
      
      return this.showUISchemaMenu(sheet, schema, returnCallback)
    } catch (error) {
      console.error(chalk.red('Error deleting UI schema:'), error.message)
      await this.waitForContinue()
      return this.showUISchemaDetail(sheet, schema, uiSchema, returnCallback)
    }
  }

  async showManageQueries(sheet, schema, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`🔍 Manage Queries - Schema: ${schema.name} - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}\n`))

    try {
      const savedQueries = await sheet.listQueries(schema.schemaId)
      
      const choices = []
      
      if (savedQueries.length > 0) {
        choices.push({
          name: chalk.gray('--- Existing Queries ---'),
          value: 'separator-existing',
          disabled: ''
        })
        
        savedQueries.forEach(query => {
          choices.push({
            name: `${query.listView ? '📋' : '💾'} ${query.name}`,
            value: `existing-${query.queryId}`,
            description: `${query.JMESPathQuery}${query.listView ? ' (List View)' : ''}`
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
          name: '➕ Create New Query',
          value: 'create-new',
          description: 'Create and save a new JMESPath query'
        },
        {
          name: chalk.gray('← Back to Row Menu'),
          value: 'back'
        }
      )

      const choice = await select({
        message: 'Select an option:',
        choices
      })

      if (choice.startsWith('separator-')) {
        return this.showManageQueries(sheet, schema, returnCallback)
      }

      if (choice === 'back') {
        return returnCallback(sheet, schema)
      }

      if (choice === 'create-new') {
        return this.showCreateQuery(sheet, schema, returnCallback)
      }

      if (choice.startsWith('existing-')) {
        const queryId = choice.replace('existing-', '')
        const selectedQuery = savedQueries.find(q => q.queryId === queryId)
        return this.showQueryDetail(sheet, schema, selectedQuery, returnCallback)
      }

    } catch (error) {
      console.error(chalk.red('Error loading queries:'), error.message)
      await this.waitForContinue()
      return returnCallback(sheet, schema)
    }
  }

  async showCreateQuery(sheet, schema, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`➕ Create New Query - Schema: ${schema.name} - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}\n`))

    console.log(chalk.gray('Enter JMESPath query to filter and transform data'))
    console.log(chalk.gray('Examples:'))
    console.log(chalk.gray('  • title                           - Simple property'))
    console.log(chalk.gray('  • status == `open`                - Filter by status'))
    console.log(chalk.gray('  • [].{title: title, status: status} - List view format'))
    console.log('')

    try {
      const queryText = await input({
        message: 'JMESPath query:',
        validate: (input) => {
          if (!input.trim()) return 'Query is required'
          return true
        }
      })

      const queryName = await input({
        message: 'Enter name for this query:',
        validate: (input) => {
          if (!input.trim()) return 'Query name is required'
          return true
        }
      })

      // Analyze the query to see if it's suitable for list view
      const analysis = this.sheetOps.analyzeListViewQuery(queryText.trim())
      let isListView = false

      if (analysis.isValidListView) {
        console.log(chalk.gray(`\nDetected list view query with columns: ${analysis.columns.join(', ')}`))
        
        // Check for existing list view queries
        const existingListView = await this.sheetOps.checkExistingListView(sheet, schema)
        
        if (existingListView) {
          console.log(chalk.yellow(`\nWarning: Schema already has a list view query: "${existingListView.name}"`))
          const replaceExisting = await confirm({
            message: 'Replace the existing list view query with this one?',
            default: false
          })
          
          if (replaceExisting) {
            // Remove list view flag from existing query
            try {
              await sheet.updateQuery(existingListView.queryId, existingListView.name, existingListView.JMESPathQuery, false)
              console.log(chalk.gray(`Removed list view flag from "${existingListView.name}"`))
              isListView = true
            } catch (error) {
              console.log(chalk.yellow(`Warning: Could not update existing query: ${error.message}`))
            }
          }
        } else {
          isListView = await confirm({
            message: 'Use this query as the list view for displaying rows?',
            default: true
          })
        }
      }

      await sheet.addQuery(schema.schemaId, queryName.trim(), queryText.trim(), isListView)
      console.log(chalk.green(`✅ Query "${queryName.trim()}" created successfully!`))
      if (isListView) {
        console.log(chalk.green(`✅ Set as list view query`))
      }
      
      await this.waitForContinue()
      return this.showManageQueries(sheet, schema, returnCallback)

    } catch (error) {
      console.error(chalk.red('Error creating query:'), error.message)
      await this.waitForContinue()
      return this.showManageQueries(sheet, schema, returnCallback)
    }
  }

  async showQueryDetail(sheet, schema, query, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`📄 Query Detail - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}\n`))
    console.log(chalk.gray(`Schema: ${schema.name}`))
    console.log(chalk.gray(`Query: ${query.name}${query.listView ? ' 📋' : ''}`))
    console.log(chalk.gray(`JMESPath: ${query.JMESPathQuery}`))
    console.log(chalk.gray(`Query ID: ${query.queryId}\n`))

    const choices = [
      {
        name: '🧪 Test Query',
        value: 'test',
        description: 'Test this query against current data'
      },
      {
        name: '✏️ Edit Query',
        value: 'edit',
        description: 'Modify the query text or settings'
      }
    ]

    if (!query.listView) {
      choices.push({
        name: '📋 Set as List View',
        value: 'set-list-view',
        description: 'Use this query for row list display'
      })
    } else {
      choices.push({
        name: '📄 Remove List View',
        value: 'remove-list-view',
        description: 'Stop using this query for row list display'
      })
    }

    choices.push(
      {
        name: '🗑️ Delete Query',
        value: 'delete',
        description: 'Remove this query permanently'
      },
      {
        name: chalk.gray('← Back to Manage Queries'),
        value: 'back'
      }
    )

    const choice = await select({
      message: 'What would you like to do?',
      choices
    })

    switch (choice) {
      case 'test':
        return this.showTestQuery(sheet, schema, query, returnCallback)
      case 'edit':
        return this.showEditQuery(sheet, schema, query, returnCallback)
      case 'set-list-view':
        return this.showSetListView(sheet, schema, query, returnCallback)
      case 'remove-list-view':
        return this.showRemoveListView(sheet, schema, query, returnCallback)
      case 'delete':
        return this.showDeleteQuery(sheet, schema, query, returnCallback)
      case 'back':
        return this.showManageQueries(sheet, schema, returnCallback)
    }
  }

  async showTestQuery(sheet, schema, query, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`🧪 Test Query - ${query.name}\n`))
    console.log(chalk.gray(`Query: ${query.JMESPathQuery}\n`))

    try {
      // Get some sample rows to test against
      const rows = await sheet.list(schema.schemaId, {})
      
      if (rows.length === 0) {
        console.log(chalk.yellow('No rows found to test against. Add some data first.'))
        await this.waitForContinue()
        return this.showQueryDetail(sheet, schema, query, returnCallback)
      }

      console.log(chalk.gray(`Testing against ${rows.length} row(s)...\n`))

      // Test the query
      const jmespath = (await import('jmespath')).default
      const results = []
      
      for (let i = 0; i < Math.min(rows.length, 5); i++) { // Test first 5 rows
        try {
          const result = jmespath.search(rows[i].json, query.JMESPathQuery)
          results.push({
            rowId: rows[i].rowId.substring(0, 16) + '...',
            result: result
          })
        } catch (error) {
          results.push({
            rowId: rows[i].rowId.substring(0, 16) + '...',
            error: error.message
          })
        }
      }

      // Display results
      results.forEach((result, index) => {
        console.log(chalk.blue(`Row ${index + 1} (${result.rowId}):`))
        if (result.error) {
          console.log(chalk.red(`  Error: ${result.error}`))
        } else {
          console.log(`  Result: ${JSON.stringify(result.result, null, 2)}`)
        }
        console.log('')
      })

      await this.waitForContinue()
      return this.showQueryDetail(sheet, schema, query, returnCallback)

    } catch (error) {
      console.error(chalk.red('Error testing query:'), error.message)
      await this.waitForContinue()
      return this.showQueryDetail(sheet, schema, query, returnCallback)
    }
  }

  async showEditQuery(sheet, schema, query, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`✏️ Edit Query - ${query.name}\n`))

    try {
      const newQueryText = await input({
        message: 'JMESPath query:',
        default: query.JMESPathQuery,
        validate: (input) => {
          if (!input.trim()) return 'Query is required'
          return true
        }
      })

      const newQueryName = await input({
        message: 'Query name:',
        default: query.name,
        validate: (input) => {
          if (!input.trim()) return 'Query name is required'
          return true
        }
      })

      await sheet.updateQuery(query.queryId, newQueryName.trim(), newQueryText.trim(), query.listView)
      console.log(chalk.green(`✅ Query "${newQueryName.trim()}" updated successfully!`))
      
      await this.waitForContinue()
      return this.showManageQueries(sheet, schema, returnCallback)

    } catch (error) {
      console.error(chalk.red('Error updating query:'), error.message)
      await this.waitForContinue()
      return this.showQueryDetail(sheet, schema, query, returnCallback)
    }
  }

  async showSetListView(sheet, schema, query, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`📋 Set as List View - ${query.name}\n`))

    // Check if query is suitable for list view
    const analysis = this.sheetOps.analyzeListViewQuery(query.JMESPathQuery)
    
    if (!analysis.isValidListView) {
      console.log(chalk.yellow(`⚠️ This query may not be suitable for list view display.`))
      console.log(chalk.gray(`Reason: ${analysis.reason}\n`))
      
      const proceed = await confirm({
        message: 'Set as list view anyway?',
        default: false
      })
      
      if (!proceed) {
        return this.showQueryDetail(sheet, schema, query, returnCallback)
      }
    } else {
      console.log(chalk.green(`✅ Query is suitable for list view with columns: ${analysis.columns.join(', ')}\n`))
    }

    try {
      // Check for existing list view
      const existingListView = await this.sheetOps.checkExistingListView(sheet, schema)
      
      if (existingListView && existingListView.queryId !== query.queryId) {
        console.log(chalk.yellow(`Warning: Schema already has a list view query: "${existingListView.name}"`))
        const replaceExisting = await confirm({
          message: 'Replace the existing list view query with this one?',
          default: false
        })
        
        if (!replaceExisting) {
          return this.showQueryDetail(sheet, schema, query, returnCallback)
        }
        
        // Remove list view flag from existing query
        await sheet.updateQuery(existingListView.queryId, existingListView.name, existingListView.JMESPathQuery, false)
        console.log(chalk.gray(`Removed list view flag from "${existingListView.name}"`))
      }

      await sheet.updateQuery(query.queryId, query.name, query.JMESPathQuery, true)
      console.log(chalk.green(`✅ "${query.name}" is now the list view query!`))
      
      await this.waitForContinue()
      return this.showManageQueries(sheet, schema, returnCallback)

    } catch (error) {
      console.error(chalk.red('Error setting list view:'), error.message)
      await this.waitForContinue()
      return this.showQueryDetail(sheet, schema, query, returnCallback)
    }
  }

  async showRemoveListView(sheet, schema, query, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`📄 Remove List View - ${query.name}\n`))

    const confirmRemove = await confirm({
      message: 'Remove list view designation from this query?',
      default: true
    })

    if (!confirmRemove) {
      return this.showQueryDetail(sheet, schema, query, returnCallback)
    }

    try {
      await sheet.updateQuery(query.queryId, query.name, query.JMESPathQuery, false)
      console.log(chalk.green(`✅ List view designation removed from "${query.name}"`))
      
      await this.waitForContinue()
      return this.showManageQueries(sheet, schema, returnCallback)

    } catch (error) {
      console.error(chalk.red('Error removing list view:'), error.message)
      await this.waitForContinue()
      return this.showQueryDetail(sheet, schema, query, returnCallback)
    }
  }

  async showDeleteQuery(sheet, schema, query, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`🗑️ Delete Query - ${query.name}\n`))
    console.log(chalk.yellow('⚠️ This action cannot be undone!'))
    console.log(chalk.gray(`Query: ${query.name}${query.listView ? ' (List View)' : ''}`))
    console.log(chalk.gray(`JMESPath: ${query.JMESPathQuery}\n`))

    const confirmDelete = await confirm({
      message: 'Are you sure you want to delete this query?',
      default: false
    })

    if (!confirmDelete) {
      console.log(chalk.yellow('Deletion cancelled'))
      await this.waitForContinue()
      return this.showQueryDetail(sheet, schema, query, returnCallback)
    }

    try {
      await sheet.deleteQuery(query.queryId)
      console.log(chalk.green(`✅ Query "${query.name}" deleted successfully`))
      
      await this.waitForContinue()
      return this.showManageQueries(sheet, schema, returnCallback)

    } catch (error) {
      console.error(chalk.red('Error deleting query:'), error.message)
      await this.waitForContinue()
      return this.showQueryDetail(sheet, schema, query, returnCallback)
    }
  }
}
