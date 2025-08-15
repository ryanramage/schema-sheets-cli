import chalk from 'chalk'
import { BaseMenu } from './base-menu.mjs'

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

    return await this.showMenu(title, choices, 'What would you like to do?')
  }

  async showAddRow(sheet, schema) {
    const title = `➕ Add Row to Schema: ${schema.name} - Room: ${this.roomManager.getCurrentRoomName() || 'Unknown'}`

    const choices = [
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

    return await this.showMenu(title, choices, 'How would you like to add the row?')
  }
}
