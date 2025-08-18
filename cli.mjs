#!/usr/bin/env node

import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import BlindPeering from 'blind-peering'
import fs from 'fs'
import { join } from 'path'
import { makeDirectory } from 'make-dir'
import { input } from '@inquirer/prompts'
import chalk from 'chalk'
import Wakeup from 'protomux-wakeup'
import { createLobby } from './lobby.mjs'
import { DefaultConfig, paths } from './config/default-config.mjs'
import { RoomManager } from './rooms/room-manager.mjs'
import { SheetOperations } from './sheets/sheet-operations.mjs'
import { MainMenu } from './menus/main-menu.mjs'
import { RoomLobbyMenu } from './menus/room-lobby-menu.mjs'
import { SchemaMenu } from './menus/schema-menu.mjs'
import { RowMenu } from './menus/row-menu.mjs'


// Try to load config from file
let config = { ...DefaultConfig }
try {
  const configPath = join(paths.config, 'config.json')
  const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (configData.DEFAULT_BLIND_PEER_KEYS) {
    config.DEFAULT_BLIND_PEER_KEYS = configData.DEFAULT_BLIND_PEER_KEYS
  }
} catch (error) {
  // Config file doesn't exist or is invalid, use defaults
  console.log('Using default config (no config file found)')
}

// Ensure storage directory exists
await makeDirectory(config.storage)

// Create corestore subdirectory
const corestorePath = join(config.storage, 'corestore')
await makeDirectory(corestorePath)

const store = new Corestore(corestorePath)
const swarm = new Hyperswarm()
const wakeup = new Wakeup()
const blind = new BlindPeering(swarm, store, { wakeup, mirrors: config.DEFAULT_BLIND_PEER_KEYS })
const lobby = createLobby(config.storage)

// Initialize managers
const roomManager = new RoomManager(lobby, swarm, store, blind, wakeup)
const sheetOps = new SheetOperations()

// Initialize menus
const mainMenu = new MainMenu(roomManager, sheetOps)
const roomLobbyMenu = new RoomLobbyMenu(roomManager, sheetOps, lobby)
const schemaMenu = new SchemaMenu(roomManager, sheetOps)
const rowMenu = new RowMenu(roomManager, sheetOps)

async function teardown() {
  await roomManager.closeCurrentSheet()
  sheetOps.resetLastJmesQuery()
  await blind.close()
  await swarm.destroy()
  await store.close()
}

swarm.on('connection', c => {
  c.on('close', function () {})
  store.replicate(c)
  wakeup.addStream(c)
})

process.once('SIGINT', async function () {
  console.log('shutting down....')
  await teardown()
  process.exit()
})


// Main navigation functions
async function showMainMenu(sheet) {
  try {
    console.log(chalk.cyan('DEBUG: Entering showMainMenu'))
    const { choice, schemas } = await mainMenu.show(sheet)
    console.log(chalk.cyan(`DEBUG: Main menu choice: ${choice}`))

    if (choice.startsWith('schema-')) {
      const schemaId = choice.replace('schema-', '')
      const selectedSchema = schemas.find(s => s.schemaId === schemaId)
      await showRowMenu(sheet, selectedSchema)
    } else {
      switch (choice) {
        case 'add-schema':
          await showAddSchema(sheet)
          break
        case 'change-room-name':
          await mainMenu.showChangeRoomName(sheet)
          break
        case 'copy-room-link':
          await mainMenu.showCopyRoomLink(sheet)
          break
        case 'lobby':
          await roomManager.closeCurrentSheet()
          sheetOps.resetLastJmesQuery()
          await showRoomLobby()
          break
      }
    }
  } catch (error) {
    console.error(chalk.red('ERROR in showMainMenu:'), error)
    console.error(chalk.red('Stack trace:'), error.stack)
    await input({ message: 'Press Enter to continue...' })
    return showRoomLobby()
  }
}

