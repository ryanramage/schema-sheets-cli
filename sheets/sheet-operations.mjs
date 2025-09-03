import chalk from 'chalk'
import { input, confirm } from '@inquirer/prompts'
import Ajv from 'ajv'
import addFormats from "ajv-formats"
import { selectJsonFile, readJsonFile, downloadJsonFromUrl } from '../utils/file-helpers.mjs'
import { issueSchema } from '../examples/issue-schema.mjs'
import fs from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'
import crypto from 'crypto'

export class SheetOperations {
  constructor() {
    this.lastJmesQuery = ''
  }

  /**
   * Analyze a JMESPath query to determine if it's suitable for list view
   * and extract column information
   */
  analyzeListViewQuery(queryText) {
    if (!queryText || !queryText.trim()) {
      return { isValidListView: false, columns: [], reason: 'Empty query' }
    }

    const query = queryText.trim()
    
    // Pattern 1: [].{key1: expr1, key2: expr2, ...}
    // This is the main pattern we want to support for list views
    const objectProjectionPattern = /^\[\]\.?\{([^}]+)\}$/
    const objectMatch = query.match(objectProjectionPattern)
    
    if (objectMatch) {
      try {
        // Extract the content inside the braces
        const objectContent = objectMatch[1]
        
        // Parse key-value pairs, handling nested expressions
        const columns = []
        let currentKey = ''
        let currentValue = ''
        let inKey = true
        let braceDepth = 0
        let bracketDepth = 0
        let inQuotes = false
        let quoteChar = ''
        
        for (let i = 0; i < objectContent.length; i++) {
          const char = objectContent[i]
          const prevChar = i > 0 ? objectContent[i - 1] : ''
          
          // Handle quotes
          if ((char === '"' || char === "'") && prevChar !== '\\') {
            if (!inQuotes) {
              inQuotes = true
              quoteChar = char
            } else if (char === quoteChar) {
              inQuotes = false
              quoteChar = ''
            }
          }
          
          if (!inQuotes) {
            // Track nesting depth
            if (char === '{') braceDepth++
            else if (char === '}') braceDepth--
            else if (char === '[') bracketDepth++
            else if (char === ']') bracketDepth--
            
            // Handle key-value separation
            if (char === ':' && braceDepth === 0 && bracketDepth === 0 && inKey) {
              inKey = false
              continue
            }
            
            // Handle field separation
            if (char === ',' && braceDepth === 0 && bracketDepth === 0) {
              if (currentKey.trim() && currentValue.trim()) {
                columns.push({
                  key: currentKey.trim(),
                  expression: currentValue.trim()
                })
              }
              currentKey = ''
              currentValue = ''
              inKey = true
              continue
            }
          }
          
          // Accumulate characters
          if (inKey) {
            currentKey += char
          } else {
            currentValue += char
          }
        }
        
        // Handle the last key-value pair
        if (currentKey.trim() && currentValue.trim()) {
          columns.push({
            key: currentKey.trim(),
            expression: currentValue.trim()
          })
        }
        
        if (columns.length > 0) {
          return {
            isValidListView: true,
            columns: columns.map(col => col.key),
            columnDetails: columns,
            pattern: 'object-projection'
          }
        }
      } catch (error) {
        return { 
          isValidListView: false, 
          columns: [], 
          reason: `Failed to parse object projection: ${error.message}` 
        }
      }
    }
    
    // Pattern 2: Simple property access like "title" or "status"
    // This creates a single-column list view
    const simplePropertyPattern = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/
    if (query.match(simplePropertyPattern)) {
      return {
        isValidListView: true,
        columns: [query],
        columnDetails: [{ key: query, expression: query }],
        pattern: 'simple-property'
      }
    }
    
