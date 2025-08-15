import chalk from 'chalk'
import { BaseMenu } from './base-menu.mjs'

export class SchemaMenu extends BaseMenu {
  async showAddSchema(sheet) {
    const title = `➕ Add New Schema - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}`

    const choices = [
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

    const method = await this.showMenu(title, choices, 'How would you like to add the schema?')

    if (method === 'back') {
      return { method }
    }

    try {
      const name = await this.getInput('Enter schema name:', {
        validate: (input) => {
          if (!input.trim()) return 'Schema name is required'
          return true
        }
      })

      return { method, name }
    } catch (error) {
      console.error(chalk.red('Error in add schema form:'), error.message)
      await this.waitForContinue()
      return { method: 'back' }
    }
  }
}