async function showAddSchema(sheet) {
  const { method, name } = await schemaMenu.showAddSchema(sheet)

  if (method === 'back') {
    return showMainMenu(sheet)
  }

  try {
    await sheetOps.addSchema(sheet, method, name)
    await input({ message: 'Press Enter to continue...' })
      
    return showMainMenu(sheet)
  } catch (error) {
    console.error(chalk.red('Error adding schema:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showMainMenu(sheet)
  }
}

async function showRowMenu(sheet, schema) {
  try {
    console.log(chalk.cyan('DEBUG: Entering showRowMenu'))
    console.log(chalk.cyan(`DEBUG: Schema:`, schema))
    const choice = await rowMenu.show(sheet, schema)
    console.log(chalk.cyan(`DEBUG: Row menu choice: ${choice}`))
    console.log(chalk.cyan(`DEBUG: Choice type: ${typeof choice}`))

    if (choice === undefined || choice === null) {
      console.log(chalk.red('DEBUG: Choice is undefined/null, returning to main menu'))
      return await showMainMenu(sheet)
    }

    switch (choice) {
      case 'list-rows':
        await rowMenu.showRowList(sheet, schema, showRowMenu)
        break
      case 'filter-rows':
        await rowMenu.showFilterRows(sheet, schema, showRowMenu)
        break
      case 'add-row':
        await rowMenu.showAddRow(sheet, schema, showRowMenu)
        break
      case 'ui-schema':
        await rowMenu.showUISchemaMenu(sheet, schema, showRowMenu)
        break
      case 'back':
        console.log(chalk.cyan('DEBUG: Going back to main menu'))
        return await showMainMenu(sheet)
      default:
        console.log(chalk.yellow(`DEBUG: Unhandled choice: ${choice}`))
        return await showMainMenu(sheet)
    }
  } catch (error) {
    console.error(chalk.red('ERROR in showRowMenu:'), error)
    console.error(chalk.red('Stack trace:'), error.stack)
    await input({ message: 'Press Enter to continue...' })
    return showMainMenu(sheet)
  }
}

// Room lobby functions
async function showRoomLobby() {
  const { choice, rooms } = await roomLobbyMenu.show()

  switch (choice) {
    case 'create-room':
      await showCreateRoom()
      break
    case 'join-room':
      await showJoinRoom()
      break
    case 'setup-signing':
      const success = await roomLobbyMenu.showSetupSigning()
      if (success) {
        // Return to lobby to show updated menu (without setup signing option)
        return showRoomLobby()
      } else {
        return showRoomLobby()
      }
      break
    case 'exit':
      console.log(chalk.green('Goodbye! 👋'))
      process.exit(0)
      break
    default:
      if (choice.startsWith('room-')) {
        const roomKey = choice.replace('room-', '')
        const room = rooms.find(r => r.key === roomKey)
        if (room) {
          await joinKnownRoom(room)
        }
      }
      break
  }
}

async function showCreateRoom() {
  const result = await roomLobbyMenu.showCreateRoom()
  
  if (!result) {
    return showRoomLobby()
  }

  try {
    const { petName, username } = result
    const { sheet } = await roomManager.createNewRoom(petName, username)
    const member = await sheet.join(username)
    
    console.log(chalk.green('✅ Connected to schema sheets'))
    await input({ message: 'Press Enter to continue to room...' })
    
    await showMainMenu(sheet)
  } catch (error) {
    console.error(chalk.red('Error creating room:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showRoomLobby()
  }
}

async function showJoinRoom() {
  const result = await roomLobbyMenu.showJoinRoom()
  
  if (!result) {
    return showRoomLobby()
  }

  try {
    const { roomLink, username, petName } = result
    const { sheet } = await roomManager.joinExistingRoom(roomLink, username, petName)
    const member = await sheet.join(username)
    
    console.log(chalk.green('✅ Connected to schema sheets'))
    await input({ message: 'Press Enter to continue to room...' })
    
    await showMainMenu(sheet)
  } catch (error) {
    console.error(chalk.red('Error joining room:'), error.message)
    await input({ message: 'Press Enter to continue...' })
    return showRoomLobby()
  }
}

async function joinKnownRoom(room) {
  console.clear()
  console.log(chalk.blue.bold(`🏠 Joining Room: ${room.petName}\n`))

  try {
    const { sheet } = await roomManager.joinKnownRoom(room)
    await showMainMenu(sheet)
  } catch (error) {
    return showRoomLobby()
  }
}

async function run() {
  await lobby.init()
  await showRoomLobby()
}

run()