    // Pattern 3: Array of simple properties like "[title, status]"
    const arrayPattern = /^\[([^\]]+)\]$/
    const arrayMatch = query.match(arrayPattern)
    if (arrayMatch) {
      try {
        const arrayContent = arrayMatch[1]
        const properties = arrayContent.split(',').map(prop => prop.trim())
        
        // Validate each property is a simple property access
        const validProperties = properties.every(prop => 
          prop.match(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/)
        )
        
        if (validProperties && properties.length > 0) {
          return {
            isValidListView: true,
            columns: properties,
            columnDetails: properties.map(prop => ({ key: prop, expression: prop })),
            pattern: 'property-array'
          }
        }
      } catch (error) {
        return { 
          isValidListView: false, 
          columns: [], 
          reason: `Failed to parse property array: ${error.message}` 
        }
      }
    }
    
    return { 
      isValidListView: false, 
      columns: [], 
      reason: 'Query pattern not suitable for list view. Use formats like: [].{title: title, status: status}' 
    }
  }

  async addSchema(sheet, method, name) {
    let schemaContent

    if (method === 'file') {
      const filePath = await selectJsonFile('Select schema JSON file:')
      schemaContent = readJsonFile(filePath)
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

      console.log(chalk.cyan('Downloading schema...'))
      schemaContent = await downloadJsonFromUrl(url)
    } else if (method === 'example') {
      schemaContent = issueSchema
      console.log(chalk.cyan('\nUsing example issue schema:'))
      console.log(JSON.stringify(schemaContent, null, 2))
      console.log('')
    }

    const schemaId = await sheet.addNewSchema(name, schemaContent)
    console.log(chalk.green(`✅ Schema "${name}" added successfully with ID: ${schemaId}`))
    
    return schemaId
  }

  async addRowFromFile(sheet, schema) {
    try {
      const filePath = await selectJsonFile('Select JSON file:')
      const jsonContent = readJsonFile(filePath)
      
      // Validate JSON against schema using AJV
      const ajv = new Ajv({ allErrors: true })
      addFormats(ajv)

      const validate = ajv.compile(schema.jsonSchema)
      const valid = validate(jsonContent)
      
      // Show preview of JSON
      console.log(chalk.cyan('\nJSON Preview:'))
      console.log(JSON.stringify(jsonContent, null, 2))
      
      if (!valid) {
        console.log(chalk.red('\n❌ JSON validation failed against schema!'))
        console.log(chalk.yellow('\nValidation errors:'))
        validate.errors.forEach((error, index) => {
          console.log(chalk.red(`  ${index + 1}. ${error.instancePath || 'root'}: ${error.message}`))
          if (error.params && error.params.allowedValues) {
            console.log(chalk.cyan(`     Allowed values: ${error.params.allowedValues.join(', ')}`))
          }
        })
        console.log(chalk.cyan('\nPlease fix the JSON data and try again.'))
        throw new Error('JSON validation failed')
      }
      
      console.log(chalk.green('\n✅ JSON validation passed!'))
      
      const confirmAdd = await input({
        message: '\nAdd this row? (y/N):',
        default: 'n'
      })

      if (confirmAdd.toLowerCase() !== 'y' && confirmAdd.toLowerCase() !== 'yes') {
        throw new Error('Row addition cancelled')
      }

      const rowId = await sheet.addRow(schema.schemaId, jsonContent)
      console.log(chalk.green(`✅ Row added successfully with ID: ${rowId}`))
      
      return { rowId, rowData: jsonContent }
    } catch (error) {
      console.error(chalk.red('Error adding row:'), error.message)
      throw error
    }
  }

  async editSchemaInEditor(sheet, schema) {
    const tempFileName = `schema-${schema.schemaId}-${crypto.randomBytes(8).toString('hex')}.json`
    const tempFilePath = join(tmpdir(), tempFileName)
    
    try {
      // Write current schema to temporary file
      const schemaJson = JSON.stringify(schema.jsonSchema, null, 2)
      fs.writeFileSync(tempFilePath, schemaJson, 'utf8')
      
      console.log(chalk.cyan(`Opening schema in editor: ${tempFilePath}`))
      console.log(chalk.yellow('Save and close the editor when you\'re done editing...'))
      
      // Determine the editor command based on platform and environment
      let editorCommand
      let editorArgs = [tempFilePath]
      
      if (process.env.EDITOR) {
        // Use user's preferred editor from environment
        editorCommand = process.env.EDITOR
      } else if (process.platform === 'darwin') {
        // macOS - try to use the default editor
        editorCommand = 'open'
        editorArgs = ['-W', '-t', tempFilePath] // -W waits for app to close, -t opens in text editor
      } else if (process.platform === 'win32') {
        // Windows
        editorCommand = 'notepad'
      } else {
        // Linux/Unix - try common editors
        const editors = ['code', 'nano', 'vim', 'vi', 'gedit']
        editorCommand = editors.find(editor => {
          try {
            // Check if editor exists in PATH
            require('child_process').execSync(`which ${editor}`, { stdio: 'ignore' })
            return true
          } catch {
            return false
          }
        }) || 'vi' // fallback to vi
      }
      
      // Launch editor and wait for it to close
      await new Promise((resolve, reject) => {
        const editorProcess = spawn(editorCommand, editorArgs, {
          stdio: 'inherit',
          shell: true
        })
        
        editorProcess.on('close', (code) => {
          if (code === 0) {
            resolve()
          } else {
            reject(new Error(`Editor exited with code ${code}`))
          }
        })
        
        editorProcess.on('error', (error) => {
          reject(new Error(`Failed to launch editor: ${error.message}`))
        })
      })
      
      // Read the edited file
      let editedSchemaJson
      try {
        const editedContent = fs.readFileSync(tempFilePath, 'utf8')
        editedSchemaJson = JSON.parse(editedContent)
      } catch (error) {
        return {
          updated: false,
          cancelled: false,
          error: `Invalid JSON in edited file: ${error.message}`
        }
      }
      
      // Check if schema was actually changed
      const originalSchemaString = JSON.stringify(schema.jsonSchema, null, 2)
      const editedSchemaString = JSON.stringify(editedSchemaJson, null, 2)
      
      if (originalSchemaString === editedSchemaString) {
        return {
          updated: false,
          cancelled: false,
          message: 'No changes detected'
        }
      }
      
      // Validate the edited schema is a valid JSON Schema
      const ajv = new Ajv({ allErrors: true })
      addFormats(ajv)
      
      try {
        // Try to compile the schema to validate it's a valid JSON Schema
        ajv.compile(editedSchemaJson)
      } catch (error) {
        return {
          updated: false,
          cancelled: false,
          error: `Invalid JSON Schema: ${error.message}`
        }
      }
      
      // Show preview of changes
      console.log(chalk.cyan('\nEdited Schema Preview:'))
      console.log(JSON.stringify(editedSchemaJson, null, 2))
      console.log('')
      
      const confirmUpdate = await confirm({
        message: 'Update the schema with these changes?',
        default: true
      })
      
      if (!confirmUpdate) {
        return {
          updated: false,
          cancelled: true,
          message: 'Schema update cancelled by user'
        }
      }
      
      // Update the schema
      await sheet.updateSchema(schema.schemaId, editedSchemaJson, { name: schema.name })
      
      const warnings = []
      
      // Check for potentially breaking changes
      if (this.hasBreakingChanges(schema.jsonSchema, editedSchemaJson)) {
        warnings.push('Schema changes may affect existing data validation')
      }
      
      return {
        updated: true,
        cancelled: false,
        warnings
      }
      
    } catch (error) {
      throw new Error(`Failed to edit schema: ${error.message}`)
    } finally {
      // Clean up temporary file
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath)
        }
      } catch (error) {
        console.warn(chalk.yellow(`Warning: Could not delete temporary file: ${error.message}`))
      }
    }
  }

  /**
   * Check if schema changes might break existing data
   */
  hasBreakingChanges(oldSchema, newSchema) {
    // Simple heuristic checks for potentially breaking changes
    try {
      // Check if required fields were added
      const oldRequired = oldSchema.required || []
      const newRequired = newSchema.required || []
      const addedRequired = newRequired.filter(field => !oldRequired.includes(field))
      
      if (addedRequired.length > 0) {
        return true
      }
      
      // Check if field types changed
      const oldProperties = oldSchema.properties || {}
      const newProperties = newSchema.properties || {}
      
      for (const [fieldName, oldProp] of Object.entries(oldProperties)) {
        const newProp = newProperties[fieldName]
        if (newProp && oldProp.type && newProp.type && oldProp.type !== newProp.type) {
          return true
        }
      }
      
      return false
    } catch (error) {
      // If we can't analyze, assume there might be breaking changes
      return true
    }
  }

  async addUISchema(sheet, schema, method, name) {
    let uiSchemaContent

    if (method === 'file') {
      const filePath = await selectJsonFile('Select UI schema JSON file:')
      uiSchemaContent = readJsonFile(filePath)
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

      console.log(chalk.cyan('Downloading UI schema...'))
      uiSchemaContent = await downloadJsonFromUrl(url)
    }

    // Show preview
    console.log(chalk.cyan('\nUI Schema Preview:'))
    console.log(JSON.stringify(uiSchemaContent, null, 2))
    
    const confirmAdd = await confirm({
      message: 'Add this UI schema?',
      default: true
    })

    if (!confirmAdd) {
      throw new Error('UI schema addition cancelled')
    }

    const uischemaId = await sheet.addUISchema(schema.schemaId, name, uiSchemaContent)
    console.log(chalk.green(`✅ UI Schema "${name}" added successfully with ID: ${uischemaId}`))
    
    return uischemaId
  }

  async updateUISchema(sheet, schema, uiSchema, method) {
    let newUISchemaContent

    if (method === 'file') {
      const filePath = await selectJsonFile('Select new UI schema JSON file:')
      newUISchemaContent = readJsonFile(filePath)
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

      console.log(chalk.cyan('Downloading UI schema...'))
      newUISchemaContent = await downloadJsonFromUrl(url)
    }

    // Show preview
    console.log(chalk.cyan('\nNew UI Schema Preview:'))
    console.log(JSON.stringify(newUISchemaContent, null, 2))
    
    const confirmUpdate = await confirm({
      message: 'Update the UI schema with this content?',
      default: true
    })

    if (!confirmUpdate) {
      throw new Error('UI schema update cancelled')
    }

    await sheet.updateUISchema(uiSchema.uischemaId, schema.schemaId, uiSchema.name, newUISchemaContent)
    console.log(chalk.green(`✅ UI Schema "${uiSchema.name}" updated successfully`))
  }

  async saveQuery(sheet, schema, queryText) {
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

      // Analyze the query to see if it's suitable for list view
      const analysis = this.analyzeListViewQuery(queryText)
      let isListView = false

      if (analysis.isValidListView) {
        console.log(chalk.cyan(`\nDetected list view query with columns: ${analysis.columns.join(', ')}`))
        
        // Check for existing list view queries
        const existingListView = await this.checkExistingListView(sheet, schema)
        
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
              console.log(chalk.cyan(`Removed list view flag from "${existingListView.name}"`))
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

      try {
        await sheet.addQuery(schema.schemaId, queryName.trim(), queryText, isListView)
        console.log(chalk.green(`✅ Query "${queryName.trim()}" saved!`))
        if (isListView) {
          console.log(chalk.green(`✅ Set as list view query`))
        }
      } catch (error) {
        console.log(chalk.yellow(`Warning: Could not save query: ${error.message}`))
      }
    }
  }

  /**
   * Check if a schema already has a list view query
   */
  async checkExistingListView(sheet, schema) {
    try {
      const savedQueries = await sheet.listQueries(schema.schemaId)
      return savedQueries.find(query => query.listView === true) || null
    } catch (error) {
      console.warn(`Failed to check existing list view queries:`, error.message)
      return null
    }
  }

  /**
   * Get the list view query for a schema (returns the first one found)
   */
  async getListViewQuery(sheet, schema) {
    try {
      const savedQueries = await sheet.listQueries(schema.schemaId)
      const listViewQueries = savedQueries.filter(query => query.listView === true)
      
      if (listViewQueries.length > 1) {
        console.warn(`Schema "${schema.name}" has multiple list view queries, using the first one: "${listViewQueries[0].name}"`)
      }
      
      return listViewQueries.length > 0 ? listViewQueries[0] : null
    } catch (error) {
      console.warn(`Failed to get list view query:`, error.message)
      return null
    }
  }

  getLastJmesQuery() {
    return this.lastJmesQuery
  }

  setLastJmesQuery(query) {
    this.lastJmesQuery = query
  }

  resetLastJmesQuery() {
    this.lastJmesQuery = ''
  }

  async showQuerySelection(sheet, schema) {
    try {
      const savedQueries = await sheet.listQueries(schema.schemaId)
      
      const choices = [
        {
          name: '🚫 No Query Filter',
          value: 'none',
          description: 'Skip JMESPath filtering'
        }
      ]
      
      // Add saved queries if any exist
      if (savedQueries.length > 0) {
        choices.push({
          name: chalk.cyan('--- Saved Queries ---'),
          value: 'separator-saved',
          disabled: ''
        })
        
        savedQueries.forEach(query => {
          choices.push({
            name: `💾 ${query.name}${query.listView ? ' 📋' : ''}`,
            value: `saved-${query.queryId}`,
            description: `Query: ${query.JMESPathQuery}${query.listView ? ' (List View)' : ''}`
          })
        })
        
        choices.push({
          name: chalk.cyan('--- Create New ---'),
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
        }
      )

      const { select } = await import('@inquirer/prompts')
      const queryChoice = await select({
        message: 'Select a query filter:',
        choices
      })

      if (queryChoice.startsWith('separator-')) {
        // User accidentally selected separator, re-render menu
        return this.showQuerySelection(sheet, schema)
      }

      if (queryChoice === 'none') {
        return ''
      }

      if (queryChoice.startsWith('saved-')) {
        const queryId = queryChoice.replace('saved-', '')
        const selectedQuery = savedQueries.find(q => q.queryId === queryId)
        if (selectedQuery) {
          this.setLastJmesQuery(selectedQuery.JMESPathQuery)
          return selectedQuery.JMESPathQuery
        }
      }

      if (queryChoice === 'custom') {
        console.log(chalk.cyan('\nEnter JMESPath query to filter results'))
        console.log(chalk.cyan('Examples: title, status == `open`, priority == `high`'))
        console.log(chalk.cyan('Leave empty to skip filtering\n'))
        
        const { input } = await import('@inquirer/prompts')
        const customQuery = await input({
          message: 'JMESPath query:',
          default: this.getLastJmesQuery(),
          validate: (input) => {
            // Allow empty input
            if (!input.trim()) return true
            return true
          }
        })

        const queryText = customQuery.trim()
        this.setLastJmesQuery(queryText)

        // Ask if user wants to save this query
        if (queryText) {
          await this.saveQuery(sheet, schema, queryText)
        }

        return queryText
      }

      return ''
    } catch (error) {
      console.error(chalk.red('Error loading queries:'), error.message)
      return ''
    }
  }

  async addRowFromFile(sheet, schema) {
    try {
      const filePath = await selectJsonFile('Select JSON file:')
      const jsonContent = readJsonFile(filePath)
      
      // Validate JSON against schema using AJV
      const ajv = new Ajv({ allErrors: true })
      addFormats(ajv)

      const validate = ajv.compile(schema.jsonSchema)
      const valid = validate(jsonContent)
      
      // Show preview of JSON
      console.log(chalk.cyan('\nJSON Preview:'))
      console.log(JSON.stringify(jsonContent, null, 2))
      
      if (!valid) {
        console.log(chalk.red('\n❌ JSON validation failed against schema!'))
        console.log(chalk.yellow('\nValidation errors:'))
        validate.errors.forEach((error, index) => {
          console.log(chalk.red(`  ${index + 1}. ${error.instancePath || 'root'}: ${error.message}`))
          if (error.params && error.params.allowedValues) {
            console.log(chalk.cyan(`     Allowed values: ${error.params.allowedValues.join(', ')}`))
          }
        })
        console.log(chalk.cyan('\nPlease fix the JSON data and try again.'))
        throw new Error('JSON validation failed')
      }
      
      console.log(chalk.green('\n✅ JSON validation passed!'))
      
      const confirmAdd = await input({
        message: '\nAdd this row? (y/N):',
        default: 'n'
      })

      if (confirmAdd.toLowerCase() !== 'y' && confirmAdd.toLowerCase() !== 'yes') {
        throw new Error('Row addition cancelled')
      }

      const rowId = await sheet.addRow(schema.schemaId, jsonContent)
      console.log(chalk.green(`✅ Row added successfully with ID: ${rowId}`))
      
      return { rowId, rowData: jsonContent }
    } catch (error) {
      console.error(chalk.red('Error adding row:'), error.message)
      throw error
    }
  }
}
