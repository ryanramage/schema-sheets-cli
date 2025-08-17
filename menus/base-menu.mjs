import { select, input, confirm } from '@inquirer/prompts'
import chalk from 'chalk'

export class BaseMenu {
  constructor(roomManager, sheetOps) {
    this.roomManager = roomManager
    this.sheetOps = sheetOps
  }

  async showMenu(title, choices, message = 'Select an option:') {
    console.clear()
    console.log(chalk.blue.bold(title))
    if (this.roomManager.getCurrentRoomName()) {
      console.log(chalk.cyan(`Room: ${this.roomManager.getCurrentRoomName()}`))
    }
    console.log('')

    return await select({
      message,
      choices,
      pageSize: Math.min(choices.length, process.stdout.rows - 10) // Use most of terminal height
    })
  }

  async getInput(message, options = {}) {
    return await input({
      message,
      ...options
    })
  }

  async getConfirmation(message, defaultValue = false) {
    return await confirm({
      message,
      default: defaultValue
    })
  }

  async waitForContinue() {
    await input({ message: 'Press Enter to continue...' })
  }
}
