import chalk from 'chalk'
import { input, confirm } from '@inquirer/prompts'
import Ajv from 'ajv'
import addFormats from "ajv-formats"
import { selectJsonFile, readJsonFile, downloadJsonFromUrl } from '../utils/file-helpers.mjs'
import { issueSchema } from '../examples/issue-schema.mjs'

export class SheetOperations {
  constructor() {
    this.lastJmesQuery = ''
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

      console.log(chalk.gray('Downloading schema...'))
      schemaContent = await downloadJsonFromUrl(url)
    } else if (method === 'example') {
      schemaContent = issueSchema
      console.log(chalk.gray('\nUsing example issue schema:'))
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
      
      return rowId
    } catch (error) {
      console.error(chalk.red('Error adding row:'), error.message)
      throw error
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

      console.log(chalk.gray('Downloading UI schema...'))
      uiSchemaContent = await downloadJsonFromUrl(url)
    }

    // Show preview
    console.log(chalk.gray('\nUI Schema Preview:'))
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

      console.log(chalk.gray('Downloading UI schema...'))
      newUISchemaContent = await downloadJsonFromUrl(url)
    }

    // Show preview
    console.log(chalk.gray('\nNew UI Schema Preview:'))
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

      try {
        await sheet.addQuery(schema.schemaId, queryName.trim(), queryText)
        console.log(chalk.green(`✅ Query "${queryName.trim()}" saved!`))
      } catch (error) {
        console.log(chalk.yellow(`Warning: Could not save query: ${error.message}`))
      }
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
}
