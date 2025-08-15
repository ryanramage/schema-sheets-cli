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
      console.log(chalk.gray(`Room: ${this.roomManager.getCurrentRoomName()}`))
    }
    console.log('')

    return await select({
      message,
      choices
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
