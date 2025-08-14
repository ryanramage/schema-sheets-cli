import toClipboard from 'to-clipboard-android'
import chalk from 'chalk'
import { input } from '@inquirer/prompts'

export async function copyToClipboardWithFeedback(text, description = 'text') {
  try {
    toClipboard.sync(text)
    console.log(chalk.green(`✓ ${description} copied to clipboard`))
    console.log(chalk.blue(`${description}: ${text}`))
  } catch (error) {
    console.error(chalk.red(`Failed to copy to clipboard: ${error.message}`))
    console.log(chalk.blue(`${description}: ${text}`))
  }
  
  await input({ message: 'Press Enter to continue...' })
}
