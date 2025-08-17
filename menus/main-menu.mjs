import chalk from 'chalk'
import z32 from 'z32'
import { BaseMenu } from './base-menu.mjs'

export class MainMenu extends BaseMenu {
  async show(sheet) {
    const title = `📊 Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}`
    console.log(chalk.cyan('Navigate with arrow keys, select with Enter\n'))

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
          name: chalk.cyan('--- Actions ---'),
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

      const choice = await this.showMenu(title, choices, 'Select a schema to manage or choose an action:')

      if (choice === 'separator') {
        // User accidentally selected separator, re-render menu
        return this.show(sheet)
      }

      return { choice, schemas }
    } catch (error) {
      console.error(chalk.red('Error loading schemas:'), error.message)
      await this.waitForContinue()
      return this.show(sheet)
    }
  }

  async showChangeRoomName(sheet) {
    const title = `✏️ Change Room Name - Current: ${this.roomManager.getCurrentRoomName() || 'Unknown'}`

    try {
      const newPetName = await this.getInput('Enter new room name:', {
        default: this.roomManager.getCurrentRoomName() || '',
        validate: (input) => {
          if (!input.trim()) return 'Room name is required'
          return true
        }
      })

      await this.roomManager.changeRoomName(newPetName)
      
      await this.waitForContinue()
      return this.show(sheet)
    } catch (error) {
      console.error(chalk.red('Error changing room name:'), error.message)
      await this.waitForContinue()
      return this.show(sheet)
    }
  }

  async showCopyRoomLink(sheet) {
    const currentRoomLink = this.roomManager.getCurrentRoomLink()
    
    if (!currentRoomLink) {
      console.log(chalk.red('No room link available'))
      await this.waitForContinue()
      return this.show(sheet)
    }

    const { copyToClipboardWithFeedback } = await import('../utils/clipboard.mjs')
    await copyToClipboardWithFeedback(currentRoomLink, 'Room Link')
    return this.show(sheet)
  }
}
