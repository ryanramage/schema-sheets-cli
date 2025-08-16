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
        name: chalk.gray('← Back to Main Menu'),
        value: 'back'
      }
    ]

    return await this.showMenu(title, choices, 'What would you like to do?')
  }

  async showRowList(sheet, schema, returnCallback) {
    console.clear()
    console.log(chalk.blue.bold(`📋 Rows in Schema: ${schema.name} - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}\n`))

    try {
      const rows = await sheet.list(schema.schemaId, {})
      
      if (rows.length === 0) {
        console.log(chalk.yellow('No rows found. Add one first!'))
        await this.waitForContinue()
        return returnCallback(sheet, schema)
      }

      // Create table with row snippets
      const table = createRowTable()
      rows.forEach(row => addRowToTable(table, row))

      console.log(table.toString())

      const choices = createRowChoices(rows)

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

      const selectedRow = rows.find(r => r.rowId === choice)
      await this.showRowDetail(sheet, schema, selectedRow, 'list', returnCallback)
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
      const rows = await sheet.list(schema.schemaId, filter)
      
      if (rows.length === 0) {
        console.log(chalk.yellow('No rows found in the selected date range.'))
        await this.waitForContinue()
        return this.showFilterRows(sheet, schema, returnCallback)
      }

      // Create table with row snippets
      const table = createRowTable()
      rows.forEach(row => addRowToTable(table, row))

      console.log(table.toString())

      const choices = createRowChoices(rows)

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

      const selectedRow = rows.find(r => r.rowId === choice)
      await this.showRowDetail(sheet, schema, selectedRow, 'filter', returnCallback)
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
}
